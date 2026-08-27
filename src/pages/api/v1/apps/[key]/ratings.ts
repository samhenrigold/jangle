import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../../../lib/supabase';
import { json, degraded, resolveAppOr404, iso, CORS, checkParams } from '../../../../../lib/api';
import { getAppRatingHistory } from '../../../../../lib/timemachine';

// GET /api/v1/apps/{key}/ratings — the raw listing-snapshot trail (rating
// average/count, listed version, price), oldest first. Raw captures, not the
// site's display-smoothed envelope: captures can mix storefronts or
// current-version-only counts — that's the archival record; smooth it
// client-side if you need a monotonic series. Bounded (≤1000): no pagination.
export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, []);
  if (bad) return bad;
  const resolved = await resolveAppOr404(ctx);
  if ('response' in resolved) return resolved.response;
  const app = resolved.app;
  if (!app.app_store_id) return json({ data: [], total: 0, next_url: null }, 200, 3600);

  const rows = await getAppRatingHistory(supabaseFor(ctx), Number(app.app_store_id));
  if (!rows) return degraded();
  const data = rows.map((r: any) => ({
    captured_at: iso(r.captured_at),
    rating_avg: r.rating_avg != null ? Number(r.rating_avg) : null,
    rating_count: r.rating_count != null ? Number(r.rating_count) : null,
    listed_version: r.version ?? null,
    price_amount: r.price_amount != null ? Number(r.price_amount) : null,
    price_currency: r.price_currency ?? null,
  }));
  return json({ data, total: data.length, next_url: null }, 200, 3600);
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
