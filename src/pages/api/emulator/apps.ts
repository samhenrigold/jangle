import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../lib/supabase';
import { json, fail, CORS } from '../../../lib/coverage';
import { buildPrefixTsquery, clampPageSize, looksLikeBundleId, escapeLike } from '../../../lib/search';
import { dedupeFilesByHash, sortGroupsByPreference } from '../../../lib/files';
import { compatOf, defaultTarget, deviceFor, parseOs, runsOs, type Target } from '../../../lib/emulator';
import { appTitleOf, APP_LIST_COLS, flattenAppRow } from '../../../lib/apps';

// Catalog search for the Light Touch emulator.
//
//   GET /api/emulator/apps?q=<query>[&limit=25]   search, compatible apps only
//   GET /api/emulator/apps?ipa_id=<id>            one record for a known copy
//
// Target (all optional; defaults are the shipped app's iPod touch 2G / 3.1.3):
//   device=<any iPhone/iPod/iPad model id, e.g. iPod2,1>   os=<x.y.z>
//   family=1|2|1,2        narrow to iPhone (1) / iPad (2) apps; default = all the device runs
//   incompatible=include  keep the best copy of apps that don't qualify, with compat.reasons
//
// Each record is one app with its single best emulator-compatible archived
// copy (newest compatible version, best copy within it per files.ts
// preference order). Compatibility policy lives in lib/emulator.ts — the
// server owns "what runs", so it can improve without a Mac app update.
// Like every public surface: a link, not a proxy — download_url 302s to
// archive.org via /ipa/<id>, which re-checks available/hidden at fetch time.

const VERSION_FIELDS = 'id, app_id, version_string, minimum_os_version, device_family, release_date';
const BIN_FIELDS = 'sha1, install_status, architectures, macho_min_os, hidden, device_family_macho, has_extensions, bundle_icon_sha256, itunes_artwork_sha256, armv6_isa_scan, required_capabilities, plist_min_os';
// binaries ride along as a PostgREST embed via the ipa_files.binary_sha1 FK —
// one round trip instead of a second chunked sweep over the sha1 set.
const FILE_FIELDS = `id, app_version_id, filename, file_size, md5_hash, has_itunes_metadata, info_plist_path, binary_sha1, available, binaries!ipa_files_binary_sha1_fkey(${BIN_FIELDS})`;
const CHUNK = 150; // keeps .in() filters under URL-length limits (app-page precedent)

function record(origin: string, app: any, version: any, file: any, bin: any, t: Target) {
  const compat = compatOf(version, file, bin, t);
  const iconSha = bin?.bundle_icon_sha256 || bin?.itunes_artwork_sha256;
  const live = typeof app?.icon_url === 'string' && /^https?:\/\//.test(app.icon_url) ? app.icon_url : null;
  return {
    bundle_id: app.bundle_id ?? null,
    name: appTitleOf(app),
    developer: app.developer_artist_name ?? null,
    version: version.version_string ?? null,
    min_os: compat.min_os,
    min_os_source: compat.min_os_source,
    size: file.file_size ?? null,
    // Digests of the .ipa file bytes as archived (archive.org's own md5/sha1):
    // verify a download, or skip it when a library already holds these bytes.
    md5: file.md5_hash ?? bin?.md5 ?? null,
    sha1: bin?.sha1 ?? null,
    compat,
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

// Newest compatible version's best compatible copy; with `fallback`, the
// newest version's best copy of any kind when nothing qualifies.
function bestCopy(
  versions: any[],
  filesByVersion: Map<any, any[]>,
  binOf: (f: any) => any,
  t: Target,
  fallback: boolean
): { version: any; file: any; bin: any } | null {
  let first: { version: any; file: any; bin: any } | null = null;
  for (const v of versions) {
    const all = dedupeFilesByHash(filesByVersion.get(v.id) || []).filter((g) => !binOf(g.file)?.hidden);
    const groups = all.filter((g) => compatOf(v, g.file, binOf(g.file), t).compatible);
    if (fallback && !first && all.length) {
      const f = sortGroupsByPreference(all, binOf, v.minimum_os_version)[0].file;
      first = { version: v, file: f, bin: binOf(f) };
    }
    if (!groups.length) continue;
    const best = sortGroupsByPreference(groups, binOf, v.minimum_os_version)[0];
    return { version: v, file: best.file, bin: binOf(best.file) };
  }
  return first;
}

// The request's target device, or an error message.
function targetOf(params: URLSearchParams): Target | string {
  const d = defaultTarget();
  const model = params.get('device');
  const device = model === null ? d.device : deviceFor(model);
  if (!device) return 'device must be an iPhone, iPod touch or iPad model id like iPod2,1';
  const osParam = params.get('os');
  const os = osParam === null ? (model === null ? d.os : null) : parseOs(osParam);
  if (!os) return model !== null && osParam === null ? 'os is required with device' : 'os must look like 4.2.1';
  if (!runsOs(device, os)) {
    return `${device.model} (${device.name}) ran iOS ${device.minOs} through ${device.maxOs}`;
  }
  const fam = params.get('family');
  const families = fam === null ? device.families : fam.split(',').filter((f) => device.families.includes(f));
  if (!families.length) return `family must be among ${device.families.join(',')} for ${device.model}`;
  return { device, os, families };
}

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });

