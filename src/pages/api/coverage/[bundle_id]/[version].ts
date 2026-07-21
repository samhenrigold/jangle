import type { APIRoute } from 'astro';
import { CORS, fail, json, lookupCoverage, toProbe } from '../../../../lib/coverage';

// /api/coverage/{bundle_id}/{version} — the per-version coverage resource.
//
// The canonical, cacheable primitive for the common case: the archive's coverage of a
// given version is the same for every caller, so a first request warms the edge cache
// for everyone. Other identifiers (external_id, app_store_id) are supported via the
// collection: GET /api/coverage?external_id=…
//
//   GET /api/coverage/com.rovio.angrybirds/1.0
//     -> {"bundle_id":"com.rovio.angrybirds","version":"1.0","external_id":null,"app_store_id":null,"copies":{…}}
//
// A version the archive holds nothing for is a valid answer ({}), not a 404.

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });

export const GET: APIRoute = async (ctx) => {
  const probe = toProbe({ bundle_id: ctx.params.bundle_id, version: ctx.params.version });
  if (!probe) {
    return fail(400, 'invalid_request', 'both bundle_id and version path segments are required');
  }

  try {
    const [entry] = await lookupCoverage(ctx, [probe]);
    return json(
      entry ?? { bundle_id: probe.bundle_id ?? null, version: probe.version ?? null, external_id: null, app_store_id: null, copies: {} },
      200,
      'public, max-age=300',
    );
  } catch (err) {
    console.error('coverage item failed:', (err as any)?.message);
    return fail(502, 'lookup_failed', 'the archive lookup could not be completed');
  }
};
