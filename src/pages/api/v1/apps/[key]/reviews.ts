import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../../../lib/supabase';
import { json, degraded, resolveAppOr404, iso, idStr, CORS, checkParams, clampLimit, encodeCursor, decodeCursor, listBody } from '../../../../../lib/api';
import { getAppReviews } from '../../../../../lib/timemachine';

// GET /api/v1/apps/{key}/reviews — archived customer reviews, oldest first
// (chronological, as the site shows them).
export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, ['limit', 'cursor']);
  if (bad) return bad;
  const resolved = await resolveAppOr404(ctx);
  if ('response' in resolved) return resolved.response;
  const app = resolved.app;
  if (!app.app_store_id) return json(listBody(ctx.url, [], 0, null), 200, 3600);

  const limit = clampLimit(ctx.url.searchParams.get('limit'), 50, 200);
  const cur = decodeCursor(ctx.url.searchParams.get('cursor'));
  const offset = cur && Number.isInteger(cur[0]) && (cur[0] as number) >= 0 ? (cur[0] as number) : 0;

  const res = await getAppReviews(supabaseFor(ctx), Number(app.app_store_id), limit, offset);
  if (!res) return degraded();
  const data = (res.rows || []).map((r: any) => ({
    review_id: idStr(r.review_id),
    title: r.title ?? null,
    body: r.body ?? null,
    stars: r.stars != null ? Number(r.stars) : null,
    author: r.author ?? null,
    app_version: r.app_version ?? null,
    reviewed_at: iso(r.reviewed_at),
    // 14-digit Wayback capture timestamp of the feed this review was recovered
    // from (null for live-fetched reviews) — the archival provenance.
    first_seen_ts: r.first_seen_ts ?? null,
  }));
  const nextCursor = data.length === limit && offset + limit < (res.total || 0) ? encodeCursor([offset + limit]) : null;
  return json(listBody(ctx.url, data, res.total ?? null, nextCursor), 200, 3600);
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
