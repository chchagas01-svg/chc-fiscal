// Parser CT-e — tag raiz <cteProc> ou <CTe>
import { parseStringPromise } from 'xml2js';
import { ParsedNota } from '../../types/nota';
import { str, num, cleanDoc, dig, parseDate } from './helpers';

export async function parseCte(xml: string): Promise<ParsedNota> {
  const root = await parseStringPromise(xml, {
    explicitArray: false,
    tagNameProcessors: [(name) => name.split(':').pop() ?? name],
    ignoreAttrs: false,
  });

  const proc = root['cteProc'] ?? root;
  const cte = (proc as Record<string, unknown>)['CTe'] ?? proc;
  const inf = (cte as Record<string, unknown>)['infCte'] as Record<string, unknown>;

  if (!inf) throw new Error('infCte não encontrado no XML CT-e');

  const ide = (inf['ide'] ?? {}) as Record<string, unknown>;
  const numero = str(ide['nCT']);
  const serie = str(ide['serie']);
  const dataEmissao = parseDate(ide['dhEmi'] ?? ide['dEmi']);
  const tpCTe = str(ide['tpCTe']); // 0=CT-e Normal, 1=CT-e Complementar, 3=CT-e de Substituição

  // Chave de acesso
  const infId = str((inf['$'] as Record<string, unknown> | undefined)?.['Id'] ?? '');
  const chaveAcesso = infId.replace(/^CTe/, '');

  // Emitente
  const emit = (inf['emit'] ?? {}) as Record<string, unknown>;
  const cnpjEmitente = cleanDoc(str(emit['CNPJ'] ?? emit['CPF'] ?? ''));
  const nomeEmitente = str(emit['xNome'] ?? '');

  // Tomador do serviço
  const toma = dig(inf, 'ide', 'toma03', 'toma') ?? dig(inf, 'ide', 'toma4', 'CNPJ');
  const cnpjTomador = toma ? cleanDoc(str(toma)) : '';

  // Totais
  const vPrest = (inf['vPrest'] ?? {}) as Record<string, unknown>;
  const valorBruto = num(vPrest['vTPrest']);
  const valorReceb = num(vPrest['vRec']);

  // Impostos
  const imp = (inf['imp'] ?? {}) as Record<string, unknown>;
  const icms = (imp['ICMS'] ?? {}) as Record<string, unknown>;
  // CT-e ICMS: pode ter ICMS00, ICMS20, ICMS45, etc.
  const icmsEl = Object.values(icms).find(v => v && typeof v === 'object') as Record<string, unknown> | undefined;
  const icmsDebito = num(icmsEl?.['vICMS'] ?? 0);

  // Retenções sobre prestação de serviço de transporte
  const retPis = num(imp['vRetPIS'] ?? 0);
  const retCofins = num(imp['vRetCOFINS'] ?? 0);
  const retCsll = num(imp['vRetCSLL'] ?? 0);
  const retIrrf = num(imp['vIRRF'] ?? imp['vRetIR'] ?? 0);
  const retInss = num(imp['vRetCP'] ?? 0);

  // Cancelamento
  const protCTe = (proc as Record<string, unknown>)['protCTe'];
  const cStat = str(dig(protCTe, 'infProt', 'cStat') ?? '');
  const cancelada = cStat === '101' || cStat === '135';

  // CT-e substituto
  const chaveSubstituta = tpCTe === '3'
    ? str(dig(inf, 'infCteNorm', 'infCteSub', 'chCte') ?? '')
    : undefined;

  return {
    chaveAcesso,
    tipoDoc: 'cte',
    numero,
    serie,
    dataEmissao,
    natureza: 'outro',
    cnpjEmitente,
    nomeEmitente: nomeEmitente || undefined,
    cnpjTomador: cnpjTomador || undefined,
    valorBruto,
    valorDeducoes: 0,
    valorLiquido: valorReceb,
    issRetido: false,
    valorIss: 0,
    retPis,
    retCofins,
    retCsll,
    retIrrf,
    retInss,
    icmsDebito,
    icmsCredito: 0,
    cancelada,
    chaveSubstituta: chaveSubstituta || undefined,
    xmlRaw: xml,
  };
}
