import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../../lib/supabase';
import { json, degraded, CORS, checkParams } from '../../../../lib/api';
import { fetchSitemapSlugs } from '../../../../lib/sitemap';

// GET /api/v1/apps/ids — every public app key (App Store ID when real, else
// internal id), sorted. The bulk-enumeration endpoint for crawlers and
// researchers: fetch once, then GET /api/v1/apps/{key} per id.
export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, []);
  if (bad) return bad;
  try {
    const slugs = await fetchSitemapSlugs(supabaseFor(ctx));
    return json({ data: slugs.map(String), total: slugs.length, next_url: null }, 200, 3600);
  } catch (err) {
    console.error('v1 apps/ids error:', (err as any)?.message);
    return degraded();
  }
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
