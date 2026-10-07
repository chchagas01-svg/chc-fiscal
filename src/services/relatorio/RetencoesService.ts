// Retenções federais sobre serviços tomados — base para EFD-Reinf e DARF
//   IRRF 1708  → R-4020 (IR retido de PJ, 1,5% serviços profissionais)
//   CSRF 5952  → R-4020 (PIS 0,65% + COFINS 3% + CSLL 1%)
//   INSS 11%   → R-2010 (retenção previdenciária, cessão de mão de obra/empreitada)
import { query } from '../../config/database';

type Regime = 'nao_optante' | 'simples' | 'mei' | 'desconhecido';

const ALIQ_IRRF = 0.015;
const ALIQ_CSRF = 0.0465;
const LIMITE_DISPENSA = 10; // retenção ≤ R$ 10,00 é dispensada (IRRF e CSRF)

// Regime do prestador declarado no XML (NFS-e Nacional, Prefeitura SP ou ABRASF)
function regimePrestador(xml: string): Regime {
  const nac = xml.match(/<(?:\w+:)?opSimpNac>\s*(\d)/);
  if (nac) return nac[1] === '1' ? 'nao_optante' : nac[1] === '2' ? 'mei' : 'simples';
  const sp = xml.match(/<(?:\w+:)?OpcaoSimples>\s*(\d)/);
  if (sp) return sp[1] === '0' ? 'nao_optante' : 'simples';
  const abrasf = xml.match(/<(?:\w+:)?OptanteSimplesNacional>\s*(\d)/);
  if (abrasf) return abrasf[1] === '1' ? 'simples' : 'nao_optante';
  return 'desconhecido';
}

function codigoServico(xml: string): string | undefined {
  const m = xml.match(/<(?:\w+:)?(?:cTribNac|CodigoServico|ItemListaServico)>\s*([^<\s]+)/);
  return m?.[1];
}

// PIS/COFINS destacados no XML (podem não ter sido retidos)
function pisCofinsDestacados(xml: string): number {
  const v = (tag: string) => parseFloat(xml.match(new RegExp(`<(?:\\w+:)?${tag}>\\s*([\\d.]+)`))?.[1] ?? '0') || 0;
  return v('vPis') + v('vCofins');
}

const r2 = (n: number) => Math.round(n * 100) / 100;

interface NotaRow {
  id: number; numero: string; data_emissao: Date; cnpj_emitente: string; nome_emitente: string | null;
  valor_bruto: string; valor_liquido: string;
  ret_irrf: string; ret_pis: string; ret_cofins: string; ret_csll: string; ret_inss: string;
  xml_raw: string | null;
}

export async function relatorioRetencoes(empresaId: number, competencia: string) {
  const res = await query<NotaRow>(
    `SELECT id, numero, data_emissao, cnpj_emitente, nome_emitente, valor_bruto, valor_liquido,
            ret_irrf, ret_pis, ret_cofins, ret_csll, ret_inss, xml_raw
       FROM notas
      WHERE empresa_id = $1 AND competencia = $2 AND natureza = 'servico_tomado' AND cancelada = false
      ORDER BY nome_emitente, data_emissao, id`,
    [empresaId, competencia]
  );

  const notas = res.rows.map(n => {
    const xml = n.xml_raw ?? '';
    const bruto = parseFloat(n.valor_bruto);
    const irrf = parseFloat(n.ret_irrf), pis = parseFloat(n.ret_pis), cofins = parseFloat(n.ret_cofins);
    const csll = parseFloat(n.ret_csll), inss = parseFloat(n.ret_inss);
    const csrf = r2(pis + cofins + csll);
    const regime = regimePrestador(xml);

    const alertas: string[] = [];
    if (regime === 'nao_optante') {
      if (irrf === 0 && csrf === 0)
        alertas.push(`Prestador não optante sem retenção destacada — se o serviço for sujeito: IRRF ${fmt(bruto * ALIQ_IRRF)} / CSRF ${fmt(bruto * ALIQ_CSRF)}`);
      else if (csll > 0 && pis + cofins === 0 && pisCofinsDestacados(xml) > 0)
        alertas.push(`PIS/COFINS destacados (${fmt(pisCofinsDestacados(xml))}) mas não descontados do líquido — CSRF integral seria ${fmt(bruto * ALIQ_CSRF)}`);
    }
    if (regime === 'desconhecido') alertas.push('Regime do prestador não informado no XML');
    if (irrf > 0 && irrf <= LIMITE_DISPENSA) alertas.push('IRRF ≤ R$ 10,00 — retenção dispensada');
    if (csrf > 0 && csrf <= LIMITE_DISPENSA) alertas.push('CSRF ≤ R$ 10,00 — retenção dispensada');

    return {
      id: n.id, numero: n.numero, data_emissao: n.data_emissao,
      cnpj_prestador: n.cnpj_emitente, prestador: n.nome_emitente,
      regime, codigo_servico: codigoServico(xml),
      valor_bruto: bruto, valor_liquido: parseFloat(n.valor_liquido),
      irrf_1708: irrf, pis, cofins, csll, csrf_5952: csrf, inss_r2010: inss,
      alertas,
    };
  });

  const soma = (k: 'irrf_1708' | 'pis' | 'cofins' | 'csll' | 'csrf_5952' | 'inss_r2010' | 'valor_bruto') =>
    r2(notas.reduce((s, n) => s + n[k], 0));

  // R-4020 é por beneficiário: agrupa por CNPJ do prestador
  const porPrestador = new Map<string, { cnpj: string; prestador: string | null; notas: number; valor_bruto: number; irrf_1708: number; csrf_5952: number; inss_r2010: number }>();
  for (const n of notas) {
    if (n.irrf_1708 + n.csrf_5952 + n.inss_r2010 === 0) continue;
    const p = porPrestador.get(n.cnpj_prestador) ??
      { cnpj: n.cnpj_prestador, prestador: n.prestador, notas: 0, valor_bruto: 0, irrf_1708: 0, csrf_5952: 0, inss_r2010: 0 };
    p.notas++; p.valor_bruto = r2(p.valor_bruto + n.valor_bruto);
    p.irrf_1708 = r2(p.irrf_1708 + n.irrf_1708); p.csrf_5952 = r2(p.csrf_5952 + n.csrf_5952);
    p.inss_r2010 = r2(p.inss_r2010 + n.inss_r2010);
    porPrestador.set(n.cnpj_prestador, p);
  }

  return {
    competencia,
    totais: {
      notas: notas.length,
      valor_bruto: soma('valor_bruto'),
      irrf_1708: soma('irrf_1708'),
      csrf_5952: { pis: soma('pis'), cofins: soma('cofins'), csll: soma('csll'), total: soma('csrf_5952') },
      inss_r2010: soma('inss_r2010'),
      notas_com_alerta: notas.filter(n => n.alertas.length > 0).length,
    },
    por_prestador: [...porPrestador.values()],
    notas,
  };
}

function fmt(n: number): string {
  return 'R$ ' + r2(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
