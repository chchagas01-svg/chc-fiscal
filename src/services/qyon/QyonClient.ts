import https from 'https';
import http from 'http';
import { TipoDoc } from '../../types/nota';

const QYON_BASE_URL = 'https://api-integracao.qyon.info';
const QYON_TOKEN_URL = 'https://apigw-qyon-authorization-prd.qyon.com/oauth/token';
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [1_000, 4_000, 16_000];

// Per-tipo: which query param carries the direction (1=Entrada, 2=Saída)
const TYPE_PARAM: Partial<Record<TipoDoc, string>> = {
  nfse:  'nfseType',
  nfe:   'nfeType',
  nfce:  'nfceType',
  nfcom: 'nfcomType',
  nf3e:  'nf3eType',
  cte:   'cteType',   // optional per spec
};

// Field(s) tried in order to extract the document key for download
const CHAVE_FIELDS_POR_TIPO: Record<TipoDoc, string[]> = {
  nfse:  ['depotid', 'key'],          // spec: "Depot Id da NFS-e"
  nfe:   ['chNFe',   'depotid', 'key'],
  nfce:  ['chNFCe',  'depotid', 'key'],
  cte:   ['chCTe',   'depotid', 'key'],
  nfcom: ['chNFCom', 'depotid', 'key'],
  nf3e:  ['chNF3e',  'depotid', 'key'],
};

export interface QyonDocItem {
  chave: string;
  fluxo: 1 | 2;       // 1=Entrada, 2=Saída
  numero?: string;
  dataEmissao?: string;
  cancelada?: boolean;
  [key: string]: unknown;
}

interface QyonListResponse {
  success: boolean;
  totalSize?: number;
  pageSize?: number;
  currentPage?: number;
  list?: unknown[];
  [key: string]: unknown;
}

const PAGE_SIZE = 50;

// In-memory JWT — initialised from env, refreshed automatically on 401
let currentJwt: string = process.env['QYON_JWT'] ?? '';

async function refreshJwt(): Promise<void> {
  const refreshToken = process.env['QYON_REFRESH_TOKEN'];
  const clientId     = process.env['QYON_CLIENT_ID'];
  const clientSecret = process.env['QYON_CLIENT_SECRET'];

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(
      'JWT expirado e refresh_token/client_id/client_secret não configurados. ' +
      'Defina QYON_JWT, QYON_REFRESH_TOKEN, QYON_CLIENT_ID, QYON_CLIENT_SECRET no Railway.'
    );
  }

  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    client_id:     clientId,
    client_secret: clientSecret,
  }).toString();

  const { respBody, status } = await rawPost(QYON_TOKEN_URL, body, {
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  if (status !== 200) {
    throw new Error(`Falha ao renovar JWT Qyon: HTTP ${status} — ${respBody.substring(0, 200)}`);
  }

  const parsed = JSON.parse(respBody) as { access_token?: string };
  if (!parsed.access_token) {
    throw new Error(`Resposta de refresh sem access_token: ${respBody.substring(0, 200)}`);
  }

  currentJwt = parsed.access_token;
}

function getAuthHeader(): Record<string, string> {
  if (!currentJwt) {
    throw new Error(
      'QYON_JWT não configurado. Defina a variável de ambiente no Railway.'
    );
  }
  return { Authorization: `Bearer ${currentJwt}` };
}

function toQyonDate(iso: string): string {
  // Converte YYYY-MM-DD → yyyyMMdd
  return iso.replace(/-/g, '');
}

function extractChave(item: Record<string, unknown>, tipo: TipoDoc): string | undefined {
  for (const field of CHAVE_FIELDS_POR_TIPO[tipo]) {
    if (typeof item[field] === 'string' && item[field]) {
      return item[field] as string;
    }
  }
  return undefined;
}

function rawGet(url: string, headers: Record<string, string>): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf-8'), status: res.statusCode ?? 0 }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`Timeout: ${url}`)));
  });
}

function rawPost(
  url: string,
  body: string,
  headers: Record<string, string>
): Promise<{ respBody: string; status: number }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  { ...headers, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ respBody: Buffer.concat(chunks).toString('utf-8'), status: res.statusCode ?? 0 }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`Timeout: ${url}`)));
    req.write(body);
    req.end();
  });
}

async function httpGetWithRetry(
  url: string,
  headers: Record<string, string>
): Promise<{ body: string; status: number }> {
  let lastError: Error = new Error('Nenhuma tentativa realizada');
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const result = await rawGet(url, headers);
      if (result.status === 429 || result.status >= 500) throw new Error(`HTTP ${result.status}`);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
  }
  throw lastError;
}

