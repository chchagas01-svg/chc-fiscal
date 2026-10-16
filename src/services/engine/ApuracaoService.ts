import { query } from '../../config/database';
import { calcularSimples, SaldoRetencoes } from './simplesNacional';
import { calcularPresumido, mesDotrimestre, identificarTrimestre } from './lucroPresumido';
import { AnexoSimples } from './tabelasSimples';
import { CFOPS_VENDA_PRODUCAO } from './cfop';

const DESVIO_MAX_HISTORICO = 0.40; // 40% — trava de segurança

interface EmpresaRow {
  id: number;
  cnpj: string;
  nome: string;
  regime: 'simples' | 'presumido';
  anexo: AnexoSimples | null;
  anexo_comercio: AnexoSimples | null;
  presuncao_servicos: number | null;
  presuncao_comercio: number | null;
  presuncao_industria: number | null;
  presuncao_irpj: number | null;
  presuncao_csll: number | null;
  aliquota_iss: number | null;
  folha_12meses_seed: number | null;
  rbt12_seed: number | null;
  inscricao_estadual: string | null;
}

interface TotaisNotas {
  receita_servicos: number;
  receita_comercio: number;
  receita_industria: number;
  ret_pis: number;
  ret_cofins: number;
  ret_csll: number;
  ret_irrf: number;
  ret_inss: number;
  iss_retido_tomador: number;
  icms_debito: number;
  icms_credito: number;
  total_notas: number;
}

interface SaldoAnteriorRow {
  saldo_ret_proximo: SaldoRetencoes;
  icms_saldo_credor: number | null;
  base_irpj: number | null;
  base_csll: number | null;
  trimestre: string | null;
}

async function buscarEmpresa(empresaId: number): Promise<EmpresaRow | null> {
  const r = await query<EmpresaRow>(
    `SELECT id, cnpj, nome, regime, anexo, anexo_comercio,
            presuncao_servicos, presuncao_comercio, presuncao_industria,
            presuncao_irpj, presuncao_csll, aliquota_iss, folha_12meses_seed, rbt12_seed,
            inscricao_estadual
     FROM empresas WHERE id = $1 AND ativo = true`,
    [empresaId]
  );
  return r.rows[0] ?? null;
}

async function contarMesesCapturados(empresaId: number, competencia: string): Promise<number> {
  const r = await query(
    `SELECT COUNT(DISTINCT competencia)::int AS cnt
     FROM notas
     WHERE empresa_id = $1
       AND competencia < $2
       AND competencia >= TO_CHAR((TO_DATE($2 || '-01','YYYY-MM-DD') - INTERVAL '12 months'), 'YYYY-MM')`,
    [empresaId, competencia]
  );
  return Number(r.rows[0]?.['cnt'] ?? 0);
}

