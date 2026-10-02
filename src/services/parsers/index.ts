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

const NFSE_TAGS = new Set([
  'NFSe', 'Nfse', 'CompNfse', 'ListaNfse',
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
  if (tag === 'nfeProc' || tag === 'NFe') {
    try {
      return [await parseNfe(xml, 'nfe')];
    } catch (e) {
      // Alguns municípios emitem NFS-e com tag <NFe> — tentar fallback ABRASF
      if (e instanceof Error && e.message.includes('infNFe')) {
        try { return await parseNfseAbrasf(xml); } catch {}
        try { return [await parseNfseNacional(xml)]; } catch {}
      }
      throw e;
    }
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
