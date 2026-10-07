// Parser NFS-e padrão nacional — suporta dois formatos:
//   1. DFe 3.0 SEFAZ (tag lowercase: <infNFSe>, <emit>, <DPS>)  — novo padrão nacional
//   2. ABRASF legado (tag PascalCase: <InfNFSe>, <Prestador>, <Servico>)
import { parseStringPromise } from 'xml2js';
import { ParsedNota } from '../../types/nota';
import { str, num, bool, cleanDoc, dig, parseDate, extractCnpj, toCompetencia } from './helpers';

export async function parseNfseNacional(xml: string): Promise<ParsedNota> {
  const root = await parseStringPromise(xml, {
    explicitArray: false,
    tagNameProcessors: [(name) => name.split(':').pop() ?? name],
    ignoreAttrs: false,
  });

  const nfse = (root['NFSe'] ?? root) as Record<string, unknown>;

  // ── Detecta formato DFe 3.0 (infNFSe minúsculo) ──────────────────────────
  const infDfe3 = nfse['infNFSe'] as Record<string, unknown> | undefined;
  if (infDfe3) {
    return parseDfe3(infDfe3, xml);
  }

  // ── Formato ABRASF legado (InfNFSe maiúsculo) ─────────────────────────────
  const inf: Record<string, unknown> =
    (dig(nfse, 'InfNFSe') as Record<string, unknown>) ??
    (dig(nfse, 'NFSe', 'InfNFSe') as Record<string, unknown>) ??
    {};

  return parseAbrasf(inf, xml);
}

// ── DFe 3.0 ──────────────────────────────────────────────────────────────────
function parseDfe3(inf: Record<string, unknown>, xml: string): ParsedNota {
  // Id do atributo: NFS3550308125382159000026000000000005082601893432324  9
  const attrs = (inf['$'] ?? {}) as Record<string, unknown>;
  const id = str(attrs['Id'] ?? '');

  const numero = str(inf['nNFSe'] ?? inf['numero'] ?? '');
  const cStat = str(inf['cStat'] ?? '');
  // 100=Autorizada, 102=Substituída, 104=Cancelada
  const cancelada = cStat === '104' || cStat === '105' || cStat === '106';

  // Emitente fica em <emit>
  const emit = (inf['emit'] ?? {}) as Record<string, unknown>;
  const cnpjEmitente = cleanDoc(str(emit['CNPJ'] ?? emit['CPF'] ?? ''));
  const nomeEmitente = str(emit['xNome'] ?? '');

  // Valores diretamente em <valores> (NFS-e level)
  const valoresNfe = (inf['valores'] ?? {}) as Record<string, unknown>;
  const valorBase    = num(valoresNfe['vBC']    ?? valoresNfe['vServ'] ?? 0);
  const valorIss     = num(valoresNfe['vISSQN'] ?? valoresNfe['vISS']  ?? 0);
  const valorLiquido = num(valoresNfe['vLiq']   ?? valorBase);

  // DPS → infDPS traz tomador, data emissão e valores detalhados
  const dps    = (inf['DPS']    ?? {}) as Record<string, unknown>;
  const infDps = (dps['infDPS'] ?? {}) as Record<string, unknown>;

  // Data de emissão
  const dhEmi = str(infDps['dhEmi'] ?? inf['dhProc'] ?? '');
  const dataEmissao = dhEmi ? new Date(dhEmi) : new Date();
  const competencia = toCompetencia(infDps['dCompet']);

  // Tomador
  const toma = (infDps['toma'] ?? {}) as Record<string, unknown>;
  const cnpjTomador = cleanDoc(str(toma['CNPJ'] ?? toma['CPF'] ?? ''));
  const nomeTomador = str(toma['xNome'] ?? '');

  // Valores detalhados do DPS
  const valoresDps  = (infDps['valores'] ?? {}) as Record<string, unknown>;
  const vServPrest  = (valoresDps['vServPrest'] ?? {}) as Record<string, unknown>;
  const valorServicos = num(vServPrest['vServ'] ?? 0) || valorBase;

  // ISS retention — tpRetISSQN: 1=não retido, 2=retido pelo tomador, 3=retido intermediário
  const trib     = (valoresDps['trib']    ?? {}) as Record<string, unknown>;
  const tribMun  = (trib['tribMun']       ?? {}) as Record<string, unknown>;
  const totTrib  = (trib['totTrib']       ?? {}) as Record<string, unknown>;
  const vTotTrib = (totTrib['vTotTrib']   ?? {}) as Record<string, unknown>;
  const tpRetISSQN = str(tribMun['tpRetISSQN'] ?? '');
  const issRetido = tpRetISSQN === '2' || tpRetISSQN === '3';

  // Tributos federais totais (vTotTribFed engloba IRRF+PIS+COFINS+CSLL+INSS)
  const totalTribFed = num(vTotTrib['vTotTribFed'] ?? 0);

  // chaveAcesso = Id do atributo (50 chars) — garante unicidade
  const chaveAcesso = id || `NFSe-${cnpjEmitente}-${numero}`;

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
    valorBruto:    valorServicos,
    valorDeducoes: 0,
    valorLiquido,
    issRetido,
    valorIss,
    retPis:    0,
    retCofins: 0,
    retCsll:   0,
    retIrrf:   totalTribFed,  // vTotTribFed é predominantemente IRRF neste contexto
    retInss:   0,
    icmsDebito:  0,
    icmsCredito: 0,
    cancelada,
    xmlRaw: xml,
  };
}

