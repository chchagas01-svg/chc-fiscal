import { query } from '../../config/database';
import { qyonClient } from '../qyon/QyonClient';
import { parseXml } from '../parsers';
import { TipoDoc, ParsedNota } from '../../types/nota';

const TIPOS_DOC: TipoDoc[] = ['nfse', 'nfe', 'nfce', 'cte'];

// Último dia do mês para um dado YYYY-MM
function ultimoDiaDoMes(competencia: string): string {
  const [year, month] = competencia.split('-').map(Number);
  const ultimo = new Date(year!, month!, 0); // dia 0 do próximo mês = último do atual
  return `${year}-${String(month).padStart(2, '0')}-${String(ultimo.getDate()).padStart(2, '0')}`;
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

// Retorna true se inserida, false se já existia (duplicata silenciosa)
async function inserirNota(empresaId: number, competencia: string, nota: ParsedNota): Promise<boolean> {
  const result = await query(
    `INSERT INTO notas (
       empresa_id, chave_acesso, tipo_doc, numero, serie, data_emissao, competencia,
       natureza, cnpj_emitente, nome_emitente, cnpj_tomador, nome_tomador,
       valor_bruto, valor_deducoes, valor_liquido,
       iss_retido, valor_iss,
       ret_pis, ret_cofins, ret_csll, ret_irrf, ret_inss,
       icms_debito, icms_credito,
       cancelada, chave_substituta, xml_raw
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,
       $8,$9,$10,$11,$12,
       $13,$14,$15,
       $16,$17,
       $18,$19,$20,$21,$22,
       $23,$24,
       $25,$26,$27
     )
     ON CONFLICT (chave_acesso) DO NOTHING`,
    [
      empresaId, nota.chaveAcesso, nota.tipoDoc, nota.numero ?? null, nota.serie ?? null,
      nota.dataEmissao, competencia,
      nota.natureza, nota.cnpjEmitente, nota.nomeEmitente ?? null,
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
    tipos_processados: [],
    erros: [],
  };

  const dataInicio = `${competencia}-01`;
  const dataFim = ultimoDiaDoMes(competencia);

  for (const tipo of TIPOS_DOC) {
    try {
      const items = await qyonClient.listDocuments(
        tipo, empresa.qyon_access_key, dataInicio, dataFim
      );

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
            const inserida = await inserirNota(empresa.id, competencia, nota);
            if (inserida) {
              resultado.notas_importadas++;
            } else {
              resultado.notas_ignoradas_duplicatas++;
            }
          }
        } catch (itemErr) {
          // Isola falha de 1 documento para não travar os demais
          const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
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

  await registrarAudit(
    competencia,
    empresa.id,
    'captura_concluida',
    { importadas: resultado.notas_importadas, duplicatas: resultado.notas_ignoradas_duplicatas },
    resultado.status
  );

  return resultado;
}

export async function capturar(competencia: string): Promise<ResultadoEmpresa[]> {
  const empresasResult = await query<EmpresaRow>(
    `SELECT id, cnpj, nome, regime, qyon_access_key
     FROM empresas WHERE ativo = true ORDER BY nome`
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
