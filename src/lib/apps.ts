import { cacheGet, cacheSet } from './cache';

// Everything the app page needs from an apps row, with the developer/genre
// names embedded.
const APP_COLS =
  'id, app_store_id, bundle_id, app_store_name, display_name, copyright, icon_url:live_icon_url, oldest_icon_sha256, large_icon_sha256, large_icon_px, genre_id, developer_id, original_release_date, original_release_date_source, developers!apps_developer_id_fkey(artist_name), genres!apps_genre_id_fkey(genre_name)';

// app_store_name is the iTunes listing name ("Angry Birds HD Free") and
// disambiguates the many apps whose bundle display_name is identical.
export function appTitleOf(a: any): string {
  return a?.app_store_name || a?.display_name || a?.bundle_id || '';
}

// Resolve an /app/<param> URL to an apps row. A numeric param prefers the App
// Store ID (what public links use) and falls back to the internal id; a
// reverse-DNS param matches bundle_id. Anything else — and any miss — is "no
// such app" (404), while a query failure reports dbError so the caller serves
// a 503 rather than caching a 404 for a transient blip.
export async function resolveApp(
  supabase: any,
  rawParam: string
): Promise<{ app: any | null; dbError: boolean }> {
  const cacheKey = `app:${rawParam}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return { app: cached, dbError: false };

  const attempts: { col: string; value: string }[] = [];
  if (/^\d+$/.test(rawParam)) {
    // app_store_id is bigint; cap the probe at 10 digits so an absurd param is
    // "no such app" rather than a bigint-overflow DB error. Never match the
    // app_store_id=0 sentinel. (The old int4 ceiling of 2147483647 wrongly
    // 404'd modern ids — e.g. the 2021-era ids backfilled from gauthamp10.)
    if (rawParam !== '0' && rawParam.length <= 10) {
      attempts.push({ col: 'app_store_id', value: rawParam });
    }
    attempts.push({ col: 'id', value: rawParam });
  } else if (/\./.test(rawParam)) {
    attempts.push({ col: 'bundle_id', value: rawParam });
  }

  for (const { col, value } of attempts) {
    // Break ties by lowest id so duplicate app_store_ids / bundle_ids route
    // deterministically (and maybeSingle never trips on multiple rows).
    const { data, error } = await supabase
      .from('apps')
      .select(APP_COLS)
      .eq(col, value)
      .not('excluded', 'is', true)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return { app: null, dbError: true };
    if (data) {
      cacheSet(cacheKey, data, 10 * 60 * 1000);
      return { app: data, dbError: false };
    }
  }
  return { app: null, dbError: false };
}
