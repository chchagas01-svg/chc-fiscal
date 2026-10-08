// Converte string ou array (xml2js com explicitArray:false pode retornar ambos)
export function str(v: unknown): string {
  if (Array.isArray(v)) return String(v[0] ?? '');
  return String(v ?? '');
}

export function num(v: unknown): number {
  const n = parseFloat(str(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// Converte número em formato brasileiro ("5.490,00") — usado para valores extraídos de
// texto livre (discriminação do serviço), onde não vem no formato XML (ponto decimal).
export function numBR(v: unknown): number {
  const n = parseFloat(str(v).replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

export function bool(v: unknown): boolean {
  const s = str(v).trim();
  return s === '1' || s.toLowerCase() === 'true' || s.toLowerCase() === 'sim';
}

// Limpa CNPJ/CPF deixando só dígitos
export function cleanDoc(v: unknown): string {
  return str(v).replace(/\D/g, '');
}

// Navega em obj com caminho 'a.b.c', retornando undefined se não existir
export function dig(obj: unknown, ...path: string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

// Parse de data ISO ou brasileira → Date
export function parseDate(v: unknown): Date {
  const s = str(v).trim();
  if (!s) return new Date(0);
  // YYYY-MM-DD ou YYYY-MM-DDTHH:mm:ss
  const d = new Date(s.substring(0, 10));
  return isNaN(d.getTime()) ? new Date(0) : d;
}

// Extrai competência YYYY-MM de data ISO (YYYY-MM-DD...) ou brasileira (DD/MM/YYYY)
export function toCompetencia(v: unknown): string | undefined {
  const s = str(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const br = s.match(/^\d{2}\/(\d{2})\/(\d{4})/);
  if (br) return `${br[2]}-${br[1]}`;
  return undefined;
}

// Extrair CNPJ de elemento CpfCnpj ou Cnpj/Cpf
export function extractCnpj(el: unknown): string {
  if (!el || typeof el !== 'object') return '';
  const o = el as Record<string, unknown>;
  return cleanDoc(o['Cnpj'] ?? o['CNPJ'] ?? o['Cpf'] ?? o['CPF'] ?? '');
}

// Testa vários nós candidatos e usa o primeiro que resultar em um documento válido.
// Municípios ABRASF variam onde colocam o CNPJ: algumas prefeituras envolvem em <CpfCnpj>,
// outras colocam <Cnpj>/<Cpf> direto no bloco de Identificacao — sem isso, a extração falha
// silenciosamente (o nome sai certo, mas o CNPJ fica vazio).
export function extractCnpjEmCandidatos(...candidatos: unknown[]): string {
  for (const c of candidatos) {
    const doc = extractCnpj(c);
    if (doc) return doc;
  }
  return '';
}
