// Gera o arquivo de importação "DES" (serviços tomados) do sistema de NFS-e de Campinas —
// layout de colunas fixas reverso-engenheirado a partir de um arquivo de referência real
// (ver memória feedback_campinas_des_layout). Regra de inclusão: só entram notas cujo
// PRESTADOR está em município diferente do tomador — prestadores do mesmo município já são
// capturados automaticamente pela própria Prefeitura (confirmado pelo usuário em 10/2026).
import { parseStringPromise } from 'xml2js';
import { query } from '../../config/database';

function pad(s: unknown, len: number): string {
  const str = String(s ?? '');
  return str.length >= len ? str.substring(0, len) : str + ' '.repeat(len - str.length);
}
function num15(v: number | string): string {
  return pad((Number(v) || 0).toFixed(2), 15);
}
function s(v: unknown): string { return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''); }
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
  tipoLogr: string; nomeLogr: string; numeroEndereco: string; complementoBairro: string;
  simplesFlag: 'S' | 'N'; cTribNac: string; regime: 'RPP' | 'RNF';
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
    return {
      cMunPrestador: s(enderNac['cMun']), cidadeNome: s(inf['xLocEmi']), uf: s(enderNac['UF']), cep: s(enderNac['CEP']),
      tipoLogr: tipo, nomeLogr: nome, numeroEndereco: s(enderNac['nro']),
      complementoBairro: [s(enderNac['xCpl']), s(enderNac['xBairro'])].filter(Boolean).join(' - '),
      simplesFlag: (opSimpNac === '2' || opSimpNac === '3') ? 'S' : 'N',
      cTribNac: s(cServ['cTribNac']),
      regime: itemNum === 1 ? 'RNF' : 'RPP',
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
    return {
      cMunPrestador: s(end['CodigoMunicipio']), cidadeNome: '', uf: s(end['Uf']), cep: s(end['Cep']),
      tipoLogr: tipo, nomeLogr: nome, numeroEndereco: s(end['Numero']),
      complementoBairro: [s(end['Complemento']), s(end['Bairro'])].filter(Boolean).join(' - '),
      simplesFlag: s(abrasfInf['OptanteSimplesNacional']) === '1' ? 'S' : 'N',
      cTribNac: item,
      regime: itemNum === 1 ? 'RNF' : 'RPP',
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

function buildLine(end: Endereco, item4: string, cnae9: string, n: NotaRow, competencia: string): string {
  const valorServico = Number(n.valor_bruto);
  const valorIss = Number(n.valor_iss);
  const aliquota = valorServico > 0 ? (valorIss / valorServico * 100) : 0;
  const dataEmissao = new Date(n.data_emissao).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

  let out = 'T';
  out += pad(dataEmissao, 10);
  out += pad(competencia, 7);
  out += pad(n.numero, 20);
  out += 'OM1';
  out += pad(n.cnpj_emitente.replace(/\D/g, '').padStart(14, '0'), 14);
  out += pad('', 20);
  out += pad(n.nome_emitente, 150);
  out += pad(end.cMunPrestador, 7);
  out += pad(end.simplesFlag + 'NN', 3);
  out += pad(end.cep.replace(/\D/g, ''), 8);
  out += pad(end.tipoLogr, 25);
  out += pad(end.nomeLogr, 50);
  out += pad(end.numeroEndereco, 70);
  out += pad(end.complementoBairro, 60);
  out += pad(end.uf, 2);
  out += '1058';
  out += pad(end.cidadeNome, 50);
  out += pad(item4, 4) + ' ' + pad(cnae9, 9);
  out += pad('', 15);
  out += 'LOC' + pad('3509502', 7) + pad('SP', 2);
  out += pad('', 104);
  out += 'BRA' + pad('3509502', 7) + pad('SP', 2);
  out += pad('', 105);
  out += '1' + end.regime;
  out += pad(aliquota.toFixed(2), 5);
  out += num15(valorServico);
  out += num15(0); out += num15(0); out += num15(0);
  out += num15(valorServico);
  out += num15(n.ret_pis); out += num15(n.ret_cofins); out += num15(n.ret_csll); out += num15(n.ret_irrf); out += num15(n.ret_inss);
  out += num15(0);
  out += num15(valorIss);
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
    : ['H' + pad(inscricaoMunicipal.replace(/\D/g, ''), 9), ...linhas].join('\r\n') + (linhas.length ? '\r\n' : '');

  return {
    conteudo, inscricaoMunicipal, competencia,
    total_notas: notasRes.rows.length,
    incluidas: linhas.length,
    excluidas_mesmo_municipio: excluidasMesmoMunicipio,
    faltando_mapeamento: faltando,
    notas_ids: idsIncluidos,
  };
}
