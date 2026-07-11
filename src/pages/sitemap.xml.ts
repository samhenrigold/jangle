import type { APIRoute } from 'astro';
import { supabaseFor } from '../lib/supabase';
import { SITE_ORIGIN as SITE } from '../lib/http';

// Fallback pager, used only until the get_sitemap_slugs RPC exists. PostgREST
// caps responses at 1000 rows, so this costs one round trip per 1000 apps.
const CHUNK = 1000;
const MAX_CHUNKS = 100; // runaway guard: 100k rows, well above the ~41k catalog

// Every app's public URL slug: app_store_id when real (what /app/ links
// prefer), else the internal id. The 0 sentinel is not a real store id.
async function fetchSlugs(supabase: any): Promise<string[]> {
  // Preferred path: one RPC round trip returning the whole list as a single
  // json array (a one-row response, so the max-rows cap doesn't apply).
  const { data: slugs, error: rpcError } = await supabase.rpc('get_sitemap_slugs');
  if (!rpcError && Array.isArray(slugs)) return slugs;
  console.error('get_sitemap_slugs rpc failed, falling back to paging:', rpcError?.message);

  const seen = new Set<string>();
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const from = i * CHUNK;
    const { data, error } = await supabase
      .from('apps')
      .select('id, app_store_id')
      .order('id', { ascending: true })
      .range(from, from + CHUNK - 1);
    if (error) throw new Error(`sitemap query failed: ${error.message}`);
    const rows = data || [];
    for (const a of rows) seen.add(String(a.app_store_id || a.id));
    if (rows.length < CHUNK) break;
  }
  return Array.from(seen);
}

export const GET: APIRoute = async (ctx) => {
  try {
    const slugs = await fetchSlugs(supabaseFor(ctx));
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
      slugs.map((s) => `<url><loc>${SITE}/app/${s}</loc></url>`).join('') +
      `</urlset>`;

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    });
  } catch (err) {
    console.error('sitemap error:', (err as any)?.message);
    return new Response('Internal error', { status: 500 });
  }
};
