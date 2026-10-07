// Parser NFS-e formato Prefeitura de São Paulo (ISS-SP / ABRASF-SP)
// Root tag: <NFe>  (ATENÇÃO: não confundir com NF-e federal)
// Identificação: <ChaveNFe> como primeiro filho de <NFe>
import { parseStringPromise } from 'xml2js';
import { ParsedNota } from '../../types/nota';
import { str, num, cleanDoc, parseDate, extractCnpj, toCompetencia } from './helpers';

export async function parseNfseSp(xml: string): Promise<ParsedNota> {
  const root = await parseStringPromise(xml, {
    explicitArray: false,
    tagNameProcessors: [(name) => name.split(':').pop() ?? name],
    ignoreAttrs: false,
  });

  const nfe = (root['NFe'] ?? root) as Record<string, unknown>;

  // Chave
  const chaveNfe = (nfe['ChaveNFe'] ?? {}) as Record<string, unknown>;
  const numero        = str(chaveNfe['NumeroNFe'] ?? nfe['NumeroNFe']);
  const codigoVerif   = str(chaveNfe['CodigoVerificacao'] ?? '');
  const chaveNacional = str(chaveNfe['ChaveNotaNacional'] ?? '');
  // Preferir chaveNacional (44 dígitos) para unicidade; fallback em codigoVerif
  const chaveAcesso = chaveNacional || codigoVerif ||
    `SP-${str(chaveNfe['InscricaoPrestador'])}-${numero}`;

  const dataEmissao = parseDate(nfe['DataEmissaoNFe'] ?? nfe['DataEmissao']);
  // SP: DataFatoGeradorNFe é a competência do serviço
  const competencia = toCompetencia(nfe['DataFatoGeradorNFe']);

  // Prestador
  const prestDoc = (nfe['CPFCNPJPrestador'] ?? {}) as Record<string, unknown>;
  const cnpjEmitente = cleanDoc(str(prestDoc['CNPJ'] ?? prestDoc['CPF'] ?? ''));
  const nomeEmitente = str(nfe['RazaoSocialPrestador'] ?? '');

  // Tomador
  const tomDoc = (nfe['CPFCNPJTomador'] ?? {}) as Record<string, unknown>;
  const cnpjTomador = cleanDoc(str(tomDoc['CNPJ'] ?? tomDoc['CPF'] ?? ''));
  const nomeTomador = str(nfe['RazaoSocialTomador'] ?? '');

  // Valores
  const valorServicos = num(nfe['ValorServicos']);
  // ValorDeducoes pode existir em SP NFS-e
  const valorDeducoes = num(nfe['ValorDeducoes'] ?? 0);
  const valorLiquido  = num(nfe['ValorLiquidoNFe'] ?? nfe['ValorLiquido']) ||
                        (valorServicos - valorDeducoes);
  const valorIss  = num(nfe['ValorISS']);
  const issStr    = str(nfe['ISSRetido'] ?? '').toLowerCase();
  const issRetido = issStr === 'true' || issStr === 's' || issStr === '1';

  // Retenções federais
  const retIrrf   = num(nfe['ValorIR']     ?? nfe['ValorRetIR']);
  const retPis    = num(nfe['ValorPIS']    ?? nfe['ValorRetPIS']);
  const retCofins = num(nfe['ValorCOFINS'] ?? nfe['ValorRetCOFINS']);
  const retCsll   = num(nfe['ValorCSLL']   ?? nfe['ValorRetCSLL']);
  const retInss   = num(nfe['ValorINSS']   ?? nfe['ValorRetINSS']);

  const statusNfe = str(nfe['StatusNFe'] ?? '');
  const cancelada = statusNfe === 'C' || statusNfe === 'Cancelada';

  return {
    chaveAcesso,
    tipoDoc: 'nfse',
    numero,
    dataEmissao,
    competencia,
    natureza: 'servico_prestado',
    cnpjEmitente,
    nomeEmitente: nomeEmitente || undefined,
    cnpjTomador:  cnpjTomador  || undefined,
    nomeTomador:  nomeTomador  || undefined,
    valorBruto:   valorServicos,
    valorDeducoes,
    valorLiquido,
    issRetido,
    valorIss,
    retPis,
    retCofins,
    retCsll,
    retIrrf,
    retInss,
    icmsDebito:  0,
    icmsCredito: 0,
    cancelada,
    xmlRaw: xml,
  };
}
