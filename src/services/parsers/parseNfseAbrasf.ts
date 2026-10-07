// Parser NFS-e padrão ABRASF — tag raiz <Nfse> (individual) ou <ListaNfse> (lote)
// Suporta também CompNfse e outros wrappers municipais
import { parseStringPromise } from 'xml2js';
import { ParsedNota } from '../../types/nota';
import { str, num, cleanDoc, dig, parseDate, extractCnpj, toCompetencia } from './helpers';

async function parseSingleAbrasf(inf: Record<string, unknown>, xml: string): Promise<ParsedNota> {
  const numero = str(inf['Numero']);
  const dataEmissao = parseDate(inf['DataEmissao'] ?? inf['Competencia']);
  const competencia = toCompetencia(
    inf['Competencia'] ?? dig(inf, 'DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Competencia')
  );

  // Prestador
  const prestador = (inf['PrestadorServico'] ?? inf['Prestador']) as Record<string, unknown> | undefined;
  const cnpjPrestador = extractCnpj(
    dig(prestador, 'IdentificacaoPrestador', 'CpfCnpj') ??
    dig(prestador, 'CpfCnpj') ??
    {}
  );
  const nomePrestador = str(dig(prestador, 'RazaoSocial') ?? '');

  // Tomador
  const tomador = (inf['TomadorServico'] ?? inf['Tomador']) as Record<string, unknown> | undefined;
  const cnpjTomador = extractCnpj(
    dig(tomador, 'IdentificacaoTomador', 'CpfCnpj') ??
    dig(tomador, 'CpfCnpj') ??
    {}
  );
  const nomeTomador = str(dig(tomador, 'RazaoSocial') ?? '');

  // Valores
  const servico = (inf['Servico'] ?? {}) as Record<string, unknown>;
  const valores = (dig(servico, 'Valores') ?? {}) as Record<string, unknown>;

  const valorServicos = num(valores['ValorServicos']);
  const valorDeducoes = num(valores['ValorDeducoes']);
  const valorLiquido = num(valores['ValorLiquidoNfse']) || (valorServicos - valorDeducoes);
  const valorIss = num(valores['ValorIss'] ?? valores['ValorISS']);

  // ISS retido — prioridade: tpRetISSQN (Padrão Nacional NFS-e: 1=não retido, 2=retido tomador, 3=retido intermediário)
  // Fallback: IssRetido (ABRASF antigo: 1=retido, 2=não retido)
  const tpRetISSQN   = str(valores['tpRetISSQN'] ?? dig(servico, 'tpRetISSQN') ?? '');
  const issRetidoFlag = str(valores['IssRetido'] ?? '');
  const issRetido = tpRetISSQN
    ? tpRetISSQN === '2' || tpRetISSQN === '3'
    : issRetidoFlag === '1';

  // Retenções federais
  // ABRASF: verificar tpRetPisCofins antes de somar
  const tpRetPisCofins = str(valores['tpRetPisCofins'] ?? '');
  const retPis = tpRetPisCofins !== '0' ? num(valores['ValorPis']) : 0;
  const retCofins = tpRetPisCofins !== '0' ? num(valores['ValorCofins']) : 0;
  const retCsll = num(valores['ValorCsll']);
  const retIrrf = num(valores['ValorIr']);
  const retInss = num(valores['ValorInss']);

  // Chave de acesso ABRASF: geralmente CodigoVerificacao ou Chave.CodigoVerificacao
  const chaveEl = (inf['Chave'] ?? {}) as Record<string, unknown>;
  const codigoVerificacao = str(inf['CodigoVerificacao'] ?? chaveEl['CodigoVerificacao'] ?? '');
  const municipioGerador = str(dig(servico, 'CodigoMunicipio') ?? chaveEl['CodigoMunicipio'] ?? '');
  const chaveAcesso = codigoVerificacao || `${municipioGerador}-${cnpjPrestador}-${numero}`;

  // Substituição
  const nfseSubstituida = inf['NfseSubstituida'] as Record<string, unknown> | undefined;
  const chaveSubstituta = nfseSubstituida
    ? str(nfseSubstituida['CodigoVerificacao'] ?? '')
    : undefined;

  const situacao = str(inf['Situacao'] ?? '');
  const cancelada = situacao === 'C' || situacao === 'Cancelado';

  return {
    chaveAcesso,
    tipoDoc: 'nfse',
    numero,
    dataEmissao,
    competencia,
    natureza: 'servico_prestado',
    cnpjEmitente: cnpjPrestador,
    nomeEmitente: nomePrestador || undefined,
    cnpjTomador: cnpjTomador || undefined,
    nomeTomador: nomeTomador || undefined,
    valorBruto: valorServicos,
    valorDeducoes,
    valorLiquido,
    issRetido,
    valorIss,
    retPis,
    retCofins,
    retCsll,
    retIrrf,
    retInss,
    icmsDebito: 0,
    icmsCredito: 0,
    cancelada,
    chaveSubstituta: chaveSubstituta || undefined,
    xmlRaw: xml,
  };
}

// Extrai InfNfse de estruturas variadas (Nfse, CompNfse, ListaNfse)
function extractInfNfse(root: Record<string, unknown>): Record<string, unknown>[] {
  const nfse = root['Nfse'] ?? root['CompNfse'] ?? root['ListaNfse'] ?? root;
  const compList = (nfse as Record<string, unknown>)['CompNfse'];

  if (Array.isArray(compList)) {
    return compList
      .map((c: unknown) => (c as Record<string, unknown>)['InfNfse'] as Record<string, unknown>)
      .filter(Boolean);
  }
  if (compList && typeof compList === 'object') {
    const inf = (compList as Record<string, unknown>)['InfNfse'];
    return inf ? [inf as Record<string, unknown>] : [];
  }

  const inf = (nfse as Record<string, unknown>)['InfNfse'];
  if (inf) return [inf as Record<string, unknown>];

  // Último recurso: o próprio root tem InfNfse
  const rootInf = root['InfNfse'];
  if (rootInf) return [rootInf as Record<string, unknown>];

  return [];
}

export async function parseNfseAbrasf(xml: string): Promise<ParsedNota[]> {
  const root = await parseStringPromise(xml, {
    explicitArray: false,
    tagNameProcessors: [(name) => name.split(':').pop() ?? name],
    ignoreAttrs: false,
  });

  const infs = extractInfNfse(root);
  if (infs.length === 0) {
    throw new Error('Nenhuma InfNfse encontrada no XML ABRASF');
  }

  return Promise.all(infs.map(inf => parseSingleAbrasf(inf, xml)));
}
