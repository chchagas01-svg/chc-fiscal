// Tabelas do Simples Nacional — LC 123/2006 com valores vigentes 2023+
// Fonte: Resolução CGSN 140/2018

export interface FaixaSimples {
  limiteInferior: number;    // inclusive
  limiteSuperior: number;    // exclusive (0 = sem limite)
  aliquotaNominal: number;   // ex: 0.04 = 4%
  parcelaDedutivel: number;  // R$
}

export type AnexoSimples = 'I' | 'II' | 'III' | 'IV' | 'V';

const FAIXAS: Record<AnexoSimples, FaixaSimples[]> = {
  // Comércio
  I: [
    { limiteInferior: 0,            limiteSuperior: 180_000,    aliquotaNominal: 0.0400, parcelaDedutivel: 0 },
    { limiteInferior: 180_000,      limiteSuperior: 360_000,    aliquotaNominal: 0.0730, parcelaDedutivel: 5_940 },
    { limiteInferior: 360_000,      limiteSuperior: 720_000,    aliquotaNominal: 0.0950, parcelaDedutivel: 13_860 },
    { limiteInferior: 720_000,      limiteSuperior: 1_800_000,  aliquotaNominal: 0.1070, parcelaDedutivel: 22_500 },
    { limiteInferior: 1_800_000,    limiteSuperior: 3_600_000,  aliquotaNominal: 0.1430, parcelaDedutivel: 87_300 },
    { limiteInferior: 3_600_000,    limiteSuperior: 4_800_000,  aliquotaNominal: 0.1900, parcelaDedutivel: 378_000 },
  ],
  // Indústria
  II: [
    { limiteInferior: 0,            limiteSuperior: 180_000,    aliquotaNominal: 0.0450, parcelaDedutivel: 0 },
    { limiteInferior: 180_000,      limiteSuperior: 360_000,    aliquotaNominal: 0.0780, parcelaDedutivel: 5_940 },
    { limiteInferior: 360_000,      limiteSuperior: 720_000,    aliquotaNominal: 0.1000, parcelaDedutivel: 13_860 },
    { limiteInferior: 720_000,      limiteSuperior: 1_800_000,  aliquotaNominal: 0.1120, parcelaDedutivel: 22_500 },
    { limiteInferior: 1_800_000,    limiteSuperior: 3_600_000,  aliquotaNominal: 0.1470, parcelaDedutivel: 85_500 },
    { limiteInferior: 3_600_000,    limiteSuperior: 4_800_000,  aliquotaNominal: 0.3000, parcelaDedutivel: 720_000 },
  ],
  // Serviços — Fator R ≥ 0,28 (ou quando empresa não se enquadra no V)
  III: [
    { limiteInferior: 0,            limiteSuperior: 180_000,    aliquotaNominal: 0.0600, parcelaDedutivel: 0 },
    { limiteInferior: 180_000,      limiteSuperior: 360_000,    aliquotaNominal: 0.1120, parcelaDedutivel: 9_360 },
    { limiteInferior: 360_000,      limiteSuperior: 720_000,    aliquotaNominal: 0.1350, parcelaDedutivel: 17_640 },
    { limiteInferior: 720_000,      limiteSuperior: 1_800_000,  aliquotaNominal: 0.1600, parcelaDedutivel: 35_640 },
    { limiteInferior: 1_800_000,    limiteSuperior: 3_600_000,  aliquotaNominal: 0.2100, parcelaDedutivel: 125_640 },
    { limiteInferior: 3_600_000,    limiteSuperior: 4_800_000,  aliquotaNominal: 0.3300, parcelaDedutivel: 648_000 },
  ],
  // Serviços — construção civil, limpeza, vigilância, etc.
  IV: [
    { limiteInferior: 0,            limiteSuperior: 180_000,    aliquotaNominal: 0.0450, parcelaDedutivel: 0 },
    { limiteInferior: 180_000,      limiteSuperior: 360_000,    aliquotaNominal: 0.0900, parcelaDedutivel: 8_100 },
    { limiteInferior: 360_000,      limiteSuperior: 720_000,    aliquotaNominal: 0.1020, parcelaDedutivel: 12_420 },
    { limiteInferior: 720_000,      limiteSuperior: 1_800_000,  aliquotaNominal: 0.1400, parcelaDedutivel: 39_780 },
    { limiteInferior: 1_800_000,    limiteSuperior: 3_600_000,  aliquotaNominal: 0.2200, parcelaDedutivel: 183_780 },
    { limiteInferior: 3_600_000,    limiteSuperior: 4_800_000,  aliquotaNominal: 0.3300, parcelaDedutivel: 828_000 },
  ],
  // Serviços — Fator R < 0,28 (auditoria, consultoria, TI, eng. etc.)
  V: [
    { limiteInferior: 0,            limiteSuperior: 180_000,    aliquotaNominal: 0.1550, parcelaDedutivel: 0 },
    { limiteInferior: 180_000,      limiteSuperior: 360_000,    aliquotaNominal: 0.1800, parcelaDedutivel: 4_500 },
    { limiteInferior: 360_000,      limiteSuperior: 720_000,    aliquotaNominal: 0.1950, parcelaDedutivel: 9_900 },
    { limiteInferior: 720_000,      limiteSuperior: 1_800_000,  aliquotaNominal: 0.2050, parcelaDedutivel: 17_100 },
    { limiteInferior: 1_800_000,    limiteSuperior: 3_600_000,  aliquotaNominal: 0.2300, parcelaDedutivel: 62_100 },
    { limiteInferior: 3_600_000,    limiteSuperior: 4_800_000,  aliquotaNominal: 0.3050, parcelaDedutivel: 540_000 },
  ],
};

export function getFaixaSimples(anexo: AnexoSimples, rbt12: number): FaixaSimples | null {
  const faixas = FAIXAS[anexo];
  return faixas.find(f =>
    rbt12 >= f.limiteInferior &&
    (f.limiteSuperior === 0 || rbt12 < f.limiteSuperior)
  ) ?? null;
}

export function calcularAliquotaEfetiva(
  anexo: AnexoSimples,
  rbt12: number
): { aliquotaNominal: number; aliquotaEfetiva: number; parcelaDedutivel: number; faixa: number } | null {
  const faixas = FAIXAS[anexo];
  const idxFaixa = faixas.findIndex(f =>
    rbt12 >= f.limiteInferior &&
    (f.limiteSuperior === 0 || rbt12 < f.limiteSuperior)
  );

  if (idxFaixa === -1) return null;
  const faixa = faixas[idxFaixa]!;

  if (rbt12 === 0) return null;

  const aliquotaEfetiva = (rbt12 * faixa.aliquotaNominal - faixa.parcelaDedutivel) / rbt12;

  return {
    aliquotaNominal: faixa.aliquotaNominal,
    aliquotaEfetiva,
    parcelaDedutivel: faixa.parcelaDedutivel,
    faixa: idxFaixa + 1,
  };
}

// Limite de faturamento para Simples Nacional (R$ 4.800.000,00/ano)
export const LIMITE_SIMPLES = 4_800_000;

// Fator R mínimo para usar Anexo III em vez de Anexo V
export const FATOR_R_MINIMO = 0.28;
