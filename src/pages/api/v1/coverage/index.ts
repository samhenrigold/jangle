import type { APIRoute } from 'astro';
import { CORS, fail, json, degraded, idStr, checkParams } from '../../../../lib/api';
import { lookupCoverage, parseBatch, toProbe, INVALID_SINGLE, MAX_PROBES, type CoverageEntry } from '../../../../lib/coverage';
import { SITE_ORIGIN as S } from '../../../../lib/http';

// /api/v1/coverage — the coverage endpoint, in v1 conventions (string ids, split
// cache headers, 503 on blips, unknown-param 400s). The pre-v1 /api/coverage stays
// live with its original shape for existing callers.
//
//   GET  (no params)  -> self-describing usage
//   GET  ?external_id=… | ?bundle_id=…&version=… | ?app_store_id=…&version=…
//   POST {"probes":[ {bundle_id?,app_store_id?,version?,external_id?}, … ]} (or a bare array)
//     -> {"results":[ {…identifiers, copies}, … ]}  1:1, in request order

const USAGE = {
  service: 'Legacy Store archive coverage',
  describe:
    "Read identifiers from your IPAs' plists (they're plaintext even in encrypted iTunes downloads) and ask which the archive already holds copies of, so you only decrypt/upload the gaps.",
  identifiers: {
    bundle_id: 'CFBundleIdentifier / softwareVersionBundleId',
    app_store_id: 'itemId (iTunesMetadata.plist)',
    version: 'CFBundleShortVersionString',
    external_id: 'softwareVersionExternalIdentifier (iTunesMetadata.plist) — precise per-build id',
  },
  needs: INVALID_SINGLE,
  endpoints: {
    item: `GET ${S}/api/v1/coverage/{bundle_id}/{version}`,
    single: `GET ${S}/api/v1/coverage?external_id=… (or ?bundle_id=…&version=…, ?app_store_id=…&version=…)`,
    batch: `POST ${S}/api/v1/coverage  {"probes":[…]}  (max ${MAX_PROBES})`,
  },
  copies:
    'a map of install_status -> count for publicly-available copies (e.g. {"installable":3,"encrypted":4}); {} means none. installable > 0 means a usable, already-decrypted copy exists. Quarantined/tampered copies are never counted.',
  schema: `${S}/openapi.yaml`,
  docs: `${S}/api`,
};

// v1 convention: all ids serialize as strings (external ids have overflowed
// numeric types before).
export function serializeEntry(e: CoverageEntry) {
  return {
    bundle_id: e.bundle_id,
    version: e.version,
    external_id: idStr(e.external_id),
    app_store_id: idStr(e.app_store_id),
    copies: e.copies ?? {},
  };
}

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });

export const GET: APIRoute = async (ctx) => {
  const url = new URL(ctx.request.url);
  const bad = checkParams(url, ['bundle_id', 'version', 'external_id', 'app_store_id']);
  if (bad) return bad;

  const q = url.searchParams;
  if (![...q.keys()].length) return json(USAGE, 200, 3600);

  const probe = toProbe({
    bundle_id: q.get('bundle_id') ?? undefined,
    version: q.get('version') ?? undefined,
    external_id: q.get('external_id') ?? undefined,
    app_store_id: q.get('app_store_id') ?? undefined,
  });
  if (!probe) return fail(400, 'invalid_request', INVALID_SINGLE);

  try {
    const [entry] = await lookupCoverage(ctx, [probe]);
    return json(
      serializeEntry(
        entry ?? {
          bundle_id: probe.bundle_id ?? null,
          version: probe.version ?? null,
          external_id: probe.external_id ?? null,
          app_store_id: probe.app_store_id ?? null,
          copies: {},
        },
      ),
      200,
      300,
    );
  } catch (err) {
    console.error('v1 coverage single failed:', (err as any)?.message);
    return degraded();
  }
};

export const POST: APIRoute = async (ctx) => {
  let payload: unknown;
  try {
    payload = await ctx.request.json();
  } catch {
    return fail(400, 'invalid_json', 'body must be JSON: {"probes":[…]}');
  }
  const parsed = parseBatch(Array.isArray(payload) ? payload : (payload as any)?.probes);
  if ('error' in parsed) return parsed.error;

  try {
    const results = await lookupCoverage(ctx, parsed.probes);
    return json({ results: results.map(serializeEntry) });
  } catch (err) {
    console.error('v1 coverage batch failed:', (err as any)?.message);
    return degraded();
  }
};
