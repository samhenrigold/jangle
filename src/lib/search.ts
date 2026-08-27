// Builds a prefix-match tsquery string that is always syntactically valid,
// or null when the input contains no usable tokens.
export function buildPrefixTsquery(q: string): string | null {
  const tokens = (q || '')
    .split(/\s+/)
    // Fold diacritics (é -> e) so "pokemon" matches the unaccented search_vector
    // lexeme for "Pokémon"; NFD splits the base char from its combining mark,
    // which \p{M} then strips. Must mirror the DB-side f_unaccent().
    .map((t) => t.normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter((t) => t.length > 0)
    .slice(0, 8); // defensive cap on term count
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}:*`).join(' & ');
}

// Reverse-DNS-shaped query (has a dot and a letter): the FTS tokenizer folds
// dots away, so bundle ids get their own exact/substring branches everywhere.
// Shared by the search page, /api/v1/apps, the emulator API, and /api/suggest.
export function looksLikeBundleId(q: string): boolean {
  return !!q && /^[A-Za-z0-9][\w.\-]*\.[\w.\-]+$/.test(q) && /[A-Za-z]/.test(q);
}

// Escape LIKE/ILIKE metachars so a literal %, _ or \ in user input matches
// itself rather than acting as a pattern. (Values are parameterized by
// supabase-js — this is about matching semantics, not SQL injection.)
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// Deep OFFSET pagination is O(offset) in Postgres; crawlers paging to
// page 2000+ were the DB's single biggest CPU cost. 400 pages covers
// every real reader (10k rows at the default page size).
export const MAX_PAGE = 400;

export function clampPage(input: unknown): number {
  const n = Math.floor(Number(input));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_PAGE) : 1;
}

export function clampPageSize(input: unknown, def = 20, max = 50): number {
  const n = Math.floor(Number(input));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : def;
}
