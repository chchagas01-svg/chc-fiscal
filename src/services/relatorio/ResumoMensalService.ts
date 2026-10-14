// Resumo Mensal (totalizador) — apuração do mês acumulada até a data, por empresa,
// no formato do relatório do escritório: saídas, entradas, serviços tomados, tributos
// e valores a compensar. Roda todo dia depois da captura; o mês fecha no último dia.
//
// Regras (skill regras-fiscais-escritorio + decisões do Carlos em 14/10/2026):
// - Abate dos tributos só as retenções sofridas nos serviços PRESTADOS. Retenções feitas
//   sobre serviços TOMADOS são valores a recolher (DARF 1708/5952, GPS) e aparecem no quadro
//   de serviços tomados, sem abater nada.
// - ICMS só para empresa com Inscrição Estadual que não é do Simples.
// - IRPJ/CSLL do Presumido são trimestrais: o valor do mês é prévia; o adicional considera
//   a base acumulada do trimestre até a data.
import { query } from '../../config/database';
import { parseXml } from '../parsers';
import { classificarEntrada, cfopDeEntrada, classificarSaida, FinalidadeEntrada } from '../engine/cfop';
import { identificarTrimestre } from '../engine/lucroPresumido';

const ALIQ_PIS = 0.0065;
const ALIQ_COFINS = 0.03;
const ALIQ_IRPJ = 0.15;
const ALIQ_IRPJ_ADICIONAL = 0.10;
const LIMITE_ADICIONAL_MES = 20_000;   // R$ 60.000 por trimestre
const ALIQ_CSLL = 0.09;
const PRESUNCAO_CSLL_MERCADORIAS = 0.12;

const r2 = (v: number) => Math.round(v * 100) / 100;

// ── Tipos de entrada (linhas do banco) ─────────────────────────────────────────

export interface EmpresaResumo {
  id: number;
  cnpj: string;
  nome: string;
  regime: 'simples' | 'presumido';
  inscricao_estadual: string | null;
  tem_difal: boolean;
  presuncao_servicos: number | null;
  presuncao_comercio: number | null;
  presuncao_industria: number | null;
  presuncao_irpj: number | null;
  presuncao_csll: number | null;
  aliquota_iss: number | null;
}

export interface NotaResumo {
  tipo_doc: string;
  numero: string | null;
  serie: string | null;
  natureza: string;
  cfop: string | null;
  valor_bruto: number;
  iss_retido: boolean;
  valor_iss: number;
  ret_pis: number;
  ret_cofins: number;
  ret_csll: number;
  ret_irrf: number;
  ret_inss: number;
  icms_debito: number;
  icms_credito: number;
  cancelada: boolean;
  // Compras de NF-e: itens lidos do XML (CFOP do fornecedor, valor, ICMS)
  itens?: { cfop: string; valor: number; icms: number }[];
}

export interface SaldosAnteriores {
  icms_saldo_credor: number;
  // Retenções sofridas que sobraram de meses anteriores
  retencoes: { pis: number; cofins: number; csll: number; irrf: number };
  // Bases de IRPJ dos meses anteriores do mesmo trimestre (para o adicional)
  base_irpj_trimestre_anterior: number;
}

// ── Formato do relatório ───────────────────────────────────────────────────────

export interface LinhaSaida {
  descricao: string;
  quantidade: number;
  numero_inicial: string | null;
  numero_final: string | null;
  canceladas: string[];
  faltando_na_sequencia: string[];
  icms: number;
  valor: number;
}

export interface LinhaTributo {
  tributo: string;
  aliquota: number | null;
  base: number;
  apurado: number;
  deducoes: number;   // retenções sofridas (federais/ISS) ou créditos (ICMS)
  a_recolher: number;
  observacao?: string;
}

export interface ResumoMensal {
  empresa: { id: number; cnpj: string; nome: string; regime: string; inscricao_estadual: string | null };
  competencia: string;
  apurado_ate: string;
  mes_fechado: boolean;
  saidas: { linhas: LinhaSaida[]; total_icms: number; total_faturamento: number; outras_saidas: number };
  entradas: {
    compras: { finalidade: FinalidadeEntrada; descricao: string; icms: number; valor: number }[];
    total_icms: number;
    total_compras: number;
    servicos_tomados: {
      quantidade: number; valor: number; irrf: number; csrf: number; inss: number; issqn: number;
    };
  };
  tributos: {
    federais: LinhaTributo[];
    estaduais: LinhaTributo[];
    municipais: LinhaTributo[];
    total_federais: number;
    total_estaduais: number;
    total_municipais: number;
    total_devido: number;
  } | null;
  retencoes_a_recolher: { irrf: number; csrf: number; inss: number; issqn: number; total: number };
  valores_a_compensar: { pis: number; cofins: number; irpj: number; csll: number; icms: number; issqn: number };
  alertas: string[];
}