async function buscarTotaisNotas(empresaId: number, competencia: string): Promise<TotaisNotas> {
  const r = await query(
    `SELECT
       COALESCE(SUM(valor_bruto) FILTER (WHERE natureza = 'servico_prestado' AND NOT cancelada), 0) AS receita_servicos,
       COALESCE(SUM(valor_bruto) FILTER (WHERE natureza = 'venda' AND NOT cancelada
                                           AND NOT (COALESCE(cfop, '') = ANY($3::text[]))), 0)  AS receita_comercio,
       -- Venda de produção própria (CFOP 5101, 6101...). 'outro' = devolução/remessa/retorno, não é receita
       COALESCE(SUM(valor_bruto) FILTER (WHERE natureza = 'venda' AND NOT cancelada
                                           AND COALESCE(cfop, '') = ANY($3::text[])), 0)        AS receita_industria,
       COALESCE(SUM(ret_pis)    FILTER (WHERE natureza = 'servico_prestado' AND NOT cancelada), 0) AS ret_pis,
       COALESCE(SUM(ret_cofins) FILTER (WHERE natureza = 'servico_prestado' AND NOT cancelada), 0) AS ret_cofins,
       COALESCE(SUM(ret_csll)   FILTER (WHERE natureza = 'servico_prestado' AND NOT cancelada), 0) AS ret_csll,
       COALESCE(SUM(ret_irrf)   FILTER (WHERE natureza = 'servico_prestado' AND NOT cancelada), 0) AS ret_irrf,
       COALESCE(SUM(ret_inss)   FILTER (WHERE natureza = 'servico_prestado' AND NOT cancelada), 0) AS ret_inss,
       COALESCE(SUM(valor_iss)  FILTER (WHERE iss_retido = true AND NOT cancelada AND natureza = 'servico_prestado'), 0) AS iss_retido_tomador,
       COALESCE(SUM(icms_debito)  FILTER (WHERE natureza = 'venda'  AND NOT cancelada), 0)         AS icms_debito,
       COALESCE(SUM(icms_credito) FILTER (WHERE natureza = 'compra' AND NOT cancelada), 0)         AS icms_credito,
       COUNT(*) FILTER (WHERE NOT cancelada)                                                        AS total_notas
     FROM notas
     WHERE empresa_id = $1 AND competencia = $2`,
    [empresaId, competencia, [...CFOPS_VENDA_PRODUCAO]]
  );
  const row = r.rows[0] ?? {};
  return {
    receita_servicos:    Number(row['receita_servicos']    ?? 0),
    receita_comercio:    Number(row['receita_comercio']    ?? 0),
    receita_industria:   Number(row['receita_industria']   ?? 0),
    ret_pis:             Number(row['ret_pis']             ?? 0),
    ret_cofins:          Number(row['ret_cofins']          ?? 0),
    ret_csll:            Number(row['ret_csll']            ?? 0),
    ret_irrf:            Number(row['ret_irrf']            ?? 0),
    ret_inss:            Number(row['ret_inss']            ?? 0),
    iss_retido_tomador:  Number(row['iss_retido_tomador']  ?? 0),
    icms_debito:         Number(row['icms_debito']         ?? 0),
    icms_credito:        Number(row['icms_credito']        ?? 0),
    total_notas:         Number(row['total_notas']         ?? 0),
  };
}

export async function buscarRBT12(empresaId: number, competencia: string): Promise<number> {
  // Soma apenas notas de saída (receita) dos 12 meses anteriores à competência
  const r = await query(
    `SELECT COALESCE(SUM(valor_bruto), 0) AS rbt12
     FROM notas
     WHERE empresa_id = $1
       AND competencia < $2
       AND competencia >= TO_CHAR((TO_DATE($2 || '-01','YYYY-MM-DD') - INTERVAL '12 months'), 'YYYY-MM')
       AND NOT cancelada
       AND natureza IN ('servico_prestado', 'venda')`,
    [empresaId, competencia]
  );
  return Number(r.rows[0]?.['rbt12'] ?? 0);
}

// RBT12 do Simples: soma das notas dos 12 meses anteriores; sem histórico, a base informada
// no cadastro; sem nada, receita do mês × 12 como base provisória
export function resolverRbt12(historico: number, seed: number | null, receitaMes: number, temNotas: boolean): { rbt12: number; alertas: string[] } {
  const alertas: string[] = [];
  if (historico > 0) return { rbt12: historico, alertas };
  if (seed != null && Number(seed) > 0) {
    alertas.push(`RBT12: base histórica informada R$ ${Number(seed).toFixed(2)}. A partir do próximo mês acumula automaticamente pelas notas.`);
    return { rbt12: Number(seed), alertas };
  }
  if (receitaMes > 0) {
    alertas.push('RBT12 histórico zero — usando receita do mês × 12 como base provisória. Importe os meses anteriores para resultado exato.');
    return { rbt12: receitaMes * 12, alertas };
  }
  if (temNotas) alertas.push('RBT12 calculado como zero — pode faltar histórico de meses anteriores. Verifique o cadastro.');
  return { rbt12: 0, alertas };
}

