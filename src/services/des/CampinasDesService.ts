// Gera o arquivo de importação "DES" (serviços tomados) do sistema de NFS-e de Campinas —
// layout de colunas fixas reverso-engenheirado a partir de um arquivo de referência real
// (ver memória feedback_campinas_des_layout). Regra de inclusão: só entram notas cujo
// PRESTADOR está em município diferente do tomador — prestadores do mesmo município já são
// capturados automaticamente pela própria Prefeitura (confirmado pelo usuário em 10/2026).
import { parseStringPromise } from 'xml2js';
import { query } from '../../config/database';

// Nosso formato interno é "YYYY-MM"; o manual exige "MM/YYYY" no campo 03 (Data Competência).
function competenciaMMYYYY(competencia: string): string {
  const [ano, mes] = competencia.split('-');
  return `${mes}/${ano}`;
}

function pad(s: unknown, len: number): string {
  const str = String(s ?? '');
  return str.length >= len ? str.substring(0, len) : str + ' '.repeat(len - str.length);
}
function num15(v: number | string): string {
  return pad((Number(v) || 0).toFixed(2), 15);
}
function s(v: unknown): string { return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''); }
function num(v: unknown): number { const n = parseFloat(s(v).replace(',', '.')); return isNaN(n) ? 0 : n; }
function g(obj: unknown, ...path: string[]): unknown {
  let cur = obj;
  for (const k of path) { if (cur == null || typeof cur !== 'object') return undefined; cur = (cur as Record<string, unknown>)[k]; }
  return cur;
}

function splitTipoLogradouro(xLgr: string): { tipo: string; nome: string } {
  const tipos = ['Avenida', 'Alameda', 'Travessa', 'Praça', 'Estrada', 'Rodovia', 'Rua'];
  const up = xLgr.toUpperCase();
  for (const t of tipos) {
    if (up.startsWith(t.toUpperCase() + ' ')) return { tipo: t, nome: xLgr.substring(t.length + 1).trim() };
  }
  return { tipo: 'Rua', nome: xLgr };
}

interface Endereco {
  cMunPrestador: string; cidadeNome: string; uf: string; cep: string;
  tipoLogr: string; nomeLogr: string; numeroEndereco: string; bairro: string;
  simplesFlag: 'S' | 'N'; meiFlag: 'S' | 'N'; cTribNac: string; regime: 'RPP' | 'RNF';
  discriminacao: string; aliquotaNf: number;
}

