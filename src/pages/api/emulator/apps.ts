import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../lib/supabase';
import { json, fail, CORS } from '../../../lib/coverage';
import { buildPrefixTsquery, clampPageSize } from '../../../lib/search';
import { dedupeFilesByHash, sortGroupsByPreference } from '../../../lib/files';
import { emulatorCompatible, emulatorMinOs } from '../../../lib/emulator';
import { appTitleOf, APP_LIST_COLS, flattenAppRow } from '../../../lib/apps';

// Catalog search for the LightTouch emulator (iPod touch 2G / iOS 3.1.3).
//
//   GET /api/emulator/apps?q=<query>[&limit=25]   search, compatible apps only
//   GET /api/emulator/apps?ipa_id=<id>            one record for a known copy
//
// Each record is one app with its single best emulator-compatible archived
// copy (newest compatible version, best copy within it per files.ts
// preference order). Compatibility policy lives in lib/emulator.ts — the
// server owns "what runs", so it can improve without a Mac app update.
// Like every public surface: a link, not a proxy — download_url 302s to
// archive.org via /ipa/<id>, which re-checks available/hidden at fetch time.

const VERSION_FIELDS = 'id, app_id, version_string, minimum_os_version, device_family, release_date';
const BIN_FIELDS = 'sha1, install_status, architectures, macho_min_os, hidden, device_family_macho, has_extensions, bundle_icon_sha256, itunes_artwork_sha256';
// binaries ride along as a PostgREST embed via the ipa_files.binary_sha1 FK —
// one round trip instead of a second chunked sweep over the sha1 set.
const FILE_FIELDS = `id, app_version_id, filename, file_size, md5_hash, has_itunes_metadata, info_plist_path, binary_sha1, available, binaries!ipa_files_binary_sha1_fkey(${BIN_FIELDS})`;
const CHUNK = 150; // keeps .in() filters under URL-length limits (app-page precedent)

function record(origin: string, app: any, version: any, file: any, bin: any) {
  const min = emulatorMinOs(version, bin);
  const iconSha = bin?.bundle_icon_sha256 || bin?.itunes_artwork_sha256;
  const live = typeof app?.icon_url === 'string' && /^https?:\/\//.test(app.icon_url) ? app.icon_url : null;
  return {
    bundle_id: app.bundle_id ?? null,
    name: appTitleOf(app),
    developer: app.developer_artist_name ?? null,
    version: version.version_string ?? null,
    min_os: min.os,
    min_os_source: min.source,
    size: file.file_size ?? null,
    ipa_id: file.id,
    icon_url: iconSha ? `${origin}/icon/${iconSha}` : live,
    download_url: `${origin}/ipa/${file.id}`,
    app_url: `${origin}/app/${app.app_store_id || app.id}`,
  };
}

async function chunkedIn(
  supabase: any, table: string, fields: string, column: string, values: any[],
  refine?: (q: any) => any
): Promise<any[]> {
  // Chunks are independent — fetch concurrently instead of serially.
  const slices: any[][] = [];
  for (let i = 0; i < values.length; i += CHUNK) slices.push(values.slice(i, i + CHUNK));
  const results = await Promise.all(slices.map(async (slice) => {
    let query = supabase.from(table).select(fields).in(column, slice).limit(1000);
    if (refine) query = refine(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    return data || [];
  }));
  return results.flat();
}

// Newest compatible version's best compatible copy, or null.
function bestCopy(
  versions: any[],
  filesByVersion: Map<any, any[]>,
  binOf: (f: any) => any
): { version: any; file: any; bin: any } | null {
  for (const v of versions) {
    const files = filesByVersion.get(v.id) || [];
    const groups = dedupeFilesByHash(files).filter((g) => emulatorCompatible(v, g.file, binOf(g.file)));
    if (!groups.length) continue;
    const best = sortGroupsByPreference(groups, binOf, v.minimum_os_version)[0];
    return { version: v, file: best.file, bin: binOf(best.file) };
  }
  return null;
}

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });

