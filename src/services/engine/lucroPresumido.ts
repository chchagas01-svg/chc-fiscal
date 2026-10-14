import { SaldoRetencoes } from './simplesNacional';

// Alíquotas fixas Lucro Presumido cumulativo
const ALIQ_PIS = 0.0065;    // 0,65%
const ALIQ_COFINS = 0.03;   // 3,00%
const ALIQ_IRPJ = 0.15;     // 15%
const ALIQ_IRPJ_ADICIONAL = 0.10; // 10% sobre base trimestral > R$60.000
const ALIQ_CSLL = 0.09;     // 9%
const LIMITE_ADICIONAL_IRPJ = 60_000; // R$ por trimestre
const PRESUNCAO_CSLL_MERCADORIAS = 0.12;

export type MesTrimestre = 1 | 2 | 3; // posição do mês dentro do trimestre

export interface EntradaPresumido {
  receita_servicos: number;
  receita_comercio: number;
  receita_industria: number;

  // Presunções configuradas na empresa (ex: 0.32, 0.08)
  presuncao_servicos: number;    // base IRPJ sobre serviços
  presuncao_comercio: number;    // base IRPJ sobre comércio
  presuncao_industria: number;   // base IRPJ sobre indústria
  presuncao_irpj: number;        // presunção IRPJ (pode ser reduzida — hospital: 8%)
  presuncao_csll: number;        // presunção CSLL (hospital: 12%)

  aliquota_iss: number;          // alíquota ISS municipal da empresa
  mes_do_trimestre: MesTrimestre; // 1=primeiro, 2=segundo, 3=último do trim

  // Trimestre acumulado (bases Jul+Ago quando processando Set)
  base_irpj_acumulada_trim: number;
  base_csll_acumulada_trim: number;

  // ICMS
  icms_saldo_anterior: number;
  icms_debitos_mes: number;   // soma ICMS nas NF-e de saída
  icms_creditos_mes: number;  // soma ICMS nas NF-e de entrada

  // Retenções
  retencoes_mes: SaldoRetencoes;
  saldo_anterior: SaldoRetencoes;

  // Empresas com receita anual > R$5M pagam adicional de IRPJ sobre a base inteira
  irpj_adicional_sobre_base_total?: boolean;
}

export interface ResultadoPresumido {
  // Receitas
  receita_total: number;
  receita_servicos: number;
  receita_comercio: number;
  receita_industria: number;

  // Bases de cálculo
  base_irpj: number;
  base_csll: number;

  // Tributos mensais
  pis_bruto: number;
  pis_devido: number;
  cofins_bruto: number;
  cofins_devida: number;
  iss_bruto: number;
  iss_devido: number;

  // ICMS
  icms_saldo_anterior: number;
  icms_debitos: number;
  icms_creditos: number;
  icms_apurado: number;      // débito - crédito - saldo anterior
  icms_devido: number;       // max(0, apurado)
  icms_saldo_credor: number; // max(0, -apurado)

  // IRPJ/CSLL — apenas no último mês do trimestre
  trimestre_fechado: boolean;
  irpj_bruto: number | null;
  irpj_adicional: number | null;
  irpj_devido: number | null;
  csll_bruta: number | null;
  csll_devida: number | null;
  base_irpj_trim: number | null;
  base_csll_trim: number | null;

  // Retenções deduzidas por imposto
  ret_pis_deduzida: number;
  ret_cofins_deduzida: number;
  ret_csll_deduzida: number;
  ret_irpj_deduzida: number;
  ret_inss_deduzida: number;

  saldo_proximo: SaldoRetencoes;
  alertas: string[];
}

export interface TravaPresumido {
  tipo: 'erro_base' | 'resultado_negativo' | 'icms_inconsistente';
  mensagem: string;
}

export type ResultadoOuTravaPresumido =
  | { ok: true; resultado: ResultadoPresumido }
  | { ok: false; trava: TravaPresumido };

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

