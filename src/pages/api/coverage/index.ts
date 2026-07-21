import type { APIRoute } from 'astro';
import { CORS, fail, json, lookupCoverage, parseBatch, toProbe, INVALID_SINGLE, MAX_PROBES } from '../../../lib/coverage';

// /api/coverage — collection endpoint.
//
//   GET  (no params)  -> self-describing usage
//   GET  ?external_id=… | ?bundle_id=…&version=… | ?app_store_id=…&version=…
//                     -> single lookup by any identifier subset (cacheable)
//   POST {"probes":[ {bundle_id?,app_store_id?,version?,external_id?}, … ]}  (or a bare array)
//                     -> {"results":[ {…identifiers, copies}, … ]}  1:1, in request order (max N)
//
// The human-readable per-version resource also lives at
// /api/coverage/{bundle_id}/{version} — the cacheable primitive for the common case.

const USAGE = {
  service: 'legacystore archive coverage',
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
    item: 'GET /api/coverage/{bundle_id}/{version}',
    single: 'GET /api/coverage?external_id=… (or ?bundle_id=…&version=…, ?app_store_id=…&version=…)',
    batch: `POST /api/coverage  {"probes":[…]}  (max ${MAX_PROBES})`,
  },
  copies:
    'a map of install_status -> count for publicly-available copies (e.g. {"installable":3,"encrypted":4}); {} means none. installable > 0 means a usable, already-decrypted copy exists. Quarantined/tampered copies are never counted.',
  schema: 'https://legacystore.app/openapi.yaml',
};

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });

export const GET: APIRoute = async (ctx) => {
  const q = new URL(ctx.request.url).searchParams;
  const raw = {
    bundle_id: q.get('bundle_id') ?? undefined,
    version: q.get('version') ?? undefined,
    external_id: q.get('external_id') ?? undefined,
    app_store_id: q.get('app_store_id') ?? undefined,
  };
  // No identifiers at all -> serve usage rather than an error.
  if (!raw.bundle_id && !raw.version && !raw.external_id && !raw.app_store_id) {
    return json(USAGE, 200, 'public, max-age=3600');
  }
  const probe = toProbe(raw);
  if (!probe) return fail(400, 'invalid_request', INVALID_SINGLE);

  try {
    const [entry] = await lookupCoverage(ctx, [probe]);
    return json(entry ?? { ...raw, copies: {} }, 200, 'public, max-age=300');
  } catch (err) {
    console.error('coverage single failed:', (err as any)?.message);
    return fail(502, 'lookup_failed', 'the archive lookup could not be completed');
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
    return json({ results }, 200, 'no-store');
  } catch (err) {
    console.error('coverage batch failed:', (err as any)?.message);
    return fail(502, 'lookup_failed', 'the archive lookup could not be completed');
  }
};
