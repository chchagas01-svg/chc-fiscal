// Parser NF-e modelo 55 (nfeProc / NFe) e NFC-e modelo 65 (nfceProc)
import { parseStringPromise } from 'xml2js';
import { ParsedNota, TipoDoc } from '../../types/nota';
import { str, num, cleanDoc, dig, parseDate } from './helpers';

// CFOPs que NÃO representam receita: devoluções, remessas, transferências, retornos
const CFOPS_NAO_RECEITA = new Set([
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

export async function parseNfe(xml: string, tipoDoc: TipoDoc = 'nfe'): Promise<ParsedNota> {
  const root = await parseStringPromise(xml, {
    explicitArray: false,
    tagNameProcessors: [(name) => name.split(':').pop() ?? name],
    ignoreAttrs: false,
  });

  // nfeProc > NFe > infNFe  ou  NFe > infNFe  direto
  const proc = root['nfeProc'] ?? root['nfceProc'] ?? root;
  const nfe = (proc as Record<string, unknown>)['NFe'] ?? proc;
  const inf = (nfe as Record<string, unknown>)['infNFe'] as Record<string, unknown>;

  if (!inf) throw new Error('infNFe não encontrado no XML');

  // Identificação
  const ide = (inf['ide'] ?? {}) as Record<string, unknown>;
  const numero = str(ide['nNF']);
  const serie = str(ide['serie']);
  const dataEmissao = parseDate(ide['dhEmi'] ?? ide['dEmi']);
  const modelo = str(ide['mod']); // 55=NF-e, 65=NFC-e

  // Chave de acesso (44 dígitos, está no atributo Id do infNFe sem o prefixo 'NFe')
  const infId = str((inf as Record<string, unknown>)['$']
    ? ((inf as Record<string, unknown>)['$'] as Record<string, unknown>)['Id']
    : '');
  const chaveAcesso = infId.replace(/^NFe/, '') || str(ide['cNF']) + str(ide['nNF']);

  // Emitente
  const emit = (inf['emit'] ?? {}) as Record<string, unknown>;
  const cnpjEmitente = cleanDoc(str(emit['CNPJ'] ?? emit['CPF'] ?? ''));
  const nomeEmitente = str(emit['xNome'] ?? '');

  // Destinatário
  const dest = (inf['dest'] ?? {}) as Record<string, unknown>;
  const cnpjDest = cleanDoc(str(dest['CNPJ'] ?? dest['CPF'] ?? ''));
  const nomeDest = str(dest['xNome'] ?? '');

  // Totais
  const total = (inf['total'] ?? {}) as Record<string, unknown>;
  const icmsTot = (total['ICMSTot'] ?? {}) as Record<string, unknown>;

  const valorNF = num(icmsTot['vNF']);
  const valorProd = num(icmsTot['vProd']);
  const valorDesc = num(icmsTot['vDesc']);

  // ICMS débito/crédito — somente para empresas do Lucro Presumido com ICMS
  const icmsDebito = num(icmsTot['vICMS']);      // ICMS sobre saídas
  const icmsCredito = num(icmsTot['vICMSUFDest']); // simplificado; parsear itens para crédito real

  // Retenções (cofins)
  const retPis = num(icmsTot['vRetPIS'] ?? icmsTot['vPIS']);
  const retCofins = num(icmsTot['vRetCOFINS'] ?? icmsTot['vCOFINS']);
  const retCsll = num(icmsTot['vRetCSLL']);
  const retIrrf = num(icmsTot['vIRRF'] ?? icmsTot['vRetIR']);
  const retInss = num(icmsTot['vRetCP'] ?? icmsTot['vINSS']);

  // ISS — presente quando NF-e tem itens de serviço (ISSQN)
  const issqnTot = (total['ISSQNtot'] ?? {}) as Record<string, unknown>;
  const valorIss = num(issqnTot['vISS']);

  // tpRetISSQN nos itens (det): 1=não retido, 2=retido tomador, 3=retido intermediário
  const det = inf['det'];
  const itens: Record<string, unknown>[] = Array.isArray(det) ? det : det ? [det as Record<string, unknown>] : [];
  const algumIssRetido = itens.some(item => {
    const tpRet = str(dig(item, 'imposto', 'ISSQN', 'tpRetISSQN'));
    return tpRet === '2' || tpRet === '3';
  });

  // CFOP — usa o do primeiro item (NFs comerciais geralmente têm um único CFOP)
  const cfop = itens.length > 0 ? str(dig(itens[0] as Record<string, unknown>, 'prod', 'CFOP') ?? '') : '';

  // Natureza: saída (55) → venda; entrada → compra; NFC-e → venda
  // CFOPs de retorno/remessa/transferência → 'outro' (não é receita)
  const tpNF = str(ide['tpNF']); // 0=entrada, 1=saída
  const isSaida = tpNF === '1' || modelo === '65';
  const natureza = isSaida
    ? (CFOPS_NAO_RECEITA.has(cfop) ? 'outro' as const : 'venda' as const)
    : 'compra' as const;

  // Cancelamento
  const protNFe = (proc as Record<string, unknown>)['protNFe'];
  const cStat = str(dig(protNFe, 'infProt', 'cStat') ?? '');
  const cancelada = cStat === '101' || cStat === '151' || cStat === '135';

  // Nota substituída
  const nfeSubstituta = (inf['infAdic'] ?? {}) as Record<string, unknown>;
  const infCpl = str(nfeSubstituta['infCpl'] ?? '');
  const matchSubst = infCpl.match(/\b(\d{44})\b/);
  const chaveSubstituta = matchSubst?.[1];

  return {
    chaveAcesso,
    tipoDoc: modelo === '65' ? 'nfce' : tipoDoc,
    numero,
    serie,
    dataEmissao,
    natureza,
    cfop: cfop || undefined,
    cnpjEmitente,
    nomeEmitente: nomeEmitente || undefined,
    cnpjTomador: cnpjDest || undefined,
    nomeTomador: nomeDest || undefined,
    valorBruto: valorProd,
    valorDeducoes: valorDesc,
    valorLiquido: valorNF,
    issRetido: algumIssRetido,
    valorIss,
    retPis,
    retCofins,
    retCsll,
    retIrrf,
    retInss,
    icmsDebito,
    icmsCredito,
    cancelada,
    chaveSubstituta,
    xmlRaw: xml,
  };
}
