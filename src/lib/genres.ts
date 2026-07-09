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
