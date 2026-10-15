import { query } from '../../config/database';
import { qyonClient } from '../qyon/QyonClient';
import { parseXml, aplicarNatureza } from '../parsers';
import { TipoDoc, ParsedNota } from '../../types/nota';

function naturezaPorFluxo(tipo: TipoDoc, fluxo: 1 | 2): ParsedNota['natureza'] {
  if (fluxo === 2) return tipo === 'nfse' ? 'servico_prestado' : 'venda';
  return tipo === 'nfse' ? 'servico_tomado' : 'compra';
}

const TIPOS_DOC: TipoDoc[] = ['nfse', 'nfe', 'nfce', 'cte'];

// Último dia do mês para um dado YYYY-MM
function ultimoDiaDoMes(competencia: string): string {
  const [year, month] = competencia.split('-').map(Number);
  const ultimo = new Date(year!, month!, 0); // dia 0 do próximo mês = último do atual
  return `${year}-${String(month).padStart(2, '0')}-${String(ultimo.getDate()).padStart(2, '0')}`;
}

function proximaCompetencia(competencia: string): string {
  const [year, month] = competencia.split('-').map(Number);
  const d = new Date(year!, month!, 1); // month já é 1-based → aponta para o mês seguinte
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Competência em que a nota deve ser lançada: a declarada no documento (NFS-e),
// senão o mês de emissão, senão a competência da captura.
export function competenciaDaNota(nota: ParsedNota, fallback: string): string {
  if (nota.competencia) return nota.competencia;
  const t = nota.dataEmissao.getTime();
  if (t > 0) return nota.dataEmissao.toISOString().substring(0, 7);
  return fallback;
}

interface EmpresaRow {
  id: number;
  cnpj: string;
  nome: string;
  regime: string;
  qyon_access_key: string;
}

export interface ResultadoEmpresa {
  empresa_id: number;
  cnpj: string;
  nome: string;
  status: 'ok' | 'erro' | 'sem_movimento';
  notas_importadas: number;
  notas_ignoradas_duplicatas: number;
  // Onde estão as notas que vieram como duplicata, ex.: { "2026-09": 80, "2026-08 (cancelada)": 2, "outra empresa": 1 }
  duplicatas_onde: Record<string, number>;
  tipos_processados: TipoDoc[];
  erros: string[];
}

async function atualizarEstado(
  competencia: string,
  empresaId: number,
  status: 'ok' | 'erro' | 'retida',
  detalhe?: string
): Promise<void> {
  await query(
    `INSERT INTO fechamentos_estado (competencia, empresa_id, fase, etapa, status, detalhe, atualizado_em)
     VALUES ($1, $2, 'fase1', 'captura', $3, $4, NOW())
     ON CONFLICT (competencia, empresa_id, etapa)
     DO UPDATE SET status = $3, detalhe = $4, atualizado_em = NOW()`,
    [competencia, empresaId, status, detalhe ?? null]
  );
}

async function registrarAudit(
  competencia: string,
  empresaId: number,
  acao: string,
  payload: unknown,
  resultado: string
): Promise<void> {
  await query(
    `INSERT INTO audit_log (competencia, empresa_id, acao, payload, resultado)
     VALUES ($1, $2, $3, $4, $5)`,
    [competencia, empresaId, acao, JSON.stringify(payload), resultado]
  );
}

// Para uma nota que já existia: diz em que competência ela está gravada,
// se está cancelada e se pertence a outra empresa (chave_acesso é única no banco todo)
export async function localizarDuplicata(empresaId: number, chave: string): Promise<string> {
  const r = await query<{ empresa_id: number; competencia: string; cancelada: boolean }>(
    `SELECT empresa_id, competencia, cancelada FROM notas WHERE chave_acesso = $1`, [chave]);
  const row = r.rows[0];
  // Sem a chave no banco: foi barrada por já existir a mesma NFS-e gravada com outra chave
  if (!row) return 'mesma nota com outra chave';
  if (Number(row.empresa_id) !== empresaId) return 'outra empresa';
  return row.cancelada ? `${row.competencia} (cancelada)` : row.competencia;
}

// A mesma NFS-e pode chegar com chaves diferentes (ex.: layout municipal e nacional, ou XML
// importado à mão e capturado do Qyon). Identifica a nota pelo emitente, número, data e valor.
export async function existeMesmaNfse(empresaId: number, nota: ParsedNota): Promise<boolean> {
  if (nota.tipoDoc !== 'nfse' || !nota.numero) return false;
  const r = await query(
    `SELECT 1 FROM notas
      WHERE empresa_id = $1 AND tipo_doc = 'nfse' AND cancelada = false
        AND chave_acesso <> $2
        AND COALESCE(cnpj_emitente, '') = COALESCE($3, '')
        AND NULLIF(LTRIM(numero, '0'), '') IS NOT DISTINCT FROM NULLIF(LTRIM($4, '0'), '')
        AND data_emissao = $5::date AND valor_bruto = $6
      LIMIT 1`,
    [empresaId, nota.chaveAcesso, nota.cnpjEmitente ?? null, String(nota.numero), nota.dataEmissao, nota.valorBruto]
  );
  return (r.rowCount ?? 0) > 0;
}

// Retorna true se inserida, false se já existia (duplicata silenciosa)
export async function inserirNota(empresaId: number, competencia: string, nota: ParsedNota): Promise<boolean> {
  if (!nota.cancelada && await existeMesmaNfse(empresaId, nota)) return false;
  const result = await query(
    `INSERT INTO notas (
       empresa_id, chave_acesso, tipo_doc, numero, serie, data_emissao, competencia,
       natureza, cfop, cnpj_emitente, nome_emitente, cnpj_tomador, nome_tomador,
       valor_bruto, valor_deducoes, valor_liquido,
       iss_retido, valor_iss,
       ret_pis, ret_cofins, ret_csll, ret_irrf, ret_inss,
       icms_debito, icms_credito,
       cancelada, chave_substituta, xml_raw
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,
       $8,$9,$10,$11,$12,$13,
       $14,$15,$16,
       $17,$18,
       $19,$20,$21,$22,$23,
       $24,$25,
       $26,$27,$28
     )
     ON CONFLICT (chave_acesso) DO NOTHING`,
    [
      empresaId, nota.chaveAcesso, nota.tipoDoc, nota.numero ?? null, nota.serie ?? null,
      nota.dataEmissao, competencia,
      nota.natureza, nota.cfop ?? null, nota.cnpjEmitente, nota.nomeEmitente ?? null,
      nota.cnpjTomador ?? null, nota.nomeTomador ?? null,
      nota.valorBruto, nota.valorDeducoes, nota.valorLiquido,
      nota.issRetido, nota.valorIss,
      nota.retPis, nota.retCofins, nota.retCsll, nota.retIrrf, nota.retInss,
      nota.icmsDebito, nota.icmsCredito,
      nota.cancelada, nota.chaveSubstituta ?? null, nota.xmlRaw,
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

async function capturarEmpresa(
  empresa: EmpresaRow,
  competencia: string
): Promise<ResultadoEmpresa> {
  const resultado: ResultadoEmpresa = {
    empresa_id: empresa.id,
    cnpj: empresa.cnpj,
    nome: empresa.nome,
    status: 'ok',
    notas_importadas: 0,
    notas_ignoradas_duplicatas: 0,
    duplicatas_onde: {},
    tipos_processados: [],
    erros: [],
  };

  const dataInicio = `${competencia}-01`;
  const dataFim = ultimoDiaDoMes(competencia);
  // NFS-e é lançada pela competência, não pela emissão: uma nota de competência M
  // pode ser emitida no mês M+1 (ex.: emitida 01/10 referente a 09). Por isso a
  // NFS-e também é buscada no mês seguinte (até hoje). O Qyon recusa (HTTP 400)
  // períodos que atravessam meses, então cada mês é uma chamada separada.
  const hoje = new Date().toISOString().substring(0, 10);
  const proxima = proximaCompetencia(competencia);
  const inicioSeguinte = `${proxima}-01`;
  const fimSeguinte = ultimoDiaDoMes(proxima);

  async function listar(tipo: TipoDoc) {
    const items = await qyonClient.listDocuments(tipo, empresa.qyon_access_key, dataInicio, dataFim);
    if (tipo !== 'nfse' || inicioSeguinte > hoje) return items;
    const seguinte = await qyonClient.listDocuments(
      tipo, empresa.qyon_access_key, inicioSeguinte, fimSeguinte < hoje ? fimSeguinte : hoje
    );
    const vistas = new Set(items.map(i => i.chave));
    return [...items, ...seguinte.filter(i => !vistas.has(i.chave))];
  }

  for (const tipo of TIPOS_DOC) {
    try {
      const items = await listar(tipo);

      console.log(`[captura] ${empresa.cnpj} ${tipo}: ${items.length} item(s) listado(s)`);
      if (items.length === 0) continue;
      resultado.tipos_processados.push(tipo);

      for (const item of items) {
        try {
          // Download do XML
          const xml = await qyonClient.downloadXml(tipo, item.chave, empresa.qyon_access_key);

          // Parse
          const notas = await parseXml(xml);

          // Inserção — ON CONFLICT DO NOTHING garante idempotência
          for (const nota of notas) {
            // Qyon informa a direção (1=Entrada, 2=Saída); o parser não tem essa info
            const notaComNatureza: ParsedNota = aplicarNatureza(nota, naturezaPorFluxo(tipo, item.fluxo));

            // Demais documentos seguem o mês de emissão (= mês da busca)
            const compNota = tipo === 'nfse' ? competenciaDaNota(nota, competencia) : competencia;
            if (compNota > competencia) continue; // competência futura: entra na captura do próprio mês
            const inserida = await inserirNota(empresa.id, compNota, notaComNatureza);
            if (inserida && compNota < competencia) {
              // Emitida neste mês, mas de competência anterior → lançada na competência correta
              console.log(`[captura] ${empresa.cnpj} nfse ${nota.numero}: capturada em ${competencia}, lançada em ${compNota}`);
              await registrarAudit(compNota, empresa.id, 'captura_nota_competencia_anterior',
                { numero: nota.numero, chave: nota.chaveAcesso, capturada_em: competencia }, 'lancada');
            }
            if (inserida) resultado.notas_importadas++;
            else {
              resultado.notas_ignoradas_duplicatas++;
              const onde = await localizarDuplicata(empresa.id, notaComNatureza.chaveAcesso);
              resultado.duplicatas_onde[onde] = (resultado.duplicatas_onde[onde] ?? 0) + 1;
            }
          }
        } catch (itemErr) {
          // Isola falha de 1 documento para não travar os demais
          const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
          console.error(`[captura] ${empresa.cnpj} ${tipo} chave=${item.chave.substring(0, 12)}: ${msg}`);
          resultado.erros.push(`${tipo}[${item.chave.substring(0, 8)}]: ${msg}`);
          await registrarAudit(competencia, empresa.id, `captura_item_erro`, { tipo, chave: item.chave }, msg);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resultado.erros.push(`${tipo}: ${msg}`);
      await registrarAudit(competencia, empresa.id, `captura_erro_${tipo}`, { tipo }, msg);
    }
  }

  if (resultado.notas_importadas === 0 && resultado.notas_ignoradas_duplicatas === 0 && resultado.erros.length === 0) {
    resultado.status = 'sem_movimento';
  } else if (resultado.erros.length > 0 && resultado.notas_importadas === 0) {
    resultado.status = 'erro';
  }

  const estadoDb = resultado.status === 'erro' ? 'erro' : 'ok';
  const detalhe = resultado.erros.length > 0 ? resultado.erros.join(' | ') : undefined;
  await atualizarEstado(competencia, empresa.id, estadoDb, detalhe);

  console.log(
    `[captura] ${empresa.cnpj} CONCLUÍDO: ` +
    `importadas=${resultado.notas_importadas} duplicatas=${resultado.notas_ignoradas_duplicatas} ` +
    `erros=${resultado.erros.length} status=${resultado.status}` +
    (resultado.erros.length > 0 ? ` | ${resultado.erros.slice(0, 3).join(' | ')}` : '')
  );
  if (resultado.notas_ignoradas_duplicatas > 0) {
    const onde = Object.entries(resultado.duplicatas_onde).map(([k, n]) => `${k}: ${n}`).join(', ');
    console.log(`[captura] ${empresa.cnpj} duplicatas já gravadas em → ${onde}`);
  }

  await registrarAudit(
    competencia,
    empresa.id,
    'captura_concluida',
    { importadas: resultado.notas_importadas, duplicatas: resultado.notas_ignoradas_duplicatas, duplicatas_onde: resultado.duplicatas_onde },
    resultado.status
  );

  return resultado;
}

export async function capturar(competencia: string, cnpjs?: string[]): Promise<ResultadoEmpresa[]> {
  const filtro = cnpjs && cnpjs.length > 0
    ? `AND cnpj = ANY($1::text[])`
    : '';
  const params = cnpjs && cnpjs.length > 0 ? [cnpjs] : [];
  const empresasResult = await query<EmpresaRow>(
    `SELECT id, cnpj, nome, regime, qyon_access_key
     FROM empresas WHERE ativo = true ${filtro} ORDER BY nome`,
    params
  );

  const empresas = empresasResult.rows;
  const resultados: ResultadoEmpresa[] = [];

  // Processar empresas em paralelo com limite de 3 simultâneas
  // (evitar sobrecarga na API do Qyon)
  const concorrencia = 3;
  for (let i = 0; i < empresas.length; i += concorrencia) {
    const lote = empresas.slice(i, i + concorrencia);
    const loteResultados = await Promise.all(
      lote.map(empresa =>
        capturarEmpresa(empresa, competencia).catch(err => {
          // Isolamento: erro crítico em uma empresa não trava as outras
          const msg = err instanceof Error ? err.message : String(err);
          return {
            empresa_id: empresa.id,
            cnpj: empresa.cnpj,
            nome: empresa.nome,
            status: 'erro' as const,
            notas_importadas: 0,
            notas_ignoradas_duplicatas: 0,
            duplicatas_onde: {},
            tipos_processados: [],
            erros: [msg],
          };
        })
      )
    );
    resultados.push(...loteResultados);
  }

  return resultados;
}
