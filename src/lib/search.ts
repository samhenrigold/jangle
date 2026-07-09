// Builds a prefix-match tsquery string that is always syntactically valid,
// or null when the input contains no usable tokens.
export function buildPrefixTsquery(q: string): string | null {
  const tokens = (q || '')
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter((t) => t.length > 0)
    .slice(0, 8); // defensive cap on term count
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}:*`).join(' & ');
}

export function clampPage(input: unknown): number {
  const n = Math.floor(Number(input));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function clampPageSize(input: unknown, def = 20, max = 50): number {
  const n = Math.floor(Number(input));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : def;
}
