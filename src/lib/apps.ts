import { cacheGet, cacheSet } from './cache';

// Everything the app page needs from an apps row, with the developer/genre
// names embedded.
const APP_COLS =
  'id, app_store_id, bundle_id, app_store_name, display_name, copyright, icon_url:live_icon_url, oldest_icon_sha256, large_icon_sha256, large_icon_px, genre_id, developer_id, original_release_date, original_release_date_source, developers!apps_developer_id_fkey(artist_name, artist_id), genres!apps_genre_id_fkey(genre_name)';

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

  // Run the attempts under a restriction (which rows are eligible). Break ties by
  // lowest id so duplicate app_store_ids / bundle_ids route deterministically
  // (and maybeSingle never trips on multiple rows). Returns {found} so the caller
  // can distinguish "no eligible row" from "DB error".
  const tryAttempts = async (
    restrict: (q: any) => any
  ): Promise<{ app: any | null; dbError: boolean; found: boolean }> => {
    for (const { col, value } of attempts) {
      const { data, error } = await restrict(
        supabase.from('apps').select(APP_COLS).eq(col, value)
      )
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) return { app: null, dbError: true, found: false };
      if (data) return { app: data, dbError: false, found: true };
    }
    return { app: null, dbError: false, found: false };
  };

  // Primary: live, non-excluded apps (unchanged hot path — junk stays hidden).
  let res = await tryAttempts((q) => q.not('excluded', 'is', true));
  if (res.dbError) return { app: null, dbError: true };
  // Fallback: catalog-seed stubs (excluded, but legit store listings we recorded
  // with no archived binary — twitappcheck-2014 etc.). Their page renders as a
  // thin catalog record. Only reached when no live app matched, so a real app
  // always wins over a seed of the same id.
  if (!res.found) {
    res = await tryAttempts((q) => q.like('excluded_reason', 'catalog-seed:%'));
    if (res.dbError) return { app: null, dbError: true };
  }
  if (res.app) {
    cacheSet(cacheKey, res.app, 10 * 60 * 1000);
    return { app: res.app, dbError: false };
  }
  return { app: null, dbError: false };
}