async function extrairEndereco(xml: string): Promise<Endereco> {
  const root = await parseStringPromise(xml, { explicitArray: false, tagNameProcessors: [(n: string) => n.split(':').pop() ?? n] });

  const nfse = (root as Record<string, unknown>)['NFSe'] as Record<string, unknown> | undefined;
  const inf = nfse?.['infNFSe'] as Record<string, unknown> | undefined;
  if (inf) {
    const emit = (inf['emit'] ?? {}) as Record<string, unknown>;
    const dps = (g(inf, 'DPS', 'infDPS') ?? {}) as Record<string, unknown>;
    const prest = (dps['prest'] ?? {}) as Record<string, unknown>;
    const regTrib = (prest['regTrib'] ?? {}) as Record<string, unknown>;
    const cServ = (g(dps, 'serv', 'cServ') ?? {}) as Record<string, unknown>;
    const enderNac = (emit['enderNac'] ?? {}) as Record<string, unknown>;
    const xLgr = s(enderNac['xLgr']);
    const { tipo, nome } = splitTipoLogradouro(xLgr);
    const opSimpNac = s(regTrib['opSimpNac']); // 1=não optante, 2=MEI, 3=Simples — oposto do ABRASF
    // Produtos/licenças faturados por distribuidoras (ex.: SND) saem como "RNF" no layout de
    // referência; demais prestação de serviço como "RPP".
    const itemNum = Number(s(cServ['cTribNac']).substring(0, 2));
    const discriminacao = s(cServ['xDescServ']);
    // Alíquota declarada pelo próprio prestador no XML (padrão nacional: <valores><pAliqAplic>,
    // no nível da NFS-e, não dentro do DPS) — é a que o campo 42 do leiaute de Campinas pede,
    // não uma derivada de ISS÷serviço (os dois valores já vêm arredondados a 2 casas, e a
    // prefeitura recalcula ISS = alíquota×base e rejeita se não bater exatamente). Simples
    // Nacional costuma não ter esse campo na nota — por instrução do usuário, usa 5% quando
    // não constar (ver montagem da linha em buildLine).
    const valoresNfe = (inf['valores'] ?? {}) as Record<string, unknown>;
    const pAliq = num(valoresNfe['pAliqAplic']);
    return {
      cMunPrestador: s(enderNac['cMun']), cidadeNome: s(inf['xLocEmi']), uf: s(enderNac['UF']), cep: s(enderNac['CEP']),
      tipoLogr: tipo, nomeLogr: nome, numeroEndereco: s(enderNac['nro']),
      bairro: s(enderNac['xBairro']),
      simplesFlag: opSimpNac === '3' ? 'S' : 'N',
      meiFlag: opSimpNac === '2' ? 'S' : 'N',
      cTribNac: s(cServ['cTribNac']),
      regime: itemNum === 1 ? 'RNF' : 'RPP',
      discriminacao, aliquotaNf: pAliq,
    };
  }

  const abrasfInf = (g(root, 'Nfse', 'InfNfse') ?? g(root, 'CompNfse', 'Nfse', 'InfNfse')) as Record<string, unknown> | undefined;
  if (abrasfInf) {
    const prest = (abrasfInf['PrestadorServico'] ?? {}) as Record<string, unknown>;
    const end = (prest['Endereco'] ?? {}) as Record<string, unknown>;
    const servico = (abrasfInf['Servico'] ?? {}) as Record<string, unknown>;
    const xLgr = s(end['Endereco']);
    const { tipo, nome } = splitTipoLogradouro(xLgr);
    const item = s(servico['ItemListaServico']);
    const itemNum = Number(item.substring(0, 2));
    // ABRASF: OptanteSimplesNacional 1=optante Simples, 2=não optante (campo próprio não existe p/ MEI)
    const optanteSimples = s(abrasfInf['OptanteSimplesNacional']) === '1';
    const valores = (servico['Valores'] ?? {}) as Record<string, unknown>;
    const pAliq = num(valores['Aliquota']);
    return {
      cMunPrestador: s(end['CodigoMunicipio']), cidadeNome: '', uf: s(end['Uf']), cep: s(end['Cep']),
      tipoLogr: tipo, nomeLogr: nome, numeroEndereco: s(end['Numero']),
      bairro: s(end['Bairro']),
      simplesFlag: optanteSimples ? 'S' : 'N',
      meiFlag: 'N',
      cTribNac: item,
      regime: itemNum === 1 ? 'RNF' : 'RPP',
      discriminacao: s(g(servico, 'Discriminacao') ?? ''), aliquotaNf: pAliq,
    };
  }

  throw new Error('Formato de XML não reconhecido para extração de endereço');
}

interface NotaRow {
  id: number; numero: string; data_emissao: Date; cnpj_emitente: string; nome_emitente: string;
  valor_bruto: string; valor_iss: string;
  ret_pis: string; ret_cofins: string; ret_csll: string; ret_irrf: string; ret_inss: string;
  xml_raw: string | null;
}

