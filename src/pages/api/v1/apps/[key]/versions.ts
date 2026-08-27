import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../../../lib/supabase';
import { json, degraded, resolveAppOr404, CORS, checkParams } from '../../../../../lib/api';
import { fetchAppCore } from '../../../../../lib/apps';
import { serializeVersions } from '../../../../../lib/v1versions';

// GET /api/v1/apps/{key}/versions — the version/copy tree alone (the same
// array embedded in /apps/{key}). Bounded (corpus max ~307 versions): no
// pagination.
export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, []);
  if (bad) return bad;
  const resolved = await resolveAppOr404(ctx);
  if ('response' in resolved) return resolved.response;

  const core = await fetchAppCore(supabaseFor(ctx), Number(resolved.app.id));
  if (core.error) return degraded();
  const data = serializeVersions(core);
  return json({ data, total: data.length, next_url: null }, 200, 900);
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
