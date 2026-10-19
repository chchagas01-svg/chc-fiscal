import { TipoDoc } from '../../types/nota';

// Evento de cancelamento enviado depois da nota (o XML da nota continua "autorizada").
// O Qyon guarda esses eventos como documentos à parte:
// - NFS-e padrão nacional: <evento> com <chNFSe> e <e101101> (Cancelamento de NFS-e)
// - NF-e/NFC-e: <procEventoNFe>/<evento> com <chNFe> e <tpEvento>110111</tpEvento>
// - CT-e: <procEventoCTe>/<eventoCTe> com <chCTe> e <tpEvento>110111</tpEvento>
export interface EventoCancelamento {
  chave: string;
  tipoDoc: TipoDoc;
  dataEvento?: string;
}

// Conteúdo da primeira tag com esse nome local (ignora prefixo de namespace)
function tag(xml: string, nome: string): string | undefined {
  const m = xml.match(new RegExp(`<(?:[A-Za-z0-9_]+:)?${nome}(?:\\s[^>]*)?>([^<]*)</(?:[A-Za-z0-9_]+:)?${nome}>`));
  return m?.[1]?.trim() || undefined;
}

function temTag(xml: string, nome: string): boolean {
  return new RegExp(`<(?:[A-Za-z0-9_]+:)?${nome}[\\s>/]`).test(xml);
}

// Retorna o evento se o XML for um cancelamento aceito; null se for outro documento
// (nota, carta de correção, manifestação...) ou um pedido de cancelamento rejeitado.
export function parseEventoCancelamento(xml: string): EventoCancelamento | null {
  const dataEvento = tag(xml, 'dhEvento') ?? tag(xml, 'dhProc') ?? tag(xml, 'dhRegEvento');

  const chNFSe = tag(xml, 'chNFSe');
  if (chNFSe && temTag(xml, 'e101101')) {
    return { chave: chNFSe, tipoDoc: 'nfse', dataEvento };
  }

  if (tag(xml, 'tpEvento') !== '110111') return null;
  // Com retorno da Sefaz, só vale o cancelamento homologado (135, 136 ou 155)
  const cStat = temTag(xml, 'retEvento') || temTag(xml, 'retEventoCTe')
    ? tag(xml.slice(xml.search(/<(?:[A-Za-z0-9_]+:)?retEvento/)), 'cStat')
    : undefined;
  if (cStat && !['135', '136', '155'].includes(cStat)) return null;

  const chNFe = tag(xml, 'chNFe');
  if (chNFe) return { chave: chNFe, tipoDoc: chNFe.substring(20, 22) === '65' ? 'nfce' : 'nfe', dataEvento };
  const chCTe = tag(xml, 'chCTe');
  if (chCTe) return { chave: chCTe, tipoDoc: 'cte', dataEvento };
  return null;
}
