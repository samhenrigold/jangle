import type { APIRoute } from 'astro';
import { CORS, fail, json, lookupCoverage, sanitizeProbe } from '../../../../lib/coverage';

// /api/coverage/{bundle_id}/{version} — the per-version coverage resource.
//
// The canonical, cacheable primitive: the archive's coverage of a given version is
// the same for every caller, so a first request warms the edge cache for everyone.
//
//   GET /api/coverage/com.rovio.angrybirds/1.0
//     -> {"bundle_id":"com.rovio.angrybirds","version":"1.0","copies":{...}}
//
// A version the archive holds nothing for is a valid answer ({}), not a 404.

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });

export const GET: APIRoute = async (ctx) => {
  const probe = sanitizeProbe(ctx.params.bundle_id, ctx.params.version);
  if (!probe) {
    return fail(400, 'invalid_request', 'both bundle_id and version path segments are required');
  }

  try {
    const [entry] = await lookupCoverage(ctx, [probe]);
    // coverage_lookup returns exactly one row per probe; fall back defensively.
    return json(entry ?? { ...probe, copies: {} }, 200, 'public, max-age=300');
  } catch (err) {
    console.error('coverage item failed:', (err as any)?.message);
    return fail(502, 'lookup_failed', 'the archive lookup could not be completed');
  }
};
