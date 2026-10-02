import { AnexoSimples, calcularAliquotaEfetiva, FATOR_R_MINIMO, LIMITE_SIMPLES } from './tabelasSimples';

export interface SaldoRetencoes {
  pis: number;
  cofins: number;
  csll: number;
  irrf: number;
  inss: number;
}

export interface EntradaSimples {
  receita_bruta_mes: number;     // Receita bruta da competência (sem deduções)
  rbt12: number;                 // Receita bruta acumulada 12 meses
  folha_12meses: number;         // Folha de pagamento acumulada 12 meses (CPP incluído)
  anexo: AnexoSimples;           // Anexo da empresa (III ou V quando sujeita ao Fator R)
  retencoes_mes: SaldoRetencoes; // Retenções sofridas nesta competência
  saldo_anterior: SaldoRetencoes; // Saldo acumulado do mês anterior
  // ISS específicos
  iss_retido_tomador: number;    // ISS retido pelo tomador (reduz DAS)
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

  // Deduções detalhadas
  ded_iss_retido: number;
  ded_pis: number;
  ded_cofins: number;
  ded_csll: number;
  ded_irrf: number;
  ded_inss: number;

  // Saldo para o próximo mês
  saldo_proximo: SaldoRetencoes;

  // Alertas
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

  // Validações base
  if (entrada.rbt12 <= 0) {
    return { ok: false, trava: { tipo: 'erro_base', mensagem: 'RBT12 não informado ou zero. Necessário para apuração do Simples Nacional.' } };
  }
  if (entrada.receita_bruta_mes < 0) {
    return { ok: false, trava: { tipo: 'resultado_negativo', mensagem: 'Receita bruta do mês negativa — verificar notas.' } };
  }
  if (entrada.rbt12 > LIMITE_SIMPLES) {
    return { ok: false, trava: { tipo: 'limite_excedido', mensagem: `RBT12 (R$ ${entrada.rbt12.toFixed(2)}) excede o limite do Simples Nacional (R$ ${LIMITE_SIMPLES.toFixed(2)}).` } };
  }

  // Fator R — decide se usa Anexo III ou V
  let anexoAplicado = entrada.anexo;
  const fatorR = entrada.rbt12 > 0 ? arredondar2(entrada.folha_12meses / entrada.rbt12) : 0;

  if ((entrada.anexo === 'III' || entrada.anexo === 'V')) {
    if (fatorR >= FATOR_R_MINIMO) {
      anexoAplicado = 'III';
      if (entrada.anexo === 'V') {
        alertas.push(`Fator R = ${(fatorR * 100).toFixed(2)}% (≥ 28%): aplicado Anexo III.`);
      }
    } else {
      anexoAplicado = 'V';
      if (entrada.anexo === 'III') {
        alertas.push(`Fator R = ${(fatorR * 100).toFixed(2)}% (< 28%): aplicado Anexo V.`);
      }
    }
  }

  // Alíquota efetiva
  const calc = calcularAliquotaEfetiva(anexoAplicado, entrada.rbt12);
  if (!calc) {
    return { ok: false, trava: { tipo: 'erro_base', mensagem: `Não foi possível localizar faixa do Simples para RBT12 = R$ ${entrada.rbt12.toFixed(2)}.` } };
  }

  // DAS bruto
  const dasBruto = arredondar2(entrada.receita_bruta_mes * calc.aliquotaEfetiva);

  // Deduções: ISS retido pelo tomador + retenções federais (somadas com saldo anterior)
  const dedIssRetido = arredondar2(Math.min(entrada.iss_retido_tomador, dasBruto));

  // Retenções federais: saldo anterior + retenções do mês
  const retencaoTotal = {
    pis:    arredondar2(entrada.saldo_anterior.pis    + entrada.retencoes_mes.pis),
    cofins: arredondar2(entrada.saldo_anterior.cofins + entrada.retencoes_mes.cofins),
    csll:   arredondar2(entrada.saldo_anterior.csll   + entrada.retencoes_mes.csll),
    irrf:   arredondar2(entrada.saldo_anterior.irrf   + entrada.retencoes_mes.irrf),
    inss:   arredondar2(entrada.saldo_anterior.inss   + entrada.retencoes_mes.inss),
  };

  // Base disponível para dedução federal (DAS - ISS já deduzido)
  let baseDisponivel = arredondar2(dasBruto - dedIssRetido);

  // Deduções federais — aplicar na ordem: PIS, COFINS, CSLL, IRRF, INSS
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
  const dasDEvido = arredondar2(Math.max(0, dasBruto - dasDeducoes));

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
      aliquota_efetiva: arredondar2(calc.aliquotaEfetiva * 10_000) / 10_000, // 4 casas
      das_bruto: dasBruto,
      das_deducoes: dasDeducoes,
      das_devido: dasDEvido,
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
