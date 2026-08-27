import { cached } from './cache';

// Cache-first genre+count fetch shared by /search and /categories (both had an
// identical inline copy of this block). Returns { genres, error } so each caller
// keeps its own degraded handling.
export async function fetchGenresWithCounts(supabase: any): Promise<{ genres: any[]; error: boolean }> {
  const { data, error } = await cached<any[]>('genres_with_counts', 10 * 60 * 1000, () =>
    supabase.rpc('get_genres_with_counts')
  );
  return { genres: data || [], error: !!error };
}

// Apple's game categories (Arcade, Puzzle, …) are the App Store genre_id 70xx
// codes, distinct from the top-level genres.
export function isGameSubgenre(g: Record<string, any>): boolean {
  return !!g.genre_id && String(g.genre_id).startsWith('70');
}

// Games (id 6014) first, then its subgenres (App Store genre_id 70xx),
// then everything else alphabetically. Returns a copy — never mutates input
// (callers may pass a shared cached array).
export function sortGenres<T extends Record<string, any>>(genres: T[]): T[] {
  return [...(genres || [])].sort((a: any, b: any) => {
    if (a.id === 6014) return -1;
    if (b.id === 6014) return 1;
    const aSub = isGameSubgenre(a);
    const bSub = isGameSubgenre(b);
    if (aSub && bSub) return a.genre_name.localeCompare(b.genre_name);
    if (aSub) return -1;
    if (bSub) return 1;
    return a.genre_name.localeCompare(b.genre_name);
  });
}
