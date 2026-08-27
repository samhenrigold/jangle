import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../lib/supabase';
import { json, degraded, CORS, checkParams } from '../../../lib/api';

// GET /api/v1/stats — the archive-wide stats blob (nightly-refreshed cache in
// the DB; get_archive_stats reads it — never p_fresh here).
export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, []);
  if (bad) return bad;
  const { data, error } = await supabaseFor(ctx).rpc('get_archive_stats');
  if (error || !data) return degraded();
  return json(data, 200, 3600);
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
