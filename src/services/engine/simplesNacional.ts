import { AnexoSimples, calcularAliquotaEfetiva, FATOR_R_MINIMO, LIMITE_SIMPLES } from './tabelasSimples';

export interface SaldoRetencoes {
  pis: number;
  cofins: number;
  csll: number;
  irrf: number;
  inss: number;
}

export interface EntradaSimples {
  receita_bruta_mes: number;      // Total da competência (serviços + comércio)
  rbt12: number;                  // Receita bruta acumulada 12 meses
  folha_12meses: number;          // Folha acumulada 12 meses (CPP incluído)
  anexo: AnexoSimples;            // Anexo principal da empresa
  retencoes_mes: SaldoRetencoes;
  saldo_anterior: SaldoRetencoes;
  iss_retido_tomador: number;     // ISS retido pelo tomador (reduz DAS)

  // Empresa mista: breakdown por atividade para DAS separado por anexo
  receita_servicos_mes?: number;
  receita_comercio_mes?: number;
  anexo_comercio?: AnexoSimples;  // Ex: 'I' para comércio quando empresa tem Anexo III + I
}

export interface ResultadoSimples {
  // Inputs confirmados
  rbt12: number;
  folha_12meses: number;
  fator_r: number;
  anexo_aplicado: AnexoSimples;
  faixa: number;

  // Cálculo
  aliquota_nominal: number;
  parcela_dedutivel: number;
  aliquota_efetiva: number;
  das_bruto: number;
  das_deducoes: number;
  das_devido: number;

  // Empresa mista: breakdown por atividade
  das_servicos?: number;
  das_comercio?: number;
  aliquota_efetiva_comercio?: number;

  // Deduções detalhadas
  ded_iss_retido: number;
  ded_pis: number;
  ded_cofins: number;
  ded_csll: number;
  ded_irrf: number;
  ded_inss: number;

  saldo_proximo: SaldoRetencoes;
  alertas: string[];
}

export interface TravaSimples {
  tipo: 'erro_base' | 'limite_excedido' | 'resultado_negativo';
  mensagem: string;
}

export type ResultadoOuTrava = { ok: true; resultado: ResultadoSimples } | { ok: false; trava: TravaSimples };