function mapItems(rawItems: unknown[], tipo: TipoDoc, fluxo: 1 | 2): QyonDocItem[] {
  return rawItems
    .map((item) => {
      const obj = item as Record<string, unknown>;
      const chave = extractChave(obj, tipo);
      if (!chave) return null;
      return {
        chave,
        fluxo,
        numero:      typeof obj['nnfs'] === 'string' ? obj['nnfs']
                   : typeof obj['numero'] === 'string' ? obj['numero'] : undefined,
        dataEmissao: typeof obj['dEmi'] === 'string' ? obj['dEmi']
                   : typeof obj['dataEmissao'] === 'string' ? obj['dataEmissao'] : undefined,
        cancelada:   Boolean(obj['cancelada'] ?? obj['situacao'] === 'cancelada'),
        ...obj,
      } as QyonDocItem;
    })
    .filter((item): item is QyonDocItem => item !== null);
}

async function listarPagina(
  tipo: TipoDoc,
  accessKey: string,
  startDate: string,
  endDate: string,
  fluxo: 1 | 2,
  page: number
): Promise<QyonListResponse> {
  const typeParam = TYPE_PARAM[tipo];
  const params = new URLSearchParams({
    accessKey,
    startDate,
    endDate,
    page:     String(page),
    pageSize: String(PAGE_SIZE),
    ...(typeParam ? { [typeParam]: String(fluxo) } : {}),
  });
  const url = `${QYON_BASE_URL}/v2/${tipo}/list?${params}`;

  let { body, status } = await httpGetWithRetry(url, getAuthHeader());

  if (status === 401) {
    await refreshJwt();
    const retry = await httpGetWithRetry(url, getAuthHeader());
    body   = retry.body;
    status = retry.status;
  }

  if (status === 401) throw new Error(`Credencial Qyon inválida (401) após refresh`);
  if (status === 404) return { success: true, list: [] };
  if (status >= 400)  throw new Error(`Qyon retornou HTTP ${status} ao listar ${tipo}`);

  return JSON.parse(body) as QyonListResponse;
}

// Chama a listagem para uma direção (1 ou 2) e retorna todos os itens (com paginação)
async function listarDirecao(
  tipo: TipoDoc,
  accessKey: string,
  startDate: string,
  endDate: string,
  fluxo: 1 | 2
): Promise<QyonDocItem[]> {
  const allItems: QyonDocItem[] = [];
  let page = 0;

  while (true) {
    const response = await listarPagina(tipo, accessKey, startDate, endDate, fluxo, page);
    if (!response.success) break;

    const rawItems = response.list ?? [];
    allItems.push(...mapItems(rawItems, tipo, fluxo));

    const totalSize = response.totalSize ?? rawItems.length;
    if (allItems.length >= totalSize || rawItems.length < PAGE_SIZE) break;
    page++;
  }

  return allItems;
}

export class QyonClient {
  // Lista NFS-e/NF-e/etc. capturando Entrada (1) + Saída (2)
  async listDocuments(
    tipo: TipoDoc,
    accessKey: string,
    dataInicio: string,  // aceita YYYY-MM-DD ou yyyyMMdd
    dataFim: string
  ): Promise<QyonDocItem[]> {
    const startDate = toQyonDate(dataInicio);
    const endDate   = toQyonDate(dataFim);

    const hasTypeParam = !!TYPE_PARAM[tipo];
    if (!hasTypeParam) {
      // CT-e sem direção (param opcional)
      return listarDirecao(tipo, accessKey, startDate, endDate, 2);
    }

    // Para tipos com direção: captura Saída (2) e Entrada (1)
    const [saida, entrada] = await Promise.all([
      listarDirecao(tipo, accessKey, startDate, endDate, 2),
      listarDirecao(tipo, accessKey, startDate, endDate, 1),
    ]);

    // Deduplicar por chave (mesmo doc pode aparecer nas 2 direções raramente)
    const vistas = new Set<string>();
    const result: QyonDocItem[] = [];
    for (const item of [...saida, ...entrada]) {
      if (!vistas.has(item.chave)) {
        vistas.add(item.chave);
        result.push(item);
      }
    }
    return result;
  }

  async downloadXml(
    tipo: TipoDoc,
    chave: string,
    accessKey: string
  ): Promise<string> {
    const params = new URLSearchParams({ accessKey });
    const url = `${QYON_BASE_URL}/v2/download/${tipo}/${encodeURIComponent(chave)}/xml?${params}`;

    let { body, status } = await httpGetWithRetry(url, getAuthHeader());

    if (status === 401) {
      await refreshJwt();
      const retry = await httpGetWithRetry(url, getAuthHeader());
      body   = retry.body;
      status = retry.status;
    }

    if (status === 401) throw new Error(`Credencial Qyon inválida (401) após refresh`);
    if (status === 404) throw new Error(`XML não encontrado para chave ${chave} (${tipo})`);
    if (status >= 400)  throw new Error(`Qyon retornou HTTP ${status} ao baixar ${tipo}/${chave}`);

    return body;
  }
}

export const qyonClient = new QyonClient();
