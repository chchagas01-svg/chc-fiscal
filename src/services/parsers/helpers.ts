// Converte string ou array (xml2js com explicitArray:false pode retornar ambos)
export function str(v: unknown): string {
  if (Array.isArray(v)) return String(v[0] ?? '');
  return String(v ?? '');
}

export function num(v: unknown): number {
  const n = parseFloat(str(v).replace(',', '.'));
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

// Extrair CNPJ de elemento CpfCnpj ou Cnpj/Cpf
export function extractCnpj(el: unknown): string {
  if (!el || typeof el !== 'object') return '';
  const o = el as Record<string, unknown>;
  return cleanDoc(o['Cnpj'] ?? o['CNPJ'] ?? o['Cpf'] ?? o['CPF'] ?? '');
}