function arredondar2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function calcularSimples(entrada: EntradaSimples): ResultadoOuTrava {
  const alertas: string[] = [];

  if (entrada.rbt12 <= 0) {
    return { ok: false, trava: { tipo: 'erro_base', mensagem: 'RBT12 não informado ou zero. Necessário para apuração do Simples Nacional.' } };
  }
  if (entrada.receita_bruta_mes < 0) {
    return { ok: false, trava: { tipo: 'resultado_negativo', mensagem: 'Receita bruta do mês negativa — verificar notas.' } };
  }
  if (entrada.rbt12 > LIMITE_SIMPLES) {
    return { ok: false, trava: { tipo: 'limite_excedido', mensagem: `RBT12 (R$ ${entrada.rbt12.toFixed(2)}) excede o limite do Simples Nacional (R$ ${LIMITE_SIMPLES.toFixed(2)}).` } };
  }

  // Fator R — só comuta III ↔ V se houver dado de folha; sem folha, respeita o anexo cadastrado
  let anexoAplicado = entrada.anexo;
  const fatorR = entrada.rbt12 > 0 ? arredondar2(entrada.folha_12meses / entrada.rbt12) : 0;

  if (entrada.folha_12meses > 0 && (entrada.anexo === 'III' || entrada.anexo === 'V')) {
    if (fatorR >= FATOR_R_MINIMO) {
      anexoAplicado = 'III';
      if (entrada.anexo === 'V') alertas.push(`Fator R = ${(fatorR * 100).toFixed(2)}% (≥ 28%): aplicado Anexo III.`);
    } else {
      anexoAplicado = 'V';
      if (entrada.anexo === 'III') alertas.push(`Fator R = ${(fatorR * 100).toFixed(2)}% (< 28%): aplicado Anexo V.`);
    }
  } else if (entrada.folha_12meses === 0 && (entrada.anexo === 'III' || entrada.anexo === 'V')) {
    alertas.push(`Fator R não calculado — folha não informada. Usando Anexo ${entrada.anexo} conforme cadastro.`);
  }

  // Alíquota efetiva do anexo principal (serviços)
  const calc = calcularAliquotaEfetiva(anexoAplicado, entrada.rbt12);
  if (!calc) {
    return { ok: false, trava: { tipo: 'erro_base', mensagem: `Faixa não encontrada para Anexo ${anexoAplicado}, RBT12 = R$ ${entrada.rbt12.toFixed(2)}.` } };
  }

  // DAS bruto — empresa mista calcula por atividade; empresa única usa receita total
  let dasBruto: number;
  let dasServicos: number | undefined;
  let dasComercios: number | undefined;
  let aliqEfetivaCom: number | undefined;

  if (
    entrada.anexo_comercio &&
    entrada.receita_servicos_mes != null &&
    entrada.receita_comercio_mes != null
  ) {
    const calcCom = calcularAliquotaEfetiva(entrada.anexo_comercio, entrada.rbt12);
    if (!calcCom) {
      return { ok: false, trava: { tipo: 'erro_base', mensagem: `Faixa não encontrada para Anexo ${entrada.anexo_comercio} (comércio), RBT12 = R$ ${entrada.rbt12.toFixed(2)}.` } };
    }
    dasServicos  = arredondar2(entrada.receita_servicos_mes * calc.aliquotaEfetiva);
    dasComercios = arredondar2(entrada.receita_comercio_mes * calcCom.aliquotaEfetiva);
    dasBruto     = arredondar2(dasServicos + dasComercios);
    aliqEfetivaCom = arredondar2(calcCom.aliquotaEfetiva * 10_000) / 10_000;
    alertas.push(
      `Empresa mista — Serviços Anexo ${anexoAplicado} (${(calc.aliquotaEfetiva * 100).toFixed(4)}%): R$ ${dasServicos.toFixed(2)} | ` +
      `Comércio Anexo ${entrada.anexo_comercio} (${(calcCom.aliquotaEfetiva * 100).toFixed(4)}%): R$ ${dasComercios.toFixed(2)}.`
    );
    if (entrada.receita_comercio_mes > 0) {
      alertas.push(`ICMS: embutido na alíquota do Anexo ${entrada.anexo_comercio}. Verificar ICMS-ST se houver mercadorias com substituição tributária.`);
    }
  } else {
    dasBruto = arredondar2(entrada.receita_bruta_mes * calc.aliquotaEfetiva);
  }

  const dedIssRetido = arredondar2(Math.min(entrada.iss_retido_tomador, dasBruto));

  const retencaoTotal = {
    pis:    arredondar2(entrada.saldo_anterior.pis    + entrada.retencoes_mes.pis),
    cofins: arredondar2(entrada.saldo_anterior.cofins + entrada.retencoes_mes.cofins),
    csll:   arredondar2(entrada.saldo_anterior.csll   + entrada.retencoes_mes.csll),
    irrf:   arredondar2(entrada.saldo_anterior.irrf   + entrada.retencoes_mes.irrf),
    inss:   arredondar2(entrada.saldo_anterior.inss   + entrada.retencoes_mes.inss),
  };

  let baseDisponivel = arredondar2(dasBruto - dedIssRetido);

  function deduzir(valor: number): { deduzido: number; saldoProximo: number } {
    const deduzido = arredondar2(Math.min(valor, baseDisponivel));
    baseDisponivel = arredondar2(baseDisponivel - deduzido);
    return { deduzido, saldoProximo: arredondar2(valor - deduzido) };
  }

  const { deduzido: dedPis,    saldoProximo: saldoPis    } = deduzir(retencaoTotal.pis);
  const { deduzido: dedCofins, saldoProximo: saldoCofins } = deduzir(retencaoTotal.cofins);
  const { deduzido: dedCsll,   saldoProximo: saldoCsll   } = deduzir(retencaoTotal.csll);
  const { deduzido: dedIrrf,   saldoProximo: saldoIrrf   } = deduzir(retencaoTotal.irrf);
  const { deduzido: dedInss,   saldoProximo: saldoInss   } = deduzir(retencaoTotal.inss);

  const dasDeducoes = arredondar2(dedIssRetido + dedPis + dedCofins + dedCsll + dedIrrf + dedInss);
  const dasDEvido   = arredondar2(Math.max(0, dasBruto - dasDeducoes));

  if (dasBruto > 0 && dasDEvido < 0) {
    alertas.push('DAS resultou negativo — verificar retenções informadas.');
  }
  if (saldoPis + saldoCofins + saldoCsll + saldoIrrf + saldoInss > 0) {
    alertas.push('Retenções excedem o DAS do mês — saldo acumulado para próximo mês.');
  }

  return {
    ok: true,
    resultado: {
      rbt12: entrada.rbt12,
      folha_12meses: entrada.folha_12meses,
      fator_r: fatorR,
      anexo_aplicado: anexoAplicado,
      faixa: calc.faixa,
      aliquota_nominal: calc.aliquotaNominal,
      parcela_dedutivel: calc.parcelaDedutivel,
      aliquota_efetiva: arredondar2(calc.aliquotaEfetiva * 10_000) / 10_000,
      das_bruto: dasBruto,
      das_deducoes: dasDeducoes,
      das_devido: dasDEvido,
      das_servicos: dasServicos,
      das_comercio: dasComercios,
      aliquota_efetiva_comercio: aliqEfetivaCom,
      ded_iss_retido: dedIssRetido,
      ded_pis: dedPis,
      ded_cofins: dedCofins,
      ded_csll: dedCsll,
      ded_irrf: dedIrrf,
      ded_inss: dedInss,
      saldo_proximo: { pis: saldoPis, cofins: saldoCofins, csll: saldoCsll, irrf: saldoIrrf, inss: saldoInss },
      alertas,
    },
  };
}
