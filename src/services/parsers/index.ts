import { ParsedNota } from '../../types/nota';
import { parseNfseNacional } from './parseNfseNacional';
import { parseNfseAbrasf } from './parseNfseAbrasf';
import { parseNfseSp } from './parseNfseSp';
import { parseNfe } from './parseNfe';
import { parseCte } from './parseCte';
import { classificarSaida } from '../engine/cfop';

export { parseEventoCancelamento, EventoCancelamento } from './parseEventoCancelamento';

// Detecta tipo de XML pela primeira tag raiz significativa
function detectRootTag(xml: string): string {
  const match = xml.match(/<([A-Za-z][A-Za-z0-9_:]*)[\s>]/);
  if (!match) return '';
  // Strip namespace prefix
  return (match[1] ?? '').split(':').pop() ?? '';
}

const NFSE_TAGS = new Set([
  'NFSe', 'Nfse', 'CompNfse', 'ListaNfse', 'ListaNotaFiscal',
  'nfse', 'NFSE',                          // variantes de case
  'nfseProc', 'NfseProc', 'NFSeProc',      // wrappers com proc
  'ConsultarNfseResposta', 'GerarNfseResposta', 'RetornoConsultaNfse',
]);

export async function parseXml(xml: string): Promise<ParsedNota[]> {
  const tag = detectRootTag(xml);

  // NFS-e padrão nacional DFe 3.0
  if (tag === 'NFSe') {
    return [await parseNfseNacional(xml)];
  }

  // NFS-e ABRASF — wrappers conhecidos
  if (NFSE_TAGS.has(tag) || tag === 'Nfse' || tag === 'CompNfse' || tag === 'ListaNfse') {
    return parseNfseAbrasf(xml);
  }

  // NF-e modelo 55 ou NFC-e modelo 65
  // ATENÇÃO: a Prefeitura de SP usa <NFe> como root de NFS-e — detecção por <ChaveNFe>
  if (tag === 'nfeProc' || tag === 'NFe') {
    if (xml.includes('<ChaveNFe>') || xml.includes('<ChaveNFe ') ||
        xml.includes('<DataEmissaoNFe>')) {
      return [await parseNfseSp(xml)];
    }
    return [await parseNfe(xml, 'nfe')];
  }

  if (tag === 'nfceProc') {
    return [await parseNfe(xml, 'nfce')];
  }

  // CT-e
  if (tag === 'cteProc' || tag === 'CTe') {
    return [await parseCte(xml)];
  }

  // Tag desconhecida — tentar parsers NFS-e como fallback antes de desistir
  try { return await parseNfseAbrasf(xml); } catch {}
  try { return [await parseNfseNacional(xml)]; } catch {}

  throw new Error(`Tipo de XML não reconhecido: tag raiz <${tag}>`);
}

// Aplica à nota a direção já conhecida (fluxo do Qyon ou CNPJ da empresa):
// - NF-e/NFC-e de saída com CFOP de devolução, remessa ou retorno → 'outro' (não é receita)
// - ICMS destacado vira crédito quando a nota é de compra
export function aplicarNatureza(nota: ParsedNota, natureza: ParsedNota['natureza']): ParsedNota {
  if (nota.tipoDoc !== 'nfe' && nota.tipoDoc !== 'nfce') return { ...nota, natureza };
  if (natureza === 'compra') {
    return { ...nota, natureza, icmsCredito: nota.icmsDebito, icmsDebito: 0 };
  }
  if (natureza === 'venda' && classificarSaida(nota.cfop) === 'nao_receita') {
    return { ...nota, natureza: 'outro' };
  }
  return { ...nota, natureza };
}