export const GET: APIRoute = async (ctx) => {
  const origin = ctx.url.origin;
  const supabase = supabaseFor(ctx);
  const params = ctx.url.searchParams;
  const t = targetOf(params);
  if (typeof t === 'string') return fail(400, 'invalid_request', t);
  const includeAll = params.get('incompatible') === 'include';
  const target = { model: t.device.model, name: t.device.name, os: t.os.join('.'), archs: t.device.archs, families: t.families };
  const reply = (apps: any[]) => json({ apps, target }, 200, 'public, max-age=300');

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
      if (bin?.hidden) return fail(404, 'not_found', 'no such archived copy');
      const rec = record(origin, flattenAppRow(app), version, file, bin, t);
      if (!rec.compat.compatible && !includeAll) {
        return fail(404, 'not_compatible', `not compatible with ${t.device.model} on ${target.os}: ${rec.compat.reasons.join(', ')}`);
      }
      return reply([rec]);
    }

    // ---- search / suggestions ----
    // No query = the storefront's default view: the most-archived compatible
    // apps (version count is the closest thing the archive has to popularity).
    const q = (params.get('q') || '').trim();
    const limit = clampPageSize(params.get('limit'), 25, 50);
    const tsquery = q ? buildPrefixTsquery(q) : null;
    if (q && !tsquery && !q.includes('.')) return reply([]);

    // Overfetch: many hits have no armv6/installable copy and are dropped
    // below. The suggested list needs the deepest pool — the most-archived
    // apps skew late-iOS, so the survival rate down to iOS 3 is low.
    // search_apps ranks by relevance (typo-tolerant, matches developer names
    // and bundle-id words via search_vector2) so the old dev/bundle-append
    // lookups are gone; a dotted query still gets a bundle_id substring
    // append below, since the tsquery folds dots away.
    const { data: hits, error: se } = await supabase.rpc('search_apps', {
      p_query: tsquery,
      p_raw: q || null,
      p_genre_id: null,
      p_sort: q ? 'relevance' : 'versions',
      p_limit: q ? 50 : 300,
      p_offset: 0,
      p_dev_ids: null,
    });
    if (se) throw new Error(se.message);
    const apps: any[] = hits || [];

    if (looksLikeBundleId(q)) {
      const pattern = `%${escapeLike(q)}%`;
      const { data } = await supabase
        .from('apps').select(APP_LIST_COLS)
        .ilike('bundle_id', pattern).not('excluded', 'is', true).limit(25);
      apps.push(...(data || []).map(flattenAppRow));
      // First occurrence wins, so relevance ranking stays on top.
      const seen = new Set<any>();
      const unique = apps.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
      apps.length = 0;
      apps.push(...unique);
    }
    if (!apps.length) return reply([]);

    // Metadata min-OS above the target's major can't pass regardless of the binary —
    // cut those versions IN THE QUERY, not just client-side: PostgREST caps
    // each request at 1000 rows, and the apps in play here (most-archived =
    // most-versioned) blow through that, silently truncating the tail and
    // dropping whole apps. The lexicographic `lt.4` lets a stray "10.x"
    // through, which compatOf below still rejects — the filter
    // is a cost cut, not the compatibility decision. Unknown min-OS stays:
    // the binary's macho_min_os may still qualify it.
    const versions = await chunkedIn(
      supabase, 'app_versions', VERSION_FIELDS, 'app_id', apps.map((a) => a.id),
      (query) => (includeAll || t.os[0] >= 9 ? query : query.or(`minimum_os_version.is.null,minimum_os_version.lt.${t.os[0] + 1}`))
    );
    const eligible = versions
      .filter((v) => {
        const major = parseInt(String(v.minimum_os_version || '').split('.')[0], 10);
        return includeAll || !Number.isFinite(major) || major <= t.os[0];
      })
      .sort((a, b) => String(b.release_date || '').localeCompare(String(a.release_date || '')));
    if (!eligible.length) return reply([]);

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
      const best = bestCopy(versionsByApp.get(app.id) || [], filesByVersion, binOf, t, includeAll);
      if (best) out.push(record(origin, app, best.version, best.file, best.bin, t));
      if (out.length >= limit) break;
    }
    return reply(out);
  } catch (err) {
    console.error('emulator apps error:', (err as any)?.message);
    return fail(502, 'upstream_error', 'catalog lookup failed');
  }
};