const DESCRICAO_FINALIDADE: Record<FinalidadeEntrada, string> = {
  revenda: 'Compras para revenda',
  industrializacao: 'Compras para industrialização',
  ativo: 'Compras ativo imobilizado',
  outras: 'Outras compras',
};

// ── Cálculo (puro, sem banco) ──────────────────────────────────────────────────

function numeroInt(n: string | null): number | null {
  const v = parseInt((n ?? '').replace(/\D/g, ''), 10);
  return isNaN(v) ? null : v;
}

function linhaSaida(descricao: string, notas: NotaResumo[], alertas: string[]): LinhaSaida {
  const nums = notas.map(n => numeroInt(n.numero)).filter((v): v is number => v != null);
  const ativas = notas.filter(n => !n.cancelada);
  const min = nums.length ? Math.min(...nums) : null;
  const max = nums.length ? Math.max(...nums) : null;

  // Buracos na numeração: nota emitida e ainda não capturada (ou de outra série)
  const faltando: string[] = [];
  if (min != null && max != null && max - min < 5000) {
    const set = new Set(nums);
    for (let i = min; i <= max; i++) if (!set.has(i)) faltando.push(String(i));
  }
  if (faltando.length) {
    alertas.push(`${descricao}: ${faltando.length} número(s) faltando na sequência (${faltando.slice(0, 10).join(', ')}${faltando.length > 10 ? '…' : ''}). Conferir captura ou cancelamento.`);
  }

  return {
    descricao,
    quantidade: ativas.length,
    numero_inicial: min != null ? String(min) : null,
    numero_final: max != null ? String(max) : null,
    canceladas: notas.filter(n => n.cancelada).map(n => n.numero ?? '?'),
    faltando_na_sequencia: faltando,
    icms: r2(ativas.reduce((s, n) => s + n.icms_debito, 0)),
    valor: r2(ativas.reduce((s, n) => s + n.valor_bruto, 0)),
  };
}

function deduzir(apurado: number, disponivel: number) {
  const deducao = r2(Math.min(apurado, disponivel));
  return { deducao, a_recolher: r2(apurado - deducao), sobra: r2(disponivel - deducao) };
}