// Posições conferidas campo a campo contra o manual oficial "Layout de importação de Serviços
// Tomados" (IMA 2024, fornecido pelo usuário em 10/2026) — números de campo nos comentários.
function buildLine(end: Endereco, codigoServico: string, cnae9: string, n: NotaRow, competencia: string): string {
  const valorServico = Number(n.valor_bruto);
  // Alíquota: a declarada na nota original (campo pAliqAplic do XML); quando não consta ou é
  // zero (comum para Simples Nacional, que recolhe ISS via DAS sem destacar alíquota na nota),
  // usa 5% por instrução do usuário. O ISS é recalculado a partir dela — não reaproveita o
  // valor_iss já gravado no banco, que pode ter sido arredondado por outro caminho e não bater
  // exatamente com alíquota×base na conferência da prefeitura (campo 54 = campo 42 × campo 47).
  const aliquota = end.aliquotaNf > 0 ? end.aliquotaNf : 5;
  // A prefeitura TRUNCA (não arredonda) ao conferir campo54 = campo42×campo47 — confirmado:
  // só as notas cujo 3º decimal pedia arredondar PARA CIMA (ex.: 21,77775→21,78) foram
  // rejeitadas; as que arredondavam para baixo ou davam exato passaram. O pequeno epsilon
  // evita que ruído de ponto flutuante derrube por engano um valor que deveria ser exato.
  const valorIss = Math.floor(valorServico * aliquota + 1e-7) / 100;
  const dataEmissao = new Date(n.data_emissao).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  const discriminacao = (end.discriminacao || '').replace(/[\r\n]+/g, ' ').trim();

  let out = 'T';                                                    // 01 identificação (1)
  out += pad(dataEmissao, 10);                                      // 02 data emissão (10)
  out += pad(competenciaMMYYYY(competencia), 7);                    // 03 data competência (7) — formato MM/YYYY
  out += pad(n.numero.replace(/\D/g, ''), 15);                      // 04 número doc. fiscal (15)
  out += pad('', 5);                                                // 05 série (5) — não usamos série
  out += 'OM';                                                      // 06 modelo doc. fiscal (2) — NF de Outro Município
  out += '1';                                                       // 07 tipo prestador (1) — 1=Nacional
  out += pad(n.cnpj_emitente.replace(/\D/g, '').padStart(14, '0'), 14); // 08 CPF/CNPJ prestador (14)
  out += pad('', 20);                                               // 09 doc. identificação exterior (20) — N/A
  out += pad(n.nome_emitente, 150);                                 // 10 nome/razão social (150)
  out += pad(end.cMunPrestador, 7);                                 // 11 código município prestador (7)
  out += end.simplesFlag;                                           // 12 optante Simples (1)
  out += end.meiFlag;                                               // 13 optante MEI (1)
  out += 'N';                                                       // 14 estabelecido no município (1) — sempre N (só incluímos fora de Campinas)
  out += pad(end.cep.replace(/\D/g, ''), 8);                        // 15 CEP prestador (8)
  out += pad(end.tipoLogr, 25);                                     // 16 tipo logradouro (25)
  out += pad(end.nomeLogr, 50);                                     // 17 nome logradouro (50)
  out += pad(end.numeroEndereco, 10);                               // 18 número logradouro (10)
  out += pad('', 60);                                               // 19 complemento (60) — exige formato "TIPO:valor" (tabela do manual); deixado em branco (opcional) por não termos esse dado estruturado
  out += pad(end.bairro, 60);                                       // 20 bairro (60)
  out += pad(end.uf, 2);                                            // 21 UF prestador (2)
  out += pad('', 4);                                                // 22 país prestador (4) — só exterior
  out += pad(end.cidadeNome, 50);                                   // 23 cidade prestador (50)
  out += pad(codigoServico, 5);                                     // 24 código do serviço (5)
  out += pad(cnae9, 9);                                             // 25 código CNAE (9)
  out += pad('', 15);                                               // 26 código obra (15) — N/A
  out += 'LOC';                                                     // 27 local da prestação (3) — serviço prestado no município do tomador
  out += pad('3509502', 7);                                         // 28 código município local prestação (7)
  out += pad('SP', 2);                                              // 29 UF prestação (2)
  out += pad('', 50 + 50 + 4);                                      // 30+31+32 município/estado/país exterior prestação — N/A
  out += 'BRA';                                                     // 33 local do resultado da prestação (3)
  out += pad('3509502', 7);                                         // 34 código município resultado (7)
  out += pad('SP', 2);                                              // 35 UF resultado (2)
  out += pad('', 50 + 50 + 4);                                      // 36+37+38 município/estado/país exterior resultado — N/A
  out += ' ';                                                       // 39 motivo da não retenção (1) — N/A (serviço normalmente tributado)
  out += '1';                                                       // 40 exigibilidade do ISS (1) — 1=Exigível
  out += end.regime;                                                // 41 tipo recolhimento (3) — RPP ou RNF
  out += pad(aliquota.toFixed(2), 5);                               // 42 alíquota ISS (5)
  out += num15(valorServico);                                       // 43 valor do serviço (15)
  out += num15(0);                                                  // 44 valor das deduções (15)
  out += num15(0);                                                  // 45 desconto incondicionado (15)
  out += num15(0);                                                  // 46 desconto condicionado (15)
  out += num15(valorServico);                                       // 47 base de cálculo (15)
  out += num15(n.ret_pis);                                          // 48 valor PIS (15)
  out += num15(n.ret_cofins);                                       // 49 valor COFINS (15)
  out += num15(n.ret_inss);                                         // 50 valor INSS (15)
  out += num15(n.ret_irrf);                                         // 51 valor IR (15)
  out += num15(n.ret_csll);                                         // 52 valor CSLL (15)
  out += num15(0);                                                  // 53 outras retenções (15)
  out += num15(valorIss);                                           // 54 valor do ISS (15)
  out += pad(discriminacao, 2000);                                  // 55 discriminação dos serviços (2000)
  return out;
}

export interface GerarDesResultado {
  conteudo: string | null;
  inscricaoMunicipal: string;
  competencia: string;
  total_notas: number;
  incluidas: number;
  excluidas_mesmo_municipio: number;
  faltando_mapeamento: { numero: string; cnpj: string; prestador: string; item: string }[];
  notas_ids: number[];
}

