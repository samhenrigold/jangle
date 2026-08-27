import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../../lib/supabase';
import { json, degraded, CORS, checkParams } from '../../../../lib/api';
import { fetchCollectionsWithMembers } from '../../../../lib/collections';
import { SITE_ORIGIN as S } from '../../../../lib/http';

// GET /api/v1/collections — published editorial collections (drafts are
// RLS-hidden). Small bounded set: no pagination.
export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, []);
  if (bad) return bad;
  const { data, error } = await fetchCollectionsWithMembers(supabaseFor(ctx));
  if (error) return degraded();
  const out = (data || []).map((c: any) => ({
    slug: c.slug,
    title: c.title ?? null,
    subtitle: c.subtitle ?? null,
    series: c.series ?? null,
    app_count: c.collection_members.length,
    url: `${S}/api/v1/collections/${c.slug}`,
    web_url: `${S}/collections/${c.slug}`,
  }));
  return json({ data: out, total: out.length, next_url: null }, 200, 3600);
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
