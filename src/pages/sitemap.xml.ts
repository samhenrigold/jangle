import type { APIRoute } from 'astro';
import { getSupabaseClient } from '../lib/supabase';

const SITE = 'https://legacystore.app';
const CHUNK = 1000;
const MAX_CHUNKS = 40; // runaway guard: 40 * 1000 = 40k rows, well above the ~28k catalog

export const GET: APIRoute = async (ctx) => {
  try {
    const supabase = getSupabaseClient((ctx.locals as any)?.runtime?.env);

    const seen = new Set<string>();
    const locs: string[] = [];

    for (let i = 0; i < MAX_CHUNKS; i++) {
      const from = i * CHUNK;
      const to = from + CHUNK - 1;
      const { data, error } = await supabase
        .from('apps')
        .select('id, app_store_id')
        .order('id', { ascending: true })
        .range(from, to);

      if (error) {
        console.error('sitemap query failed:', error.message);
        return new Response('Internal error', { status: 500 });
      }

      const rows = data || [];
      for (const a of rows) {
        const slug = String((a as any).app_store_id ?? (a as any).id);
        if (seen.has(slug)) continue;
        seen.add(slug);
        locs.push(`<url><loc>${SITE}/app/${slug}</loc></url>`);
      }

      if (rows.length < CHUNK) break;
    }

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
      locs.join('') +
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
