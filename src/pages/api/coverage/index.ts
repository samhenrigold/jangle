import type { APIRoute } from 'astro';
import { CORS, fail, json, lookupCoverage, parseBatch, MAX_PROBES } from '../../../lib/coverage';

// /api/coverage — collection endpoint.
//
//   POST {"probes":[{"bundle_id","version"}, ...]}  (or a bare [...] array)
//     -> {"results":[{"bundle_id","version","copies":{...}}, ...]}  1:1, in request order
//
//   GET  -> self-describing usage (the per-version resource lives at
//           /api/coverage/{bundle_id}/{version}, which is the cacheable primitive)

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });

export const GET: APIRoute = () =>
  json(
    {
      service: 'legacystore archive coverage',
      describe:
        'Read CFBundleIdentifier + CFBundleShortVersionString from your IPAs (both are plaintext even in encrypted iTunes downloads) and ask which the archive already holds copies of, so you only decrypt/upload the gaps.',
      endpoints: {
        item: 'GET /api/coverage/{bundle_id}/{version}',
        batch: `POST /api/coverage  {"probes":[{"bundle_id","version"}, ...]}  (max ${MAX_PROBES})`,
      },
      copies:
        'a map of install_status -> count for publicly-available copies (e.g. {"installable":3,"encrypted":4}); {} means the archive holds none. installable > 0 means a usable, already-decrypted copy exists.',
    },
    200,
    'public, max-age=3600',
  );

export const POST: APIRoute = async (ctx) => {
  let payload: unknown;
  try {
    payload = await ctx.request.json();
  } catch {
    return fail(400, 'invalid_json', 'body must be JSON: {"probes":[{"bundle_id","version"}, ...]}');
  }
  // Accept either {probes:[...]} or a bare [...] array.
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
