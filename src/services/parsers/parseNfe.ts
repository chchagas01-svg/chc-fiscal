// Parser NF-e modelo 55 (nfeProc / NFe) e NFC-e modelo 65 (nfceProc)
import { parseStringPromise } from 'xml2js';
import { ParsedNota, TipoDoc } from '../../types/nota';
import { str, num, cleanDoc, dig, parseDate } from './helpers';
import { CFOPS_NAO_RECEITA } from '../engine/cfop';

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

  // ICMS destacado na nota. É débito quando a empresa emite (saída) e crédito quando
  // recebe (compra) — a direção só é conhecida depois, em aplicarNatureza().
  const icmsDebito = num(icmsTot['vICMS']);
  const icmsCredito = 0;

  // Retenções federais ficam em total/retTrib (vRetPIS, vRetCOFINS, vRetCSLL, vIRRF, vRetPrev).
  // vPIS/vCOFINS do ICMSTot são o PIS/COFINS próprios da operação, não retenção.
  const retTrib = (total['retTrib'] ?? {}) as Record<string, unknown>;
  const retPis = num(retTrib['vRetPIS']);
  const retCofins = num(retTrib['vRetCOFINS']);
  const retCsll = num(retTrib['vRetCSLL']);
  const retIrrf = num(retTrib['vIRRF']);
  const retInss = num(retTrib['vRetPrev']);

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

  // Itens com CFOP, valor e ICMS — usados pelo Resumo Mensal para separar compras por finalidade
  const itensNota = itens.map(item => ({
    cfop: str(dig(item, 'prod', 'CFOP') ?? ''),
    valor: num(dig(item, 'prod', 'vProd')),
    icms: icmsDoItem(item),
  }));

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
    itens: itensNota,
    xmlRaw: xml,
  };
}

// O grupo ICMS do item vem com o nome do CST (ICMS00, ICMS20, ICMSSN101...); soma vICMS do que existir
function icmsDoItem(item: Record<string, unknown>): number {
  const grupo = dig(item, 'imposto', 'ICMS') as Record<string, unknown> | undefined;
  if (!grupo || typeof grupo !== 'object') return 0;
  return Object.values(grupo).reduce<number>((acc, g) =>
    acc + (g && typeof g === 'object' ? num((g as Record<string, unknown>)['vICMS']) : 0), 0);
}