export const GET: APIRoute = async (ctx) => {
  const origin = ctx.url.origin;
  const supabase = supabaseFor(ctx);
  const params = ctx.url.searchParams;

  try {
    // ---- single-copy lookup (the deep link's confirm sheet) ----
    const ipaParam = params.get('ipa_id');
    if (ipaParam !== null) {
      if (!/^\d+$/.test(ipaParam)) return fail(400, 'invalid_request', 'ipa_id must be a positive integer');
      const { data: file, error: fe } = await supabase
        .from('ipa_files').select(FILE_FIELDS).eq('id', ipaParam).maybeSingle();
      if (fe) throw new Error(fe.message);
      if (!file) return fail(404, 'not_found', 'no such archived copy');
      const { data: version, error: ve } = await supabase
        .from('app_versions').select(VERSION_FIELDS).eq('id', file.app_version_id).maybeSingle();
      if (ve) throw new Error(ve.message);
      if (!version) return fail(404, 'not_found', 'no such archived copy');
      const { data: app, error: ae } = await supabase
        .from('apps')
        .select(APP_LIST_COLS)
        .eq('id', version.app_id)
        .maybeSingle();
      if (ae) throw new Error(ae.message);
      if (!app) return fail(404, 'not_found', 'no such archived copy');
      const bin = (file as any).binaries || undefined;
      if (!emulatorCompatible(version, file, bin)) {
        return fail(404, 'not_compatible', 'this copy is not compatible with the emulator');
      }
      return json({ apps: [record(origin, flattenAppRow(app), version, file, bin)] }, 200, 'public, max-age=300');
    }

    // ---- search / suggestions ----
    // No query = the storefront's default view: the most-archived compatible
    // apps (version count is the closest thing the archive has to popularity).
    const q = (params.get('q') || '').trim();
    const limit = clampPageSize(params.get('limit'), 25, 50);
    const tsquery = q ? buildPrefixTsquery(q) : null;
    if (q && !tsquery && !q.includes('.')) return json({ apps: [] }, 200, 'public, max-age=300');

    // Overfetch: many hits have no armv6/installable copy and are dropped
    // below. The suggested list needs the deepest pool — the most-archived
    // apps skew late-iOS, so the survival rate down to iOS 3 is low.
    const { data: hits, error: se } = await supabase.rpc('get_apps_sorted_by_version_count', {
      p_limit: q ? 50 : 300,
      p_offset: 0,
      p_genre_id: null,
      p_ascending: false,
      p_search_query: tsquery,
    });
    if (se) throw new Error(se.message);
    const apps: any[] = hits || [];

    // The FTS vector misses two things people paste into an emulator's search
    // box: bundle ids (the tsquery folds the dots away) and developer names
    // (not in the vector at all). Both are separate lookups, appended after
    // the FTS hits and deduped. Same patterns as the site's own search page.
    if (q) {
      const flatten = (rows: any[] | null) => (rows || []).map(flattenAppRow);
      const pattern = `%${q.replace(/[%_]/g, (ch) => '\\' + ch)}%`;
      if (q.includes('.')) {
        const { data } = await supabase
          .from('apps').select(APP_LIST_COLS)
          .ilike('bundle_id', pattern).not('excluded', 'is', true).limit(25);
        apps.push(...flatten(data));
      }
      const { data: devs } = await supabase
        .from('developers').select('id').ilike('artist_name', pattern).limit(5);
      if (devs?.length) {
        const { data } = await supabase
          .from('apps').select(APP_LIST_COLS)
          .in('developer_id', devs.map((d: any) => d.id))
          .not('excluded', 'is', true).limit(50);
        apps.push(...flatten(data));
      }
      // First occurrence wins, so FTS ranking stays on top.
      const seen = new Set<any>();
      const unique = apps.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
      apps.length = 0;
      apps.push(...unique);
    }
    if (!apps.length) return json({ apps: [] }, 200, 'public, max-age=300');

    // Metadata min-OS > 3 can't pass the predicate regardless of the binary —
    // cut those versions IN THE QUERY, not just client-side: PostgREST caps
    // each request at 1000 rows, and the apps in play here (most-archived =
    // most-versioned) blow through that, silently truncating the tail and
    // dropping whole apps. The lexicographic `lt.4` lets a stray "10.x"
    // through, which the armv6 binary check below still rejects — the filter
    // is a cost cut, not the compatibility decision. Unknown min-OS stays:
    // the binary's macho_min_os may still qualify it.
    const versions = await chunkedIn(
      supabase, 'app_versions', VERSION_FIELDS, 'app_id', apps.map((a) => a.id),
      (query) => query.or('minimum_os_version.is.null,minimum_os_version.lt.4')
    );
    const eligible = versions
      .filter((v) => {
        const major = parseInt(String(v.minimum_os_version || '').split('.')[0], 10);
        return !Number.isFinite(major) || major <= 3;
      })
      .sort((a, b) => String(b.release_date || '').localeCompare(String(a.release_date || '')));
    if (!eligible.length) return json({ apps: [] }, 200, 'public, max-age=300');

    const files = await chunkedIn(supabase, 'ipa_files', FILE_FIELDS, 'app_version_id', eligible.map((v) => v.id));
    const binOf = (f: any) => f?.binaries || undefined;

    const versionsByApp = new Map<any, any[]>();
    for (const v of eligible) {
      const arr = versionsByApp.get(v.app_id) || [];
      arr.push(v); // already newest-first from the sort above
      versionsByApp.set(v.app_id, arr);
    }
    const filesByVersion = new Map<any, any[]>();
    for (const f of files) {
      const arr = filesByVersion.get(f.app_version_id) || [];
      arr.push(f);
      filesByVersion.set(f.app_version_id, arr);
    }

    const out: any[] = [];
    for (const app of apps) {
      const best = bestCopy(versionsByApp.get(app.id) || [], filesByVersion, binOf);
      if (best) out.push(record(origin, app, best.version, best.file, best.bin));
      if (out.length >= limit) break;
    }
    return json({ apps: out }, 200, 'public, max-age=300');
  } catch (err) {
    console.error('emulator apps error:', (err as any)?.message);
    return fail(502, 'upstream_error', 'catalog lookup failed');
  }
};
