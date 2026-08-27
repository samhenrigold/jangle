import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../../lib/supabase';
import { json, degraded, idStr, CORS, checkParams } from '../../../../lib/api';
import { getChartTypes } from '../../../../lib/timemachine';

// GET /api/v1/charts/types — the archived chart feeds (Top Free, Top Paid, …).
export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, []);
  if (bad) return bad;
  const types = await getChartTypes(supabaseFor(ctx));
  if (!types) return degraded();
  const data = types.map((t) => ({ chart_type_id: idStr(t.id), name: t.name, slug: t.slug }));
  return json({ data, total: data.length, next_url: null }, 200, 3600);
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