// ── ABRASF legado ─────────────────────────────────────────────────────────────
function parseAbrasf(inf: Record<string, unknown>, xml: string): ParsedNota {
  const numero = str(inf['Numero']);
  const codigoVerificacao = str(inf['CodigoVerificacao']);
  const dataEmissao = parseDate(inf['DataEmissao'] ?? inf['Competencia']);
  const competencia = toCompetencia(
    inf['Competencia'] ?? dig(inf, 'DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Competencia')
  );

  const prestador = (inf['Prestador'] ?? inf['PrestadorServico']) as Record<string, unknown> | undefined;
  const cnpjPrestador = extractCnpj(
    dig(prestador, 'CpfCnpj') ?? dig(prestador, 'IdentificacaoPrestador', 'CpfCnpj') ?? {}
  );
  const nomePrestador = str(dig(prestador, 'RazaoSocial') ?? dig(prestador, 'NomeFantasia') ?? '');

  const tomador = (inf['Tomador'] ?? inf['TomadorServico']) as Record<string, unknown> | undefined;
  const cnpjTomador = extractCnpj(
    dig(tomador, 'IdentificacaoTomador', 'CpfCnpj') ??
    dig(tomador, 'CpfCnpj') ??
    {}
  );
  const nomeTomador = str(dig(tomador, 'RazaoSocial') ?? '');

  const servico = (inf['Servico'] ?? {}) as Record<string, unknown>;
  const valores = (dig(servico, 'Valores') ?? {}) as Record<string, unknown>;

  const valorServicos = num(valores['ValorServicos']);
  const valorDeducoes = num(valores['ValorDeducoes']);
  const valorLiquido = num(valores['ValorLiquidoNfse']) || (valorServicos - valorDeducoes);
  const valorIss = num(valores['ValorIss'] ?? valores['ValorISSQN']);

  const tpRetISSQN = str(valores['tpRetISSQN'] ?? dig(servico, 'tpRetISSQN') ?? '');
  const issRetidoFlag = str(valores['IssRetido'] ?? '');
  let issRetido = false;
  if (tpRetISSQN) {
    issRetido = tpRetISSQN === '2' || tpRetISSQN === '3';
  } else if (issRetidoFlag) {
    issRetido = issRetidoFlag === '1';
  }

  const tpRetPisCofins = str(valores['tpRetPisCofins'] ?? '');
  const retPis    = tpRetPisCofins !== '0' ? num(valores['ValorPis']   ?? valores['PisRetido'])    : 0;
  const retCofins = tpRetPisCofins !== '0' ? num(valores['ValorCofins'] ?? valores['CofinsRetido']) : 0;
  const retCsll   = num(valores['ValorCsll'] ?? valores['CsllRetido']);
  const retIrrf   = num(valores['ValorIr']   ?? valores['IrRetido']);
  const retInss   = num(valores['ValorInss'] ?? valores['InssRetido']);

  const municipio = str(dig(servico, 'CodigoMunicipio') ?? '');
  const chaveAcesso = codigoVerificacao || `${municipio}-${cnpjPrestador}-${numero}`;

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
    competencia,
    natureza: 'servico_prestado',
    cnpjEmitente: cnpjPrestador,
    nomeEmitente: nomePrestador,
    cnpjTomador:  cnpjTomador || undefined,
    nomeTomador:  nomeTomador || undefined,
    valorBruto:    valorServicos,
    valorDeducoes,
    valorLiquido,
    issRetido,
    valorIss,
    retPis, retCofins, retCsll, retIrrf, retInss,
    icmsDebito:  0,
    icmsCredito: 0,
    cancelada,
    chaveSubstituta: chaveSubstituta || undefined,
    xmlRaw: xml,
  };
}