export function montarResumo(
  empresa: EmpresaResumo,
  competencia: string,
  apuradoAte: string,
  notas: NotaResumo[],
  saldos: SaldosAnteriores,
): ResumoMensal {
  const alertas: string[] = [];
  const temIcms = empresa.regime !== 'simples' && Boolean(empresa.inscricao_estadual?.trim());
  const [ano, mes] = competencia.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(ano!, mes!, 0)).toISOString().substring(0, 10);

  // ── Saídas ──
  const vendas = notas.filter(n => n.natureza === 'venda' && (n.tipo_doc === 'nfe' || n.tipo_doc === 'nfce'));
  const prestados = notas.filter(n => n.natureza === 'servico_prestado');
  const outrasSaidas = notas.filter(n => n.natureza === 'outro' && !n.cancelada);

  const linhasSaida: LinhaSaida[] = [];
  // Numeração é por modelo: NF-e e NFC-e em linhas separadas quando existirem as duas
  const vendasNfe = vendas.filter(n => n.tipo_doc === 'nfe');
  const vendasNfce = vendas.filter(n => n.tipo_doc === 'nfce');
  if (vendasNfe.length || !vendasNfce.length) linhasSaida.push(linhaSaida('Vendas de mercadorias', vendasNfe, alertas));
  if (vendasNfce.length) linhasSaida.push(linhaSaida('Vendas de mercadorias (NFC-e)', vendasNfce, alertas));
  linhasSaida.push(linhaSaida('Prestação de serviços', prestados, alertas));
  if (!temIcms) for (const l of linhasSaida) l.icms = 0;

  const receitaComercio = r2(vendas.filter(n => !n.cancelada && classificarSaida(n.cfop) === 'comercio').reduce((s, n) => s + n.valor_bruto, 0));
  const receitaIndustria = r2(vendas.filter(n => !n.cancelada && classificarSaida(n.cfop) === 'industria').reduce((s, n) => s + n.valor_bruto, 0));
  const receitaServicos = r2(prestados.filter(n => !n.cancelada).reduce((s, n) => s + n.valor_bruto, 0));
  const faturamento = r2(receitaComercio + receitaIndustria + receitaServicos);
  const icmsDebito = r2(linhasSaida.reduce((s, l) => s + l.icms, 0));

  // ── Entradas: compras por finalidade (por item, a partir do CFOP do fornecedor) ──
  const compras = notas.filter(n => n.natureza === 'compra' && !n.cancelada);
  const porFinalidade: Record<FinalidadeEntrada, { icms: number; valor: number }> = {
    revenda: { icms: 0, valor: 0 }, industrializacao: { icms: 0, valor: 0 },
    ativo: { icms: 0, valor: 0 }, outras: { icms: 0, valor: 0 },
  };
  for (const c of compras) {
    const itens = c.itens?.length ? c.itens : [{ cfop: c.cfop ?? '', valor: c.valor_bruto, icms: c.icms_credito }];
    for (const it of itens) {
      const f = classificarEntrada(cfopDeEntrada(it.cfop));
      porFinalidade[f].valor += it.valor;
      porFinalidade[f].icms += it.icms;
    }
  }
  // Uso e consumo ("outras") não dá crédito de ICMS
  const icmsOutras = r2(porFinalidade.outras.icms);
  if (temIcms && icmsOutras > 0) {
    alertas.push(`ICMS de R$ ${icmsOutras.toFixed(2)} em outras compras (uso/consumo) não foi creditado.`);
  }
  const linhasCompra = (Object.keys(porFinalidade) as FinalidadeEntrada[]).map(f => ({
    finalidade: f,
    descricao: DESCRICAO_FINALIDADE[f],
    icms: temIcms && f !== 'outras' ? r2(porFinalidade[f].icms) : 0,
    valor: r2(porFinalidade[f].valor),
  }));
  const icmsCredito = r2(linhasCompra.reduce((s, l) => s + l.icms, 0));

  // ── Serviços tomados (retenções feitas pela empresa → a recolher) ──
  const tomados = notas.filter(n => n.natureza === 'servico_tomado' && !n.cancelada);
  const tom = {
    quantidade: tomados.length,
    valor: r2(tomados.reduce((s, n) => s + n.valor_bruto, 0)),
    irrf: r2(tomados.reduce((s, n) => s + n.ret_irrf, 0)),
    csrf: r2(tomados.reduce((s, n) => s + n.ret_pis + n.ret_cofins + n.ret_csll, 0)),
    inss: r2(tomados.reduce((s, n) => s + n.ret_inss, 0)),
    issqn: r2(tomados.filter(n => n.iss_retido).reduce((s, n) => s + n.valor_iss, 0)),
  };
  const retencoesARecolher = { irrf: tom.irrf, csrf: tom.csrf, inss: tom.inss, issqn: tom.issqn,
    total: r2(tom.irrf + tom.csrf + tom.inss + tom.issqn) };

  if (faturamento === 0 && compras.length === 0 && tomados.length === 0) {
    alertas.push('Sem movimento capturado até a data.');
  }

  const resumoBase = {
    empresa: { id: empresa.id, cnpj: empresa.cnpj, nome: empresa.nome, regime: empresa.regime,
      inscricao_estadual: empresa.inscricao_estadual },
    competencia,
    apurado_ate: apuradoAte,
    mes_fechado: apuradoAte >= ultimoDia,
    saidas: { linhas: linhasSaida, total_icms: icmsDebito, total_faturamento: faturamento,
      outras_saidas: r2(outrasSaidas.reduce((s, n) => s + n.valor_bruto, 0)) },
    entradas: { compras: linhasCompra, total_icms: icmsCredito,
      total_compras: r2(linhasCompra.reduce((s, l) => s + l.valor, 0)), servicos_tomados: tom },
    retencoes_a_recolher: retencoesARecolher,
  };

  if (empresa.regime === 'simples') {
    alertas.push('Simples Nacional: tributos apurados pelo DAS (módulo de apuração), não por este quadro.');
    return { ...resumoBase, tributos: null,
      valores_a_compensar: { pis: 0, cofins: 0, irpj: 0, csll: 0, icms: 0, issqn: 0 }, alertas };
  }

  // ── Tributos federais (Lucro Presumido cumulativo) ──
  const ativosPrest = prestados.filter(n => !n.cancelada);
  const retSofrida = {
    pis: r2(saldos.retencoes.pis + ativosPrest.reduce((s, n) => s + n.ret_pis, 0)),
    cofins: r2(saldos.retencoes.cofins + ativosPrest.reduce((s, n) => s + n.ret_cofins, 0)),
    csll: r2(saldos.retencoes.csll + ativosPrest.reduce((s, n) => s + n.ret_csll, 0)),
    irrf: r2(saldos.retencoes.irrf + ativosPrest.reduce((s, n) => s + n.ret_irrf, 0)),
  };

  const presServ = empresa.presuncao_irpj ?? empresa.presuncao_servicos ?? 0.32;
  const baseIrpj = r2(receitaServicos * presServ +
    receitaComercio * (empresa.presuncao_comercio ?? 0.08) +
    receitaIndustria * (empresa.presuncao_industria ?? 0.08));
  const baseCsll = r2(receitaServicos * (empresa.presuncao_csll ?? 0.32) +
    (receitaComercio + receitaIndustria) * PRESUNCAO_CSLL_MERCADORIAS);

  const pisApurado = r2(faturamento * ALIQ_PIS);
  const cofinsApurado = r2(faturamento * ALIQ_COFINS);
  const irpjApurado = r2(baseIrpj * ALIQ_IRPJ);
  // Adicional: 10% sobre o que a base do trimestre até agora passa de R$ 20 mil por mês decorrido
  const mesNoTrim = ((mes! - 1) % 3) + 1;
  const baseTrim = r2(saldos.base_irpj_trimestre_anterior + baseIrpj);
  const adicionalTrim = r2(Math.max(0, baseTrim - LIMITE_ADICIONAL_MES * mesNoTrim) * ALIQ_IRPJ_ADICIONAL);
  const csllApurado = r2(baseCsll * ALIQ_CSLL);

  const dPis = deduzir(pisApurado, retSofrida.pis);
  const dCofins = deduzir(cofinsApurado, retSofrida.cofins);
  const dIrpj = deduzir(r2(irpjApurado + adicionalTrim), retSofrida.irrf);
  const dCsll = deduzir(csllApurado, retSofrida.csll);

  const trimestre = identificarTrimestre(competencia);
  const obsTrim = `Prévia: IRPJ/CSLL vencem no fechamento do ${trimestre.split('-T')[1]}º trimestre.`;
  const federais: LinhaTributo[] = [
    { tributo: 'PIS Faturamento', aliquota: ALIQ_PIS, base: faturamento, apurado: pisApurado, deducoes: dPis.deducao, a_recolher: dPis.a_recolher },
    { tributo: 'COFINS Faturamento', aliquota: ALIQ_COFINS, base: faturamento, apurado: cofinsApurado, deducoes: dCofins.deducao, a_recolher: dCofins.a_recolher },
    { tributo: 'IRPJ Presumido', aliquota: ALIQ_IRPJ, base: baseIrpj, apurado: irpjApurado, deducoes: 0, a_recolher: 0, observacao: obsTrim },
    { tributo: 'Adicional do IRPJ', aliquota: ALIQ_IRPJ_ADICIONAL, base: baseTrim, apurado: adicionalTrim, deducoes: 0, a_recolher: 0,
      observacao: `Base do trimestre até a data; isenção de R$ ${(LIMITE_ADICIONAL_MES * mesNoTrim).toLocaleString('pt-BR')}.` },
    { tributo: 'CSLL Presumido', aliquota: ALIQ_CSLL, base: baseCsll, apurado: csllApurado, deducoes: dCsll.deducao, a_recolher: dCsll.a_recolher, observacao: obsTrim },
  ];
  // Retenção de IR abate IRPJ + adicional juntos: distribui primeiro no IRPJ
  const dedIrpjNormal = r2(Math.min(irpjApurado, dIrpj.deducao));
  federais[2]!.deducoes = dedIrpjNormal;
  federais[2]!.a_recolher = r2(irpjApurado - dedIrpjNormal);
  federais[3]!.deducoes = r2(dIrpj.deducao - dedIrpjNormal);
  federais[3]!.a_recolher = r2(adicionalTrim - federais[3]!.deducoes);

  // ── ICMS ──
  const estaduais: LinhaTributo[] = [];
  let icmsCompensar = 0;
  if (temIcms) {
    const creditos = r2(icmsCredito + saldos.icms_saldo_credor);
    const saldo = r2(icmsDebito - creditos);
    icmsCompensar = r2(Math.max(0, -saldo));
    estaduais.push({ tributo: 'ICMS', aliquota: null, base: faturamento, apurado: icmsDebito, deducoes: creditos,
      a_recolher: r2(Math.max(0, saldo)),
      observacao: saldos.icms_saldo_credor > 0 ? `Inclui saldo credor anterior de R$ ${saldos.icms_saldo_credor.toFixed(2)}.` : undefined });
    if (empresa.tem_difal) {
      estaduais.push({ tributo: 'Difal', aliquota: null, base: 0, apurado: 0, deducoes: 0, a_recolher: 0,
        observacao: 'Cálculo do Difal ainda não automatizado — conferir manualmente.' });
      alertas.push('Empresa marcada com Difal: cálculo ainda não automatizado.');
    }
  } else if (notas.some(n => n.icms_debito > 0 || n.icms_credito > 0)) {
    alertas.push('Há ICMS destacado nas notas, mas a empresa não tem Inscrição Estadual cadastrada: ICMS não apurado.');
  }

  // ── ISS próprio (abate o ISS retido pelos tomadores) ──
  const aliqIss = empresa.aliquota_iss ?? 0;
  if (receitaServicos > 0 && !empresa.aliquota_iss) alertas.push('Alíquota de ISS não cadastrada: ISS não apurado.');
  const issApurado = r2(receitaServicos * aliqIss);
  const issRetidoPorTomadores = r2(ativosPrest.filter(n => n.iss_retido).reduce((s, n) => s + n.valor_iss, 0));
  const dIss = deduzir(issApurado, issRetidoPorTomadores);
  const municipais: LinhaTributo[] = [
    { tributo: 'ISSQN Próprio', aliquota: aliqIss, base: receitaServicos, apurado: issApurado, deducoes: dIss.deducao, a_recolher: dIss.a_recolher },
  ];

  const soma = (ls: LinhaTributo[]) => r2(ls.reduce((s, l) => s + l.a_recolher, 0));
  const totalFederais = soma(federais);
  const totalEstaduais = soma(estaduais);
  const totalMunicipais = soma(municipais);

  return {
    ...resumoBase,
    tributos: {
      federais, estaduais, municipais,
      total_federais: totalFederais, total_estaduais: totalEstaduais, total_municipais: totalMunicipais,
      total_devido: r2(totalFederais + totalEstaduais + totalMunicipais),
    },
    valores_a_compensar: {
      pis: dPis.sobra, cofins: dCofins.sobra, irpj: dIrpj.sobra, csll: dCsll.sobra,
      icms: icmsCompensar, issqn: 0,
    },
    alertas,
  };
}