export async function gerarDesCampinas(empresaId: number, competencia: string): Promise<GerarDesResultado> {
  const empRes = await query<{ municipio_ibge: string | null; cnpj: string }>(
    `SELECT municipio_ibge, cnpj FROM empresas WHERE id = $1`, [empresaId]
  );
  const empresa = empRes.rows[0];
  if (!empresa) throw new Error('Empresa não encontrada');
  const municipioTomador = empresa.municipio_ibge?.trim() || '3509502'; // Campinas por padrão

  const portalRes = await query<{ inscricao_municipal: string | null }>(
    `SELECT inscricao_municipal FROM portais_municipais WHERE empresa_id = $1 AND sistema = 'campinas_nfse' AND ativo = true`,
    [empresaId]
  );
  // O cabeçalho do arquivo exige a Inscrição Municipal (não o CNPJ, nem o login do portal) —
  // sem ela cadastrada em Portais Municipais, o arquivo sairia com o campo errado.
  if (!portalRes.rows[0]?.inscricao_municipal) {
    throw new Error('Inscrição municipal não cadastrada para esta empresa — configure em Portais Municipais antes de gerar o arquivo.');
  }
  const inscricaoMunicipal = portalRes.rows[0].inscricao_municipal;

  const notasRes = await query<NotaRow>(
    `SELECT id, numero, data_emissao, cnpj_emitente, nome_emitente, valor_bruto, valor_iss,
            ret_pis, ret_cofins, ret_csll, ret_irrf, ret_inss, xml_raw
       FROM notas
      WHERE empresa_id = $1 AND competencia = $2 AND natureza = 'servico_tomado'
        AND tipo_doc IN ('nfse', 'manual') AND cancelada = false
      ORDER BY data_emissao, numero`,
    [empresaId, competencia]
  );

  const mapRes = await query<{ item_lc116: string; codigo_cnae: string }>(`SELECT item_lc116, codigo_cnae FROM campinas_cnae_item`);
  const mapaItem = new Map(mapRes.rows.map(r => [r.item_lc116, r.codigo_cnae]));
  const ovrRes = await query<{ cnpj_prestador: string; item_lc116: string; codigo_cnae: string }>(`SELECT cnpj_prestador, item_lc116, codigo_cnae FROM campinas_cnae_override`);
  const mapaOverride = new Map(ovrRes.rows.map(r => [r.cnpj_prestador, { item: r.item_lc116, cnae: r.codigo_cnae }]));

  const linhas: string[] = [];
  const idsIncluidos: number[] = [];
  const faltando: GerarDesResultado['faltando_mapeamento'] = [];
  let excluidasMesmoMunicipio = 0;

  for (const n of notasRes.rows) {
    if (!n.xml_raw) {
      // Nota manual sem XML — tenta herdar endereço de outra nota do mesmo prestador
      const outra = await query<{ xml_raw: string }>(
        `SELECT xml_raw FROM notas WHERE cnpj_emitente = $1 AND xml_raw IS NOT NULL LIMIT 1`,
        [n.cnpj_emitente]
      );
      if (!outra.rows[0]) {
        faltando.push({ numero: n.numero, cnpj: n.cnpj_emitente, prestador: n.nome_emitente, item: '(sem XML, sem outra nota do prestador para herdar endereço)' });
        continue;
      }
      n.xml_raw = outra.rows[0].xml_raw;
    }

    const end = await extrairEndereco(n.xml_raw);
    if (end.cMunPrestador === municipioTomador) { excluidasMesmoMunicipio++; continue; }

    const cnpjLimpo = n.cnpj_emitente.replace(/\D/g, '');
    const override = mapaOverride.get(cnpjLimpo);
    const item4 = override?.item ?? end.cTribNac.replace(/\D/g, '').substring(0, 4).padStart(4, '0');
    const cnae9 = override?.cnae ?? mapaItem.get(item4);

    if (!cnae9) {
      faltando.push({ numero: n.numero, cnpj: n.cnpj_emitente, prestador: n.nome_emitente, item: `${item4.substring(0,2)}.${item4.substring(2)}` });
      continue;
    }

    linhas.push(buildLine(end, item4, cnae9, n, competencia));
    idsIncluidos.push(n.id);
  }

  const conteudo = faltando.length > 0
    ? null // não gera arquivo incompleto — força resolver os mapeamentos faltantes antes
    : ['H' + pad(inscricaoMunicipal, 30), ...linhas].join('\r\n') + (linhas.length ? '\r\n' : '');

  return {
    conteudo, inscricaoMunicipal, competencia,
    total_notas: notasRes.rows.length,
    incluidas: linhas.length,
    excluidas_mesmo_municipio: excluidasMesmoMunicipio,
    faltando_mapeamento: faltando,
    notas_ids: idsIncluidos,
  };
}
