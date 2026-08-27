import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../lib/supabase';
import { json, degraded, idStr, CORS, checkParams } from '../../../lib/api';
import { fetchGenresWithCounts } from '../../../lib/genres';

// GET /api/v1/genres — every genre with its app count.
export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, []);
  if (bad) return bad;
  const { genres, error } = await fetchGenresWithCounts(supabaseFor(ctx));
  if (error) return degraded();
  // genre_id (internal, what ?genre= filters take) usually equals Apple's
  // genre id, but not always — e.g. "Magazines & Newspapers" is internal 43,
  // Apple 6021. Both ship so callers can join against Apple data reliably.
  const data = (genres || []).map((g: any) => ({
    genre_id: idStr(g.id),
    apple_genre_id: idStr(g.genre_id),
    name: g.genre_name ?? null,
    app_count: g.app_count != null ? Number(g.app_count) : null,
  }));
  return json({ data, total: data.length, next_url: null }, 200, 3600);
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
