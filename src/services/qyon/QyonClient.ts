import https from 'https';
import http from 'http';
import { TipoDoc } from '../../types/nota';

const QYON_BASE_URL = 'https://api-integracao.qyon.info';
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [1_000, 4_000, 16_000];

// Campos que o Qyon pode usar para a chave de acesso do documento
// Verificar com resposta real — nomes exatos podem variar
const CHAVE_FIELDS = ['chave', 'chNFSe', 'chNFe', 'chNFCe', 'chCTe', 'id', 'chaveDanfe'];

export interface QyonDocItem {
  chave: string;
  numero?: string;
  dataEmissao?: string;
  cancelada?: boolean;
  [key: string]: unknown;
}

interface QyonListResponse {
  // Nomes alternativos comuns em APIs brasileiras — verificar com resposta real
  content?: unknown[];
  data?: unknown[];
  items?: unknown[];
  result?: unknown[];
  [key: string]: unknown;
}

function extractChave(item: Record<string, unknown>): string | undefined {
  for (const field of CHAVE_FIELDS) {
    if (typeof item[field] === 'string' && item[field]) {
      return item[field] as string;
    }
  }
  return undefined;
}

function extractItems(response: QyonListResponse): unknown[] {
  return (
    response.content ??
    response.data ??
    response.items ??
    response.result ??
    (Array.isArray(response) ? response : [])
  );
}

function httpGet(url: string, headers: Record<string, string>): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const req = lib.get(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ body: Buffer.concat(chunks).toString('utf-8'), status: res.statusCode ?? 0 })
        );
        res.on('error', reject);
      }
    );

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Timeout após ${REQUEST_TIMEOUT_MS / 1000}s: ${url}`));
    });
  });
}

async function httpGetWithRetry(
  url: string,
  headers: Record<string, string>
): Promise<{ body: string; status: number }> {
  let lastError: Error = new Error('Nenhuma tentativa realizada');

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const result = await httpGet(url, headers);
      if (result.status === 429 || result.status >= 500) {
        throw new Error(`HTTP ${result.status}`);
      }
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

function authHeaders(accessKey: string): Record<string, string> {
  return { Authorization: `Bearer ${accessKey}` };
}

export class QyonClient {
  async listDocuments(
    tipo: TipoDoc,
    accessKey: string,
    dataInicio: string,
    dataFim: string
  ): Promise<QyonDocItem[]> {
    const params = new URLSearchParams({ dataInicio, dataFim });
    const url = `${QYON_BASE_URL}/v2/${tipo}/list?${params}`;

    const { body, status } = await httpGetWithRetry(url, authHeaders(accessKey));

    if (status === 401) throw new Error('accessKey inválida ou expirada (401)');
    if (status === 404) return []; // sem documentos para o período
    if (status >= 400) throw new Error(`Qyon retornou HTTP ${status} ao listar ${tipo}`);

    const response = JSON.parse(body) as QyonListResponse;
    const rawItems = extractItems(response);

    return rawItems
      .map((item) => {
        const obj = item as Record<string, unknown>;
        const chave = extractChave(obj);
        if (!chave) return null;

        return {
          chave,
          numero: typeof obj['numero'] === 'string' ? obj['numero'] : undefined,
          dataEmissao: typeof obj['dataEmissao'] === 'string' ? obj['dataEmissao'] : undefined,
          cancelada: Boolean(obj['cancelada'] ?? obj['situacao'] === 'cancelada'),
          ...obj,
        } as QyonDocItem;
      })
      .filter((item): item is QyonDocItem => item !== null);
  }

  async downloadXml(
    tipo: TipoDoc,
    chave: string,
    accessKey: string
  ): Promise<string> {
    const url = `${QYON_BASE_URL}/v2/download/${tipo}/${encodeURIComponent(chave)}/xml`;
    const { body, status } = await httpGetWithRetry(url, authHeaders(accessKey));

    if (status === 401) throw new Error('accessKey inválida ou expirada (401)');
    if (status === 404) throw new Error(`XML não encontrado para chave ${chave}`);
    if (status >= 400) throw new Error(`Qyon retornou HTTP ${status} ao baixar ${tipo}/${chave}`);

    return body;
  }
}

export const qyonClient = new QyonClient();
