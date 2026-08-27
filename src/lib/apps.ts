import { cacheGet, cacheSet, cached } from './cache';

// The list-row column set shared by every app-list page (search, categories,
// most-archived, home, collections, recent, emulator API). Kept to what
// AppList.astro renders — add here, not per-page.
export const APP_LIST_COLS =
  'id, app_store_id, bundle_id, app_store_name, developer_id, genre_id, icon_url:live_icon_url, display_name, version_count, excluded, developers!apps_developer_id_fkey(artist_name)';

// Flatten the developers embed the way every list page does.
export function flattenAppRow(a: any) {
  return { ...a, developer_artist_name: a.developers?.artist_name };
}

// One page of the ranked-by-version-count list plus its total, fetched
// concurrently via the RPC pair (get_apps_sorted_by_version_count /
// get_apps_count). Shared by most-archived and category pages; search keeps
// its own block (its RPC choice is sort-dependent).
export async function loadRankedAppPage(
  supabase: any,
  opts: { page: number; pageSize: number; genreId?: number | null; cachePrefix: string }
): Promise<{ apps: any[]; total: number; totalPages: number; dbError: boolean }> {
  const { page, pageSize, genreId = null, cachePrefix } = opts;
  const [list, count] = await Promise.all([
    cached<any[]>(`${cachePrefix}:list:${page}:${pageSize}`, 5 * 60 * 1000, () =>
      supabase.rpc('get_apps_sorted_by_version_count', {
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
        p_genre_id: genreId,
        p_ascending: false,
        p_search_query: null,
      })
    ),
    cached<number>(`${cachePrefix}:count`, 10 * 60 * 1000, async () => {
      const { data, error } = await supabase.rpc('get_apps_count', {
        p_genre_id: genreId,
        p_search_query: null,
      });
      return { data: Number(Array.isArray(data) ? data[0] : data) || 0, error };
    }),
  ]);
  const total = Number(count.data) || 0;
  return {
    apps: list.data || [],
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    dbError: !!(list.error || count.error),
  };
}

// Everything the app page needs from an apps row, with the developer/genre
// names embedded.
const APP_COLS =
  'id, app_store_id, bundle_id, app_store_name, display_name, copyright, icon_url:live_icon_url, oldest_icon_sha256, large_icon_sha256, large_icon_px, genre_id, developer_id, original_release_date, original_release_date_source, excluded, developers!apps_developer_id_fkey(artist_name, artist_id), genres!apps_genre_id_fkey(genre_name)';

// The app page's core data chain, shared with /api/v1/apps/{key}: versions →
// archived copies (chunked at 150 — one .in() over ≤1000 version ids both
// risks a 414 and truncates at PostgREST's 1000-row cap) → icon-alias
// canonicalization. Same cache keys as the page, so the two surfaces share
// warm entries.
export async function fetchAppCore(supabase: any, appId: number): Promise<{
  versions: any[];
  ipaFiles: any[];
  binariesBySha1: Map<string, any>;
  canonicalBySha: Map<string, string>;
  error: boolean;
}> {
  const out = { versions: [] as any[], ipaFiles: [] as any[], binariesBySha1: new Map(), canonicalBySha: new Map(), error: false };

  const { data: versions, error: vErr } = await cached<any[]>(`versions:${appId}`, 5 * 60 * 1000, () =>
    supabase
      .from('app_versions')
      .select('id, version_string, build_number, minimum_os_version, release_date, estimated_release_date, external_identifier, device_family')
      .eq('app_id', appId)
      .order('release_date', { ascending: false })
      .limit(1000)
  );
  if (vErr) return { ...out, error: true };
  out.versions = versions || [];
  const versionIds = out.versions.map((v: any) => v.id);
  if (!versionIds.length) return out;

  const { data: ipaFiles, error: fErr } = await cached<any[]>(`ipa_files_b:${appId}:${versionIds.length}`, 5 * 60 * 1000, async () => {
    const results = await Promise.all(
      Array.from({ length: Math.ceil(versionIds.length / 150) }, (_, i) =>
        supabase
          .from('ipa_files')
          .select('id, app_version_id, filename, file_size, md5_hash, has_itunes_metadata, info_plist_path, binary_sha1, available, archive_item_id, archive_items!ipa_files_archive_item_id_fkey(ia_item_id), binaries!ipa_files_binary_sha1_fkey(sha1, install_status, architectures, macho_min_os, itunes_artwork_sha256, bundle_icon_sha256, has_watch_app, has_extensions, hidden, retina_iphone, retina_ipad, retina_iphone_plus, device_family_macho)')
          .in('app_version_id', versionIds.slice(i * 150, i * 150 + 150))
      )
    );
    const failed = results.find((r: any) => r.error);
    return { data: failed ? null : results.flatMap((r: any) => r.data || []), error: failed?.error || null };
  });
  if (fErr) return { ...out, error: true };
  out.ipaFiles = ipaFiles || [];
  for (const f of out.ipaFiles) {
    if (f.binaries?.sha1) out.binariesBySha1.set(f.binaries.sha1, f.binaries);
  }

  // Icon-alias canonicalization (best-effort — consensus falls back without it).
  const iconShas = Array.from(new Set(Array.from(out.binariesBySha1.values())
    .flatMap((b: any) => [b.bundle_icon_sha256, b.itunes_artwork_sha256]).filter(Boolean)));
  await Promise.all(
    Array.from({ length: Math.ceil(iconShas.length / 150) }, (_, i) =>
      supabase
        .from('icon_aliases')
        .select('sha256, canonical_sha256')
        .in('sha256', iconShas.slice(i * 150, i * 150 + 150))
        .then(({ data: al }: any) => {
          for (const a of al || []) out.canonicalBySha.set(a.sha256, a.canonical_sha256);
        })
    )
  );
  return out;
}

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
  // One round trip for all attempts: OR the eq probes together, then pick the
  // winner client-side in attempt order (app_store_id beats internal id),
  // lowest id per column. Replaces a serial loop that cost up to 2 queries
  // per restriction before the page could start.
  const tryAttempts = async (
    restrict: (q: any) => any
  ): Promise<{ app: any | null; dbError: boolean; found: boolean }> => {
    if (!attempts.length) return { app: null, dbError: false, found: false };
    const orExpr = attempts.map(({ col, value }) => `${col}.eq.${value}`).join(',');
    const { data, error } = await restrict(
      supabase.from('apps').select(APP_COLS).or(orExpr)
    )
      .order('id', { ascending: true })
      .limit(attempts.length * 2);
    if (error) return { app: null, dbError: true, found: false };
    for (const { col, value } of attempts) {
      const hit = (data || []).find((r: any) => String(r[col]) === value);
      if (hit) return { app: hit, dbError: false, found: true };
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
