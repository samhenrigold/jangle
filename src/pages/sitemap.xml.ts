import type { APIRoute } from 'astro';
import { supabaseFor } from '../lib/supabase';
import { SITE_ORIGIN as SITE } from '../lib/http';
import { fetchSitemapSlugs, SITEMAP_CHUNK, SITEMAP_HEADERS } from '../lib/sitemap';

// The sitemap INDEX. Past 50k URLs a single urlset is invalid, so /sitemap.xml
// now lists the child sitemaps (/sitemap-1.xml, …) and each child carries a
// SITEMAP_CHUNK-sized slice of the catalog. The /collections URLs ride in the
// first child. robots.txt points here.
export const GET: APIRoute = async (ctx) => {
  try {
    const slugs = await fetchSitemapSlugs(supabaseFor(ctx));
    const pages = Math.max(1, Math.ceil(slugs.length / SITEMAP_CHUNK));
    const children: string[] = [];
    for (let i = 1; i <= pages; i++) {
      children.push(`<sitemap><loc>${SITE}/sitemap-${i}.xml</loc></sitemap>`);
    }
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
      children.join('') +
      `</sitemapindex>`;

    return new Response(xml, { status: 200, headers: SITEMAP_HEADERS });
  } catch (err) {
    console.error('sitemap index error:', (err as any)?.message);
    return new Response('Internal error', { status: 500 });
  }
};
