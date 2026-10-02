// Parser NFS-e padrão nacional (DFe 3.0) — tag raiz <NFSe>
// Norma: ABNT NBR 15600 / NFS-e Nacional SEFAZ
import { parseStringPromise } from 'xml2js';
import { ParsedNota } from '../../types/nota';
import { str, num, bool, cleanDoc, dig, parseDate, extractCnpj } from './helpers';

export async function parseNfseNacional(xml: string): Promise<ParsedNota> {
  const root = await parseStringPromise(xml, {
    explicitArray: false,
    tagNameProcessors: [(name) => name.split(':').pop() ?? name],
    ignoreAttrs: false,
  });

  // Suporte a namespace: pode estar em NFSe.InfNFSe ou NFSe.NFSe.InfNFSe
  const nfse = root['NFSe'] ?? root;
  const inf: Record<string, unknown> =
    (dig(nfse, 'InfNFSe') as Record<string, unknown>) ??
    (dig(nfse, 'NFSe', 'InfNFSe') as Record<string, unknown>) ??
    {};

  // Identificação
  const numero = str(inf['Numero']);
  const codigoVerificacao = str(inf['CodigoVerificacao']);
  const dataEmissao = parseDate(inf['DataEmissao'] ?? inf['Competencia']);

  // Prestador
  const prestador = (inf['Prestador'] ?? inf['PrestadorServico']) as Record<string, unknown> | undefined;
  const cnpjPrestador = extractCnpj(
    dig(prestador, 'CpfCnpj') ?? dig(prestador, 'IdentificacaoPrestador', 'CpfCnpj') ?? {}
  );
  const nomePrestador = str(dig(prestador, 'RazaoSocial') ?? dig(prestador, 'NomeFantasia') ?? '');

  // Tomador
  const tomador = (inf['Tomador'] ?? inf['TomadorServico']) as Record<string, unknown> | undefined;
  const cnpjTomador = extractCnpj(
    dig(tomador, 'IdentificacaoTomador', 'CpfCnpj') ??
    dig(tomador, 'CpfCnpj') ??
    {}
  );
  const nomeTomador = str(dig(tomador, 'RazaoSocial') ?? '');

  // Valores do serviço
  const servico = (inf['Servico'] ?? {}) as Record<string, unknown>;
  const valores = (dig(servico, 'Valores') ?? {}) as Record<string, unknown>;

  const valorServicos = num(valores['ValorServicos']);
  const valorDeducoes = num(valores['ValorDeducoes']);
  const valorLiquido = num(valores['ValorLiquidoNfse']) || (valorServicos - valorDeducoes);
  const valorIss = num(valores['ValorIss'] ?? valores['ValorISSQN']);

  // ISS retido — no padrão nacional:
  // ExigibilidadeISS: 1=Exigível (não retido), outros podem indicar isenção/imunidade
  // IssRetido: 1=Sim (retido) quando o campo existe
  // tpRetISSQN quando presente: 1=Não retido, 2=Retido Tomador, 3=Retido Intermediário
  const tpRetISSQN = str(valores['tpRetISSQN'] ?? dig(servico, 'tpRetISSQN') ?? '');
  const issRetidoFlag = str(valores['IssRetido'] ?? '');
  let issRetido = false;
  if (tpRetISSQN) {
    issRetido = tpRetISSQN === '2' || tpRetISSQN === '3';
  } else if (issRetidoFlag) {
    issRetido = issRetidoFlag === '1'; // padrão ABRASF: 1=Sim
  }

  // Retenções federais
  const tpRetPisCofins = str(valores['tpRetPisCofins'] ?? '');
  const retPis = tpRetPisCofins !== '0' ? num(valores['ValorPis'] ?? valores['PisRetido']) : 0;
  const retCofins = tpRetPisCofins !== '0' ? num(valores['ValorCofins'] ?? valores['CofinsRetido']) : 0;
  const retCsll = num(valores['ValorCsll'] ?? valores['CsllRetido']);
  const retIrrf = num(valores['ValorIr'] ?? valores['IrRetido']);
  const retInss = num(valores['ValorInss'] ?? valores['InssRetido']);

  // Chave de acesso: no padrão nacional pode não haver chave de 44 dígitos
  // Usamos a chave no formato: municipio+serie+numero+prestador ou codigoVerificacao
  const municipio = str(dig(servico, 'CodigoMunicipio') ?? '');
  const chaveAcesso = codigoVerificacao ||
    `${municipio}-${cnpjPrestador}-${numero}`;

  // Substituição
  const rpsSubstituido = inf['RpsSubstituido'] as Record<string, unknown> | undefined;
  const chaveSubstituta = rpsSubstituido
    ? str(dig(rpsSubstituido, 'ChaveRps') ?? '')
    : undefined;

  const cancelada = bool(inf['Situacao'] === 'C' || inf['NfseSubstituida']);

  return {
    chaveAcesso,
    tipoDoc: 'nfse',
    numero,
    dataEmissao,
    natureza: 'servico_prestado',
    cnpjEmitente: cnpjPrestador,
    nomeEmitente: nomePrestador,
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
