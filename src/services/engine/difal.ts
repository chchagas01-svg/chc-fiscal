// Diferencial de alíquota (Difal) nas compras interestaduais de uso/consumo e ativo imobilizado.
// Cálculo usado pelo escritório (conferido com a DeSTDA de 05/2026 da L. de Santana, NF 1860 da
// Refriweb/SC: 21.268,80 × (18% − 4%) = 2.977,63): base única, sem "por dentro".
// Difal = base do ICMS do item × (alíquota interna da UF da empresa − alíquota interestadual).

const r2 = (v: number) => Math.round(v * 100) / 100;

const UFS_SUL_SUDESTE_SEM_ES = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']);
// Origem 1, 2, 3 e 8: importado ou conteúdo de importação > 40% → 4% (Res. Senado 13/2012)
const ORIGENS_4 = new Set(['1', '2', '3', '8']);

export function aliquotaInterestadual(ufOrigem: string, ufDestino: string, origemMercadoria?: string): number {
  if (origemMercadoria && ORIGENS_4.has(origemMercadoria)) return 0.04;
  // Do Sul/Sudeste (exceto ES) para Norte, Nordeste, Centro-Oeste e ES: 7%; demais: 12%
  if (UFS_SUL_SUDESTE_SEM_ES.has(ufOrigem) && !UFS_SUL_SUDESTE_SEM_ES.has(ufDestino)) return 0.07;
  return 0.12;
}

export interface ItemDifal { valor: number; bc?: number; aliquota?: number; origem?: string }

export interface ResultadoDifalItem { base: number; aliquota_interestadual: number; difal: number }

export function calcularDifalItem(item: ItemDifal, ufOrigem: string, ufDestino: string, aliquotaInterna: number): ResultadoDifalItem {
  // Alíquota destacada pelo fornecedor; sem destaque (fornecedor do Simples, CST 40...) usa a da operação
  const aliqInter = item.aliquota && item.aliquota > 0
    ? item.aliquota
    : aliquotaInterestadual(ufOrigem, ufDestino, item.origem);
  const base = item.bc && item.bc > 0 ? item.bc : item.valor;
  return { base: r2(base), aliquota_interestadual: aliqInter, difal: r2(Math.max(0, base * (aliquotaInterna - aliqInter))) };
}
