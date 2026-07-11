import { cacheGet, cacheSet } from './cache';

// Cache-first genre+count fetch shared by /search and /categories (both had an
// identical inline copy of this block). Returns { genres, error } so each caller
// keeps its own degraded handling.
export async function fetchGenresWithCounts(supabase: any): Promise<{ genres: any[]; error: boolean }> {
  const cacheKey = 'genres_with_counts';
  const cached = cacheGet<any[]>(cacheKey);
  if (cached) return { genres: cached, error: false };
  const { data, error } = await supabase.rpc('get_genres_with_counts');
  if (error) {
    console.error('genres query failed:', error.message);
    return { genres: [], error: true };
  }
  const genres = data || [];
  cacheSet(cacheKey, genres, 10 * 60 * 1000);
  return { genres, error: false };
}

// Games (id 6014) first, then its subgenres (App Store genre_id 70xx),
// then everything else alphabetically. Returns a copy — never mutates input
// (callers may pass a shared cached array).
export function sortGenres<T extends Record<string, any>>(genres: T[]): T[] {
  return [...(genres || [])].sort((a: any, b: any) => {
    if (a.id === 6014) return -1;
    if (b.id === 6014) return 1;
    const aSub = a.genre_id && String(a.genre_id).startsWith('70');
    const bSub = b.genre_id && String(b.genre_id).startsWith('70');
    if (aSub && bSub) return a.genre_name.localeCompare(b.genre_name);
    if (aSub) return -1;
    if (bSub) return 1;
    return a.genre_name.localeCompare(b.genre_name);
  });
}
