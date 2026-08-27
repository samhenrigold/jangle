import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../../../lib/supabase';
import { json, degraded, resolveAppOr404, idStr, CORS, checkParams } from '../../../../../lib/api';
import { foldChartGroups } from '../../../../../lib/appdetail';
import { getAppChartHistory, getChartTypes } from '../../../../../lib/timemachine';

// GET /api/v1/apps/{key}/charts — the app's archived chart trajectory, one
// group per (chart type, device, genre) with its dated positions and peak.
// Same fold the app page renders. Bounded: no pagination.
export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, []);
  if (bad) return bad;
  const resolved = await resolveAppOr404(ctx);
  if ('response' in resolved) return resolved.response;
  const app = resolved.app;
  if (!app.app_store_id) return json({ data: [], total: 0, next_url: null }, 200, 3600);

  const supabase = supabaseFor(ctx);
  const [history, types] = await Promise.all([
    getAppChartHistory(supabase, Number(app.app_store_id)),
    getChartTypes(supabase),
  ]);
  if (!history || !types) return degraded();
  const typeById = new Map(types.map((t) => [t.id, t]));

  const data = foldChartGroups(history).map((g: any) => ({
    chart_type_id: idStr(g.typeId),
    chart_type: typeById.get(g.typeId)?.name ?? null,
    chart_type_slug: typeById.get(g.typeId)?.slug ?? null,
    device: g.device,
    genre_id: idStr(g.genreId),
    peak_position: g.peak != null ? Number(g.peak) : null,
    peak_date: g.peakDate ?? null,
    first_seen: g.first ?? null,
    last_seen: g.last ?? null,
    positions: (g.points || []).map((p: any) => ({ date: p.date, position: p.position })),
  }));
  return json({ data, total: data.length, next_url: null }, 200, 3600);
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
