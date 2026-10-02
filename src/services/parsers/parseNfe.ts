// Parser NF-e modelo 55 (nfeProc / NFe) e NFC-e modelo 65 (nfceProc)
import { parseStringPromise } from 'xml2js';
import { ParsedNota, TipoDoc } from '../../types/nota';
import { str, num, cleanDoc, dig, parseDate, extractCnpj } from './helpers';

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

  // Natureza: saída (55) → venda; entrada → compra; NFC-e → venda
  const tpNF = str(ide['tpNF']); // 0=entrada, 1=saída
  const natureza = tpNF === '1' || modelo === '65'
    ? 'venda' as const
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
