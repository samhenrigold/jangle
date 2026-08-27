import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../../../lib/supabase';
import { json, degraded, resolveAppOr404, iso, CORS, checkParams } from '../../../../../lib/api';
import { SITE_ORIGIN as S } from '../../../../../lib/http';

// GET /api/v1/apps/{key}/screenshots — archived screenshot sets, one per
// distinct capture (content-deduped in the RPC), newest first. Bounded: no
// pagination.
export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, []);
  if (bad) return bad;
  const resolved = await resolveAppOr404(ctx);
  if ('response' in resolved) return resolved.response;
  const app = resolved.app;
  if (!app.app_store_id) return json({ data: [], total: 0, next_url: null }, 200, 3600);

  const { data, error } = await supabaseFor(ctx).rpc('get_app_screenshots', {
    p_app_store_id: Number(app.app_store_id),
    p_max_sets: 40,
  });
  if (error) return degraded();
  const sets = (data || []).map((row: any) => ({
    captured_at: iso(row.captured_at),
    version: row.version_string ?? null,
    shots: (row.shots || [])
      .filter((s: any) => s && s.sha)
      .map((s: any) => ({
        url: `${S}/screen/${s.sha}`,
        sha256: s.sha,
        width: Number(s.w) > 0 ? Number(s.w) : null,
        height: Number(s.h) > 0 ? Number(s.h) : null,
      })),
  })).filter((s: any) => s.shots.length > 0);
  return json({ data: sets, total: sets.length, next_url: null }, 200, 3600);
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
