// Classificação de CFOP usada pela apuração e pelo Resumo Mensal (totalizador).
// Saídas: separa receita de comércio, de industrialização e o que não é receita.
// Entradas: separa a finalidade da compra (revenda, industrialização, ativo, outras).

// CFOPs de saída que NÃO representam receita: devoluções, remessas, transferências, retornos
export const CFOPS_NAO_RECEITA = new Set([
  // Devoluções de compras / retornos de mercadoria
  '5201','5202','5203','5204','5205','5206','5207','5208','5209','5210','5214',
  '6201','6202','6203','6204','6205','6206','6207','6208','6209','6210',
  // Devoluções com ICMS-ST
  '5410','5411','5412','5413','5414','5415','5416','5417','5418',
  '6410','6411','6412','6413',
  // Remessas (sem transferência de propriedade)
  '5901','5902','5903','5904','5905','5906','5907','5908','5909','5910',
  '5911','5912','5913','5914','5915','5916','5917','5918','5919','5920',
  '5921','5922','5923','5924','5925','5926','5927',
  '6901','6902','6903','6904','6905','6906','6907','6908','6909','6910',
  // Transferências entre estabelecimentos
  '5151','5152','5153','5154','5155','5156',
  '5551','5552','5553','5554','5555','5556','5557',
  '6151','6152','6153','6154','6155','6156',
  '6551','6552','6553','6554','6555','6556','6557',
  // Outras saídas não comerciais (retorno, amostra, brinde, conserto etc.)
  '5949','6949',
]);

// Venda de produção do próprio estabelecimento (receita de industrialização)
export const CFOPS_VENDA_PRODUCAO = new Set([
  '5101','5103','5105','5109','5111','5116','5118','5122','5124','5125','5401','5402',
  '6101','6103','6105','6107','6109','6111','6116','6118','6122','6124','6125','6401','6402',
  '7101','7105','7127',
]);

export type ClasseSaida = 'comercio' | 'industria' | 'nao_receita';

export function classificarSaida(cfop: string | null | undefined): ClasseSaida {
  const c = (cfop ?? '').replace(/\D/g, '');
  if (CFOPS_NAO_RECEITA.has(c)) return 'nao_receita';
  if (CFOPS_VENDA_PRODUCAO.has(c)) return 'industria';
  return 'comercio';
}

export type FinalidadeEntrada = 'revenda' | 'industrializacao' | 'ativo' | 'outras';

// Linhas do quadro "Compras" do Resumo Mensal
const ENTRADA_REVENDA = new Set([
  '1102','1113','1117','1118','1121','1403','1652',
  '2102','2113','2117','2118','2121','2403','2652',
  '3102',
]);
const ENTRADA_INDUSTRIALIZACAO = new Set([
  '1101','1111','1116','1120','1122','1124','1125','1126','1401','1651',
  '2101','2111','2116','2120','2122','2124','2125','2126','2401','2651',
  '3101','3126',
]);
const ENTRADA_ATIVO = new Set([
  '1406','1551','1552','1553','1554','1555',
  '2406','2551','2552','2553','2554','2555',
  '3551','3553',
]);

export function classificarEntrada(cfop: string | null | undefined): FinalidadeEntrada {
  const c = (cfop ?? '').replace(/\D/g, '');
  if (ENTRADA_REVENDA.has(c)) return 'revenda';
  if (ENTRADA_INDUSTRIALIZACAO.has(c)) return 'industrializacao';
  if (ENTRADA_ATIVO.has(c)) return 'ativo';
  return 'outras';
}

// Na NF-e do fornecedor o CFOP é de saída (5xxx/6xxx/7xxx); a entrada correspondente
// troca o primeiro dígito (5→1, 6→2, 7→3). Ex.: venda 5102 → compra para revenda 1102.
export function cfopDeEntrada(cfopFornecedor: string | null | undefined): string {
  const c = (cfopFornecedor ?? '').replace(/\D/g, '');
  const mapa: Record<string, string> = { '5': '1', '6': '2', '7': '3' };
  return mapa[c[0] ?? ''] ? mapa[c[0]!] + c.slice(1) : c;
}
