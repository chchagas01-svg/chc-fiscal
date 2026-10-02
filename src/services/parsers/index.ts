import { ParsedNota } from '../../types/nota';
import { parseNfseNacional } from './parseNfseNacional';
import { parseNfseAbrasf } from './parseNfseAbrasf';
import { parseNfe } from './parseNfe';
import { parseCte } from './parseCte';

// Detecta tipo de XML pela primeira tag raiz significativa
function detectRootTag(xml: string): string {
  const match = xml.match(/<([A-Za-z][A-Za-z0-9_:]*)[\s>]/);
  if (!match) return '';
  // Strip namespace prefix
  return (match[1] ?? '').split(':').pop() ?? '';
}

export async function parseXml(xml: string): Promise<ParsedNota[]> {
  const tag = detectRootTag(xml);

  switch (tag) {
    // NFS-e padrão nacional DFe 3.0
    case 'NFSe':
      return [await parseNfseNacional(xml)];

    // NFS-e ABRASF — individual ou lote
    case 'Nfse':
    case 'CompNfse':
    case 'ListaNfse':
      return parseNfseAbrasf(xml);

    // NF-e modelo 55 ou NFC-e modelo 65
    case 'nfeProc':
    case 'NFe':
      return [await parseNfe(xml, 'nfe')];

    case 'nfceProc':
      return [await parseNfe(xml, 'nfce')];

    // CT-e
    case 'cteProc':
    case 'CTe':
      return [await parseCte(xml)];

    default:
      throw new Error(`Tipo de XML não reconhecido: tag raiz <${tag}>`);
  }
}
