import type { APIRoute } from 'astro';
import { CORS, fail, json, degraded } from '../../../../../lib/api';
import { lookupCoverage, toProbe } from '../../../../../lib/coverage';
import { serializeEntry } from '../index';

// GET /api/v1/coverage/{bundle_id}/{version} — the per-version coverage resource.
// The cacheable primitive for the common case; other identifiers go through the
// collection (GET /api/v1/coverage?external_id=…). Holding nothing is a valid
// answer ({} copies), not a 404.

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });

export const GET: APIRoute = async (ctx) => {
  const probe = toProbe({ bundle_id: ctx.params.bundle_id, version: ctx.params.version });
  if (!probe) {
    return fail(400, 'invalid_request', 'both bundle_id and version path segments are required');
  }

  try {
    const [entry] = await lookupCoverage(ctx, [probe]);
    return json(
      serializeEntry(
        entry ?? {
          bundle_id: probe.bundle_id ?? null,
          version: probe.version ?? null,
          external_id: null,
          app_store_id: null,
          copies: {},
        },
      ),
      200,
      300,
    );
  } catch (err) {
    console.error('v1 coverage item failed:', (err as any)?.message);
    return degraded();
  }
};
