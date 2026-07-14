import type { APIRoute } from 'astro';
import { supabaseFor } from '../lib/supabase';
import { SITE_ORIGIN as SITE } from '../lib/http';
import { fetchSitemapSlugs, fetchCollectionSlugs, SITEMAP_CHUNK, SITEMAP_HEADERS } from '../lib/sitemap';

// A child sitemap: /sitemap-<n>.xml carries the n-th SITEMAP_CHUNK slice of the
// app slugs (see the index at /sitemap.xml). The first child also emits the
// /collections landing and each published collection, which can't live in the
// index (a sitemapindex holds only <sitemap> entries).
export const GET: APIRoute = async (ctx) => {
  const raw = ctx.params.n || '';
  if (!/^\d{1,4}$/.test(raw)) return new Response('Not found', { status: 404 });
  const page = parseInt(raw, 10);
  if (page < 1) return new Response('Not found', { status: 404 });

  try {
    const supabase = supabaseFor(ctx);
    const slugs = await fetchSitemapSlugs(supabase);
    const start = (page - 1) * SITEMAP_CHUNK;
    // Page past the end (and not the sole page 1) → 404, not an empty urlset.
    if (start >= slugs.length && page !== 1) return new Response('Not found', { status: 404 });
    const chunk = slugs.slice(start, start + SITEMAP_CHUNK);

    let extra = '';
    if (page === 1) {
      const collectionSlugs = await fetchCollectionSlugs(supabase);
      extra =
        `<url><loc>${SITE}/collections</loc></url>` +
        collectionSlugs.map((s) => `<url><loc>${SITE}/collections/${s}</loc></url>`).join('');
    }

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
      extra +
      chunk.map((s) => `<url><loc>${SITE}/app/${s}</loc></url>`).join('') +
      `</urlset>`;

    return new Response(xml, { status: 200, headers: SITEMAP_HEADERS });
  } catch (err) {
    console.error('sitemap child error:', (err as any)?.message);
    return new Response('Internal error', { status: 500 });
  }
};