function deduzirRetencao(
  impostoDevido: number,
  saldoRet: number
): { deducao: number; impostoFinal: number; saldoProximo: number } {
  const deducao = r2(Math.min(saldoRet, impostoDevido));
  return {
    deducao,
    impostoFinal: r2(Math.max(0, impostoDevido - deducao)),
    saldoProximo: r2(saldoRet - deducao),
  };
}

export function calcularPresumido(entrada: EntradaPresumido): ResultadoOuTravaPresumido {
  const alertas: string[] = [];

  if (entrada.receita_servicos < 0 || entrada.receita_comercio < 0) {
    return { ok: false, trava: { tipo: 'resultado_negativo', mensagem: 'Receita negativa — verificar notas.' } };
  }

  const receitaTotal = r2(entrada.receita_servicos + entrada.receita_comercio + entrada.receita_industria);
  const baseIrpj = r2(
    entrada.receita_servicos * entrada.presuncao_irpj +
    entrada.receita_comercio * entrada.presuncao_comercio +
    entrada.receita_industria * entrada.presuncao_industria
  );
  // CSLL: presunção da empresa só sobre serviços; venda de mercadorias/produtos é sempre 12%
  const baseCsll = r2(
    entrada.receita_servicos * entrada.presuncao_csll +
    (entrada.receita_comercio + entrada.receita_industria) * PRESUNCAO_CSLL_MERCADORIAS
  );

  // PIS e COFINS (cumulativo — sempre mensais)
  const pisBruto = r2(receitaTotal * ALIQ_PIS);
  const cofinsBruto = r2(receitaTotal * ALIQ_COFINS);
  const issBruto = r2(entrada.receita_servicos * entrada.aliquota_iss);

  // ICMS
  const icmsApurado = r2(entrada.icms_debitos_mes - entrada.icms_creditos_mes - entrada.icms_saldo_anterior);
  const icmsDevido = r2(Math.max(0, icmsApurado));
  const icmsSaldoCredor = r2(Math.max(0, -icmsApurado));

  // Saldo de retenções: anterior + mês
  const ret = {
    pis:    r2(entrada.saldo_anterior.pis    + entrada.retencoes_mes.pis),
    cofins: r2(entrada.saldo_anterior.cofins + entrada.retencoes_mes.cofins),
    csll:   r2(entrada.saldo_anterior.csll   + entrada.retencoes_mes.csll),
    irrf:   r2(entrada.saldo_anterior.irrf   + entrada.retencoes_mes.irrf),
    inss:   r2(entrada.saldo_anterior.inss   + entrada.retencoes_mes.inss),
  };

  // Deduzir retenções de cada imposto correspondente
  const { deducao: dedPis,    impostoFinal: pisFinal,    saldoProximo: spPis    } = deduzirRetencao(pisBruto, ret.pis);
  const { deducao: dedCofins, impostoFinal: cofinsFinal, saldoProximo: spCofins } = deduzirRetencao(cofinsBruto, ret.cofins);

  // ISS: deduções de CSLL, IRRF e INSS não afetam ISS — mantidas separadas
  const issDevido = issBruto; // ISS não tem dedução de retenção federal direto

  // IRPJ e CSLL — somente no último mês do trimestre
  let irpjBruto: number | null = null;
  let irpjAdicional: number | null = null;
  let irpjDevido: number | null = null;
  let csllBruta: number | null = null;
  let csllDevida: number | null = null;
  let baseIrpjTrim: number | null = null;
  let baseCsllTrim: number | null = null;
  let spCsll = ret.csll;
  let spIrrf = ret.irrf;
  let spInss = ret.inss;

  if (entrada.mes_do_trimestre === 3) {
    baseIrpjTrim = r2(entrada.base_irpj_acumulada_trim + baseIrpj);
    baseCsllTrim = r2(entrada.base_csll_acumulada_trim + baseCsll);

    irpjBruto = r2(baseIrpjTrim * ALIQ_IRPJ);

    if (entrada.irpj_adicional_sobre_base_total) {
      // Receita anual > R$5M: adicional de 10% sobre a base integral (sem franquia de R$60k)
      irpjAdicional = r2(baseIrpjTrim * ALIQ_IRPJ_ADICIONAL);
      alertas.push(`Adicional de IRPJ: R$ ${irpjAdicional.toFixed(2)} — base integral (receita anual > R$ 5.000.000).`);
    } else {
      irpjAdicional = r2(Math.max(0, baseIrpjTrim - LIMITE_ADICIONAL_IRPJ) * ALIQ_IRPJ_ADICIONAL);
      if (irpjAdicional > 0) {
        alertas.push(`Adicional de IRPJ: R$ ${irpjAdicional.toFixed(2)} (base trimestral R$ ${baseIrpjTrim.toFixed(2)} > R$ 60.000).`);
      }
    }

    const irpjTotal = r2(irpjBruto + irpjAdicional);

    csllBruta = r2(baseCsllTrim * ALIQ_CSLL);

    // Dedução de CSLL e IRRF das suas retenções respectivas
    const { deducao: dedCsll, impostoFinal: csllFinal, saldoProximo: spCsllLocal } = deduzirRetencao(csllBruta, ret.csll);
    const { deducao: dedIrrf, impostoFinal: irpjFinal, saldoProximo: spIrrfLocal } = deduzirRetencao(irpjTotal, ret.irrf);

    irpjDevido = irpjFinal;
    csllDevida = csllFinal;
    spCsll = spCsllLocal;
    spIrrf = spIrrfLocal;
  } else {
    alertas.push(`Mês ${entrada.mes_do_trimestre}/3 do trimestre — IRPJ e CSLL serão calculados no 3º mês.`);
  }

  const saldoProximo: SaldoRetencoes = {
    pis:    spPis,
    cofins: spCofins,
    csll:   spCsll,
    irrf:   spIrrf,
    inss:   spInss,
  };

  if (Object.values(saldoProximo).some(v => v > 0)) {
    alertas.push('Retenções com saldo a carregar para o próximo mês.');
  }

  return {
    ok: true,
    resultado: {
      receita_total: receitaTotal,
      receita_servicos: entrada.receita_servicos,
      receita_comercio: entrada.receita_comercio,
      receita_industria: entrada.receita_industria,
      base_irpj: baseIrpj,
      base_csll: baseCsll,
      pis_bruto: pisBruto,
      pis_devido: pisFinal,
      cofins_bruto: cofinsBruto,
      cofins_devida: cofinsFinal,
      iss_bruto: issBruto,
      iss_devido: issDevido,
      icms_saldo_anterior: entrada.icms_saldo_anterior,
      icms_debitos: entrada.icms_debitos_mes,
      icms_creditos: entrada.icms_creditos_mes,
      icms_apurado: icmsApurado,
      icms_devido: icmsDevido,
      icms_saldo_credor: icmsSaldoCredor,
      trimestre_fechado: entrada.mes_do_trimestre === 3,
      irpj_bruto: irpjBruto,
      irpj_adicional: irpjAdicional,
      irpj_devido: irpjDevido,
      csll_bruta: csllBruta,
      csll_devida: csllDevida,
      base_irpj_trim: baseIrpjTrim,
      base_csll_trim: baseCsllTrim,
      ret_pis_deduzida: dedPis,
      ret_cofins_deduzida: dedCofins,
      ret_csll_deduzida: entrada.mes_do_trimestre === 3 ? r2(ret.csll - spCsll) : 0,
      ret_irpj_deduzida: entrada.mes_do_trimestre === 3 ? r2(ret.irrf - spIrrf) : 0,
      ret_inss_deduzida: 0, // INSS não deduz imposto federal direto no Presumido
      saldo_proximo: saldoProximo,
      alertas,
    },
  };
}

// Determina qual mês do trimestre é a competência
export function mesDotrimestre(competencia: string): MesTrimestre {
  const mes = parseInt(competencia.split('-')[1] ?? '1', 10);
  const pos = ((mes - 1) % 3) + 1;
  return pos as MesTrimestre;
}

// Retorna o identificador do trimestre: '2026-T3'
export function identificarTrimestre(competencia: string): string {
  const [ano, mes] = competencia.split('-').map(Number);
  const trim = Math.ceil(mes! / 3);
  return `${ano}-T${trim}`;
}