// ── Carga do banco ─────────────────────────────────────────────────────────────

export async function gerarResumoMensal(empresaId: number, competencia: string, ate?: string): Promise<ResumoMensal> {
  const empRes = await query<EmpresaResumo>(
    `SELECT id, cnpj, nome, regime, inscricao_estadual, tem_difal,
            presuncao_servicos::float AS presuncao_servicos, presuncao_comercio::float AS presuncao_comercio,
            presuncao_industria::float AS presuncao_industria, presuncao_irpj::float AS presuncao_irpj,
            presuncao_csll::float AS presuncao_csll, aliquota_iss::float AS aliquota_iss
       FROM empresas WHERE id = $1`,
    [empresaId]
  );
  const empresa = empRes.rows[0];
  if (!empresa) throw new Error('Empresa não encontrada');

  // Padrão: hoje, limitado ao último dia da competência (captura do mês anterior no dia 01)
  const hoje = new Date().toISOString().substring(0, 10);
  const [anoC, mesC] = competencia.split('-').map(Number);
  const ultimoDiaComp = new Date(Date.UTC(anoC!, mesC!, 0)).toISOString().substring(0, 10);
  const apuradoAte = ate ?? (hoje < ultimoDiaComp ? hoje : ultimoDiaComp);

  const notasRes = await query<Record<string, unknown>>(
    `SELECT tipo_doc, numero, serie, natureza, cfop, valor_bruto, iss_retido, valor_iss,
            ret_pis, ret_cofins, ret_csll, ret_irrf, ret_inss, icms_debito, icms_credito, cancelada,
            CASE WHEN natureza = 'compra' AND tipo_doc IN ('nfe','nfce') THEN xml_raw END AS xml_raw
       FROM notas
      WHERE empresa_id = $1 AND competencia = $2 AND data_emissao <= $3`,
    [empresaId, competencia, apuradoAte]
  );

  const notas: NotaResumo[] = [];
  for (const row of notasRes.rows) {
    const n: NotaResumo = {
      tipo_doc: String(row['tipo_doc']), numero: row['numero'] as string | null, serie: row['serie'] as string | null,
      natureza: String(row['natureza']), cfop: row['cfop'] as string | null,
      valor_bruto: Number(row['valor_bruto'] ?? 0), iss_retido: Boolean(row['iss_retido']), valor_iss: Number(row['valor_iss'] ?? 0),
      ret_pis: Number(row['ret_pis'] ?? 0), ret_cofins: Number(row['ret_cofins'] ?? 0), ret_csll: Number(row['ret_csll'] ?? 0),
      ret_irrf: Number(row['ret_irrf'] ?? 0), ret_inss: Number(row['ret_inss'] ?? 0),
      icms_debito: Number(row['icms_debito'] ?? 0), icms_credito: Number(row['icms_credito'] ?? 0),
      cancelada: Boolean(row['cancelada']),
    };
    if (row['xml_raw']) {
      try { n.itens = (await parseXml(String(row['xml_raw'])))[0]?.itens; } catch { /* usa totais da nota */ }
    }
    notas.push(n);
  }

  // Saldos do mês anterior (apuração aprovada/rascunho mais recente antes da competência)
  const antRes = await query<Record<string, unknown>>(
    `SELECT icms_saldo_credor, saldo_ret_proximo FROM apuracoes
      WHERE empresa_id = $1 AND competencia < $2 ORDER BY competencia DESC LIMIT 1`,
    [empresaId, competencia]
  );
  const ant = antRes.rows[0];
  const ret = (ant?.['saldo_ret_proximo'] ?? {}) as Record<string, number>;

  const trimestre = identificarTrimestre(competencia);
  const trimRes = await query<Record<string, unknown>>(
    `SELECT COALESCE(SUM(base_irpj), 0) AS base FROM apuracoes
      WHERE empresa_id = $1 AND trimestre = $2 AND competencia < $3`,
    [empresaId, trimestre, competencia]
  );

  return montarResumo(empresa, competencia, apuradoAte, notas, {
    icms_saldo_credor: Number(ant?.['icms_saldo_credor'] ?? 0),
    retencoes: { pis: Number(ret.pis ?? 0), cofins: Number(ret.cofins ?? 0), csll: Number(ret.csll ?? 0), irrf: Number(ret.irrf ?? 0) },
    base_irpj_trimestre_anterior: Number(trimRes.rows[0]?.['base'] ?? 0),
  });
}