async function buscarSaldoAnterior(empresaId: number, competencia: string): Promise<SaldoAnteriorRow> {
  const mesAnterior = (() => {
    const [ano, mes] = competencia.split('-').map(Number);
    const d = new Date(ano!, mes! - 1, 1); // mes-1 = mês anterior
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();

  const r = await query<SaldoAnteriorRow>(
    `SELECT saldo_ret_proximo, icms_saldo_credor, base_irpj, base_csll, trimestre
     FROM apuracoes WHERE empresa_id = $1 AND competencia = $2`,
    [empresaId, mesAnterior]
  );

  const row = r.rows[0];
  return {
    saldo_ret_proximo: row?.saldo_ret_proximo ?? { pis: 0, cofins: 0, csll: 0, irrf: 0, inss: 0 },
    icms_saldo_credor: row?.icms_saldo_credor ? Number(row.icms_saldo_credor) : 0,
    base_irpj: row?.base_irpj ? Number(row.base_irpj) : null,
    base_csll: row?.base_csll ? Number(row.base_csll) : null,
    trimestre: row?.trimestre ?? null,
  };
}

// Meses anteriores do trimestre cuja apuração gravada não bate mais com as notas
// (ex.: notas duplicadas canceladas depois de apurar). O fechamento usa a base gravada,
// então esses meses precisam ser apurados de novo antes.
export async function mesesTrimestreDesatualizados(
  empresaId: number, competencia: string, trimestre: string
): Promise<{ competencia: string; apurado: number; notas: number }[]> {
  const r = await query<{ competencia: string; receita_total: string }>(
    `SELECT competencia, receita_total FROM apuracoes
      WHERE empresa_id = $1 AND trimestre = $2 AND competencia < $3 ORDER BY competencia`,
    [empresaId, trimestre, competencia]
  );
  const out: { competencia: string; apurado: number; notas: number }[] = [];
  for (const row of r.rows) {
    const t = await buscarTotaisNotas(empresaId, row.competencia);
    const notas = Math.round((t.receita_servicos + t.receita_comercio + t.receita_industria) * 100) / 100;
    const apurado = Number(row.receita_total ?? 0);
    if (Math.abs(notas - apurado) >= 0.01) out.push({ competencia: row.competencia, apurado, notas });
  }
  return out;
}

export function mensagemTrimestreDesatualizado(meses: { competencia: string; apurado: number; notas: number }[]): string {
  const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Apuração desatualizada em ${meses.map(m =>
    `${m.competencia.split('-').reverse().join('/')} (apurado R$ ${brl(m.apurado)}, notas hoje R$ ${brl(m.notas)})`).join('; ')}. ` +
    `Apure esses meses de novo antes de fechar o trimestre.`;
}

async function buscarBaseAcumuladaTrimestre(empresaId: number, competencia: string, trimestre: string): Promise<{ base_irpj: number; base_csll: number }> {
  const r = await query(
    `SELECT COALESCE(SUM(base_irpj), 0) AS base_irpj, COALESCE(SUM(base_csll), 0) AS base_csll
     FROM apuracoes
     WHERE empresa_id = $1 AND trimestre = $2 AND competencia < $3`,
    [empresaId, trimestre, competencia]
  );
  return {
    base_irpj: Number(r.rows[0]?.['base_irpj'] ?? 0),
    base_csll: Number(r.rows[0]?.['base_csll'] ?? 0),
  };
}

async function buscarHistoricoImposto(empresaId: number, competencia: string): Promise<number[]> {
  const r = await query(
    `SELECT COALESCE(das_devido, irpj_devido + csll_devida + pis_devido + cofins_devida, 0) AS total_imposto
     FROM apuracoes
     WHERE empresa_id = $1 AND competencia < $2 AND status = 'aprovada'
     ORDER BY competencia DESC LIMIT 3`,
    [empresaId, competencia]
  );
  return r.rows.map(row => Number(row['total_imposto'] ?? 0));
}

function verificarDesvioHistorico(impostoAtual: number, historico: number[]): string | null {
  if (historico.length < 2) return null;
  const media = historico.reduce((a, b) => a + b, 0) / historico.length;
  if (media === 0) return null;
  const desvio = Math.abs(impostoAtual - media) / media;
  if (desvio > DESVIO_MAX_HISTORICO) {
    return `Imposto apurado (R$ ${impostoAtual.toFixed(2)}) desvia ${(desvio * 100).toFixed(1)}% da média histórica (R$ ${media.toFixed(2)}) — limite: ${(DESVIO_MAX_HISTORICO * 100).toFixed(0)}%.`;
  }
  return null;
}

async function salvarApuracao(empresaId: number, competencia: string, dados: Record<string, unknown>): Promise<void> {
  await query(
    `INSERT INTO apuracoes (
       empresa_id, competencia, regime,
       receita_servicos, receita_comercio, receita_industria, receita_total,
       rbt12, folha_12meses, fator_r, anexo_aplicado,
       aliquota_nominal, parcela_dedutivel, aliquota_efetiva,
       das_bruto, das_deducoes, das_devido,
       base_irpj, base_csll,
       pis_devido, cofins_devida, iss_devido,
       icms_saldo_anterior, icms_debitos, icms_creditos, icms_devido, icms_saldo_credor,
       irpj_devido, csll_devida, irpj_adicional, trimestre,
       ret_pis_total, ret_cofins_total, ret_csll_total, ret_irrf_total, ret_inss_total,
       saldo_ret_anterior, saldo_ret_proximo,
       memoria_calculo, status, motivo_retencao, atualizado_em
     ) VALUES (
       $1,$2,$3,
       $4,$5,$6,$7,
       $8,$9,$10,$11,
       $12,$13,$14,
       $15,$16,$17,
       $18,$19,
       $20,$21,$22,
       $23,$24,$25,$26,$27,
       $28,$29,$30,$31,
       $32,$33,$34,$35,$36,
       $37,$38,
       $39,$40,$41,NOW()
     )
     ON CONFLICT (empresa_id, competencia)
     DO UPDATE SET
       receita_total=$7, receita_servicos=$4, receita_comercio=$5, receita_industria=$6,
       rbt12=$8, fator_r=$10, anexo_aplicado=$11,
       aliquota_efetiva=$14, das_bruto=$15, das_deducoes=$16, das_devido=$17,
       base_irpj=$18, base_csll=$19,
       pis_devido=$20, cofins_devida=$21, iss_devido=$22,
       icms_saldo_anterior=$23, icms_debitos=$24, icms_creditos=$25, icms_devido=$26, icms_saldo_credor=$27,
       irpj_devido=$28, csll_devida=$29, irpj_adicional=$30, trimestre=$31,
       ret_pis_total=$32, ret_cofins_total=$33, ret_csll_total=$34, ret_irrf_total=$35, ret_inss_total=$36,
       saldo_ret_anterior=$37, saldo_ret_proximo=$38,
       memoria_calculo=$39, status=$40, motivo_retencao=$41, atualizado_em=NOW()`,
    [
      empresaId, competencia, dados['regime'],
      dados['receita_servicos'], dados['receita_comercio'], dados['receita_industria'], dados['receita_total'],
      dados['rbt12'] ?? null, dados['folha_12meses'] ?? null, dados['fator_r'] ?? null, dados['anexo_aplicado'] ?? null,
      dados['aliquota_nominal'] ?? null, dados['parcela_dedutivel'] ?? null, dados['aliquota_efetiva'] ?? null,
      dados['das_bruto'] ?? null, dados['das_deducoes'] ?? null, dados['das_devido'] ?? null,
      dados['base_irpj'] ?? null, dados['base_csll'] ?? null,
      dados['pis_devido'] ?? null, dados['cofins_devida'] ?? null, dados['iss_devido'] ?? null,
      dados['icms_saldo_anterior'] ?? null, dados['icms_debitos'] ?? null, dados['icms_creditos'] ?? null, dados['icms_devido'] ?? null, dados['icms_saldo_credor'] ?? null,
      dados['irpj_devido'] ?? null, dados['csll_devida'] ?? null, dados['irpj_adicional'] ?? null, dados['trimestre'] ?? null,
      dados['ret_pis'] ?? null, dados['ret_cofins'] ?? null, dados['ret_csll'] ?? null, dados['ret_irrf'] ?? null, dados['ret_inss'] ?? null,
      JSON.stringify(dados['saldo_anterior'] ?? {}), JSON.stringify(dados['saldo_proximo'] ?? {}),
      JSON.stringify(dados['memoria_calculo'] ?? {}), dados['status'], dados['motivo_retencao'] ?? null,
    ]
  );
}

export interface ResultadoApuracao {
  empresa_id: number;
  cnpj: string;
  nome: string;
  status: 'aprovada' | 'retida';
  motivo?: string;
  alertas: string[];
  resumo?: Record<string, unknown>;
}

export async function apurarEmpresa(empresaId: number, competencia: string): Promise<ResultadoApuracao> {
  const empresa = await buscarEmpresa(empresaId);
  if (!empresa) {
    return { empresa_id: empresaId, cnpj: '', nome: '', status: 'retida', motivo: 'Empresa não encontrada ou inativa.', alertas: [] };
  }

  const totais = await buscarTotaisNotas(empresaId, competencia);
  const saldoAnt = await buscarSaldoAnterior(empresaId, competencia);
  const retencoesMes: SaldoRetencoes = {
    pis:    totais.ret_pis,
    cofins: totais.ret_cofins,
    csll:   totais.ret_csll,
    irrf:   totais.ret_irrf,
    inss:   totais.ret_inss,
  };

  let impostoTotal = 0;
  let status: 'aprovada' | 'retida' = 'aprovada';
  let motivo: string | undefined;
  let memoriaCalculo: Record<string, unknown> = {};
  let saldoProximo: SaldoRetencoes = { pis: 0, cofins: 0, csll: 0, irrf: 0, inss: 0 };
  const alertas: string[] = [];

  if (empresa.regime === 'simples') {
    // Indústria (Anexo II) entra junto com o comércio na receita do Simples
    const receitaMercadorias = totais.receita_comercio + totais.receita_industria;
    const receitaMes = totais.receita_servicos + receitaMercadorias;
    const rb = resolverRbt12(await buscarRBT12(empresaId, competencia), empresa.rbt12_seed, receitaMes, totais.total_notas > 0);
    const rbt12 = rb.rbt12;
    alertas.push(...rb.alertas);

    const folha12meses = empresa.folha_12meses_seed != null ? Number(empresa.folha_12meses_seed) : 0;
    if (folha12meses === 0 && (empresa.anexo === 'III' || empresa.anexo === 'V')) {
      alertas.push('folha_12meses_seed não informada — Fator R calculado como 0. Configure em cadastro da empresa para resultado preciso.');
    }

    const entrada = {
      receita_bruta_mes: receitaMes,
      receita_servicos_mes: totais.receita_servicos,
      receita_comercio_mes: receitaMercadorias,
      rbt12,
      folha_12meses: folha12meses,
      anexo: (empresa.anexo ?? 'III') as AnexoSimples,
      ...(empresa.anexo_comercio ? { anexo_comercio: empresa.anexo_comercio as AnexoSimples } : {}),
      retencoes_mes: retencoesMes,
      saldo_anterior: saldoAnt.saldo_ret_proximo,
      iss_retido_tomador: totais.iss_retido_tomador,
    };

    const resultado = calcularSimples(entrada);

    if (!resultado.ok) {
      status = 'retida';
      motivo = resultado.trava.mensagem;
    } else {
      impostoTotal = resultado.resultado.das_devido;
      saldoProximo = resultado.resultado.saldo_proximo;
      alertas.push(...resultado.resultado.alertas);
      memoriaCalculo = {
        tipo: 'simples_nacional',
        entrada,
        resultado: resultado.resultado,
      };

      await salvarApuracao(empresaId, competencia, {
        regime: 'simples',
        receita_servicos: totais.receita_servicos,
        receita_comercio: totais.receita_comercio,
        receita_industria: totais.receita_industria,
        receita_total: receitaMes,
        rbt12: resultado.resultado.rbt12,
        folha_12meses: folha12meses,
        fator_r: resultado.resultado.fator_r,
        anexo_aplicado: resultado.resultado.anexo_aplicado,
        aliquota_nominal: resultado.resultado.aliquota_nominal,
        parcela_dedutivel: resultado.resultado.parcela_dedutivel,
        aliquota_efetiva: resultado.resultado.aliquota_efetiva,
        das_bruto: resultado.resultado.das_bruto,
        das_deducoes: resultado.resultado.das_deducoes,
        das_devido: resultado.resultado.das_devido,
        ret_pis: totais.ret_pis, ret_cofins: totais.ret_cofins,
        ret_csll: totais.ret_csll, ret_irrf: totais.ret_irrf, ret_inss: totais.ret_inss,
        saldo_anterior: saldoAnt.saldo_ret_proximo,
        saldo_proximo: saldoProximo,
        icms_saldo_anterior: 0, icms_debitos: 0, icms_creditos: 0, icms_devido: 0, icms_saldo_credor: 0,
        memoria_calculo: memoriaCalculo,
        status: 'rascunho',
      });
    }

  } else {
    // Lucro Presumido
    const trimestre = identificarTrimestre(competencia);
    const mesTrim = mesDotrimestre(competencia);
    const { base_irpj: baseAcumIrpj, base_csll: baseAcumCsll } =
      await buscarBaseAcumuladaTrimestre(empresaId, competencia, trimestre);
    const desatualizados = mesTrim === 3 ? await mesesTrimestreDesatualizados(empresaId, competencia, trimestre) : [];

    // Regra do escritório: só apura ICMS quem tem Inscrição Estadual (e não é do Simples)
    const temIcms = Boolean(empresa.inscricao_estadual?.trim());
    if (!temIcms && (totais.icms_debito > 0 || totais.icms_credito > 0)) {
      alertas.push('Empresa sem Inscrição Estadual cadastrada: ICMS destacado nas notas não foi apurado. Cadastrar a IE se for contribuinte.');
    }
    const icmsSaldoAnterior = temIcms ? Number(saldoAnt.icms_saldo_credor ?? 0) : 0;

    const entrada = {
      receita_servicos:    totais.receita_servicos,
      receita_comercio:    totais.receita_comercio,
      receita_industria:   totais.receita_industria,
      presuncao_servicos:  empresa.presuncao_servicos  ?? 0.32,
      presuncao_comercio:  empresa.presuncao_comercio  ?? 0.08,
      presuncao_industria: empresa.presuncao_industria ?? 0.08,
      presuncao_irpj:      empresa.presuncao_irpj      ?? 0.32,
      presuncao_csll:      empresa.presuncao_csll      ?? 0.32,
      aliquota_iss:        empresa.aliquota_iss        ?? 0.02,
      mes_do_trimestre:    mesTrim,
      base_irpj_acumulada_trim: baseAcumIrpj,
      base_csll_acumulada_trim: baseAcumCsll,
      icms_saldo_anterior: icmsSaldoAnterior,
      icms_debitos_mes:    temIcms ? totais.icms_debito : 0,
      icms_creditos_mes:   temIcms ? totais.icms_credito : 0,
      retencoes_mes:       retencoesMes,
      saldo_anterior:      saldoAnt.saldo_ret_proximo,
    };

    const resultado = calcularPresumido(entrada);

    if (!resultado.ok) {
      status = 'retida';
      motivo = resultado.trava.mensagem;
    } else {
      const r = resultado.resultado;
      impostoTotal = (r.pis_devido ?? 0) + (r.cofins_devida ?? 0) + (r.iss_devido ?? 0) +
                     (r.icms_devido ?? 0) + (r.irpj_devido ?? 0) + (r.csll_devida ?? 0);
      saldoProximo = r.saldo_proximo;
      alertas.push(...r.alertas);
      memoriaCalculo = { tipo: 'lucro_presumido', entrada, resultado: r };

      await salvarApuracao(empresaId, competencia, {
        regime: 'presumido',
        receita_servicos: r.receita_servicos,
        receita_comercio: r.receita_comercio,
        receita_industria: r.receita_industria,
        receita_total: r.receita_total,
        base_irpj: r.base_irpj, base_csll: r.base_csll,
        pis_devido: r.pis_devido, cofins_devida: r.cofins_devida, iss_devido: r.iss_devido,
        icms_saldo_anterior: r.icms_saldo_anterior, icms_debitos: r.icms_debitos,
        icms_creditos: r.icms_creditos, icms_devido: r.icms_devido, icms_saldo_credor: r.icms_saldo_credor,
        irpj_devido: r.irpj_devido, csll_devida: r.csll_devida, irpj_adicional: r.irpj_adicional,
        trimestre,
        ret_pis: totais.ret_pis, ret_cofins: totais.ret_cofins,
        ret_csll: totais.ret_csll, ret_irrf: totais.ret_irrf, ret_inss: totais.ret_inss,
        saldo_anterior: saldoAnt.saldo_ret_proximo,
        saldo_proximo: saldoProximo,
        memoria_calculo: memoriaCalculo,
        status: 'rascunho',
      });

      if (desatualizados.length) {
        const aviso = mensagemTrimestreDesatualizado(desatualizados);
        alertas.push(`TRAVA: ${aviso}`);
        status = 'retida';
        motivo = aviso;
        await query(
          `UPDATE apuracoes SET status='retida', motivo_retencao=$1 WHERE empresa_id=$2 AND competencia=$3`,
          [aviso, empresaId, competencia]
        );
      }
    }
  }

  // Trava de desvio histórico (não bloqueia se for o primeiro mês)
  if (status === 'aprovada') {
    const historico = await buscarHistoricoImposto(empresaId, competencia);
    const avisoDesvio = verificarDesvioHistorico(impostoTotal, historico);
    if (avisoDesvio) {
      alertas.push(`TRAVA: ${avisoDesvio}`);
      status = 'retida';
      motivo = avisoDesvio;
      await query(
        `UPDATE apuracoes SET status='retida', motivo_retencao=$1 WHERE empresa_id=$2 AND competencia=$3`,
        [motivo, empresaId, competencia]
      );
    }
  }

  if (status === 'retida' && motivo) {
    await query(
      `INSERT INTO fechamentos_estado (competencia, empresa_id, fase, etapa, status, detalhe)
       VALUES ($1,$2,'fase2','apuracao','retida',$3)
       ON CONFLICT (competencia, empresa_id, etapa) DO UPDATE SET status='retida', detalhe=$3, atualizado_em=NOW()`,
      [competencia, empresaId, motivo]
    );
  } else {
    await query(
      `INSERT INTO fechamentos_estado (competencia, empresa_id, fase, etapa, status)
       VALUES ($1,$2,'fase2','apuracao','ok')
       ON CONFLICT (competencia, empresa_id, etapa) DO UPDATE SET status='ok', atualizado_em=NOW()`,
      [competencia, empresaId]
    );
  }

  await query(
    `INSERT INTO audit_log (competencia, empresa_id, acao, payload, resultado)
     VALUES ($1,$2,'apuracao',$3,$4)`,
    [competencia, empresaId, JSON.stringify({ regime: empresa.regime }), status]
  );

  return {
    empresa_id: empresaId,
    cnpj: empresa.cnpj,
    nome: empresa.nome,
    status,
    motivo,
    alertas,
    resumo: memoriaCalculo['resultado'] as Record<string, unknown> | undefined,
  };
}

export async function apurar(competencia: string, empresasIds?: number[]): Promise<ResultadoApuracao[]> {
  let ids = empresasIds;
  if (!ids || ids.length === 0) {
    // Apurar todas as empresas ativas (re-apura se já existir registro)
    const r = await query<{ id: number }>(
      `SELECT id FROM empresas WHERE ativo = true ORDER BY nome`,
      []
    );
    ids = r.rows.map(row => row.id);
  }

  const resultados: ResultadoApuracao[] = [];
  for (let i = 0; i < ids.length; i += 3) {
    const lote = ids.slice(i, i + 3);
    const loteResultados = await Promise.all(
      lote.map(id =>
        apurarEmpresa(id, competencia).catch(err => ({
          empresa_id: id,
          cnpj: '',
          nome: '',
          status: 'retida' as const,
          motivo: err instanceof Error ? err.message : String(err),
          alertas: [],
        }))
      )
    );
    resultados.push(...loteResultados);
  }
  return resultados;
}