// ── Rotina diária: grava o resumo de cada empresa depois da captura ─────────────

export interface ResumoGravado {
  empresa_id: number;
  nome: string;
  status: 'ok' | 'erro';
  apurado_ate?: string;
  total_faturamento?: number;
  total_devido?: number | null;
  alertas?: number;
  erro?: string;
}

export async function gravarResumosDoDia(competencia: string, empresaIds: number[]): Promise<ResumoGravado[]> {
  const saida: ResumoGravado[] = [];
  for (const id of empresaIds) {
    try {
      const r = await gerarResumoMensal(id, competencia);
      await query(
        `INSERT INTO resumos_mensais (empresa_id, competencia, apurado_ate, mes_fechado, total_faturamento, total_devido, qtd_alertas, dados)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (empresa_id, competencia, apurado_ate) DO UPDATE SET
           mes_fechado = EXCLUDED.mes_fechado, total_faturamento = EXCLUDED.total_faturamento,
           total_devido = EXCLUDED.total_devido, qtd_alertas = EXCLUDED.qtd_alertas,
           dados = EXCLUDED.dados, gerado_em = NOW()`,
        [id, competencia, r.apurado_ate, r.mes_fechado, r.saidas.total_faturamento,
         r.tributos?.total_devido ?? null, r.alertas.length, JSON.stringify(r)]
      );
      saida.push({ empresa_id: id, nome: r.empresa.nome, status: 'ok', apurado_ate: r.apurado_ate,
        total_faturamento: r.saidas.total_faturamento, total_devido: r.tributos?.total_devido ?? null,
        alertas: r.alertas.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[resumo] empresa ${id} ${competencia}: ${msg}`);
      saida.push({ empresa_id: id, nome: '', status: 'erro', erro: msg });
    }
  }
  return saida;
}
