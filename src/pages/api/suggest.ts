import type { APIRoute } from 'astro';
import { supabaseFor } from '../../lib/supabase';
import { json } from '../../lib/api';
import { buildPrefixTsquery, looksLikeBundleId, escapeLike } from '../../lib/search';
import { appTitleOf, APP_LIST_COLS, flattenAppRow } from '../../lib/apps';

// Header-search autocomplete: relevance-ranked apps (same search_apps RPC the
// search page uses) plus matching developers and genres. Tiny payload,
// edge-cached so keystroke fan-out mostly never reaches the DB.
// Rows are {type: 'app'|'developer'|'genre', name, href, dev?, icon?}.

function appRow(a: any) {
  return {
    type: 'app',
    name: appTitleOf(a),
    dev: a.developer_artist_name || null,
    href: `/app/${a.app_store_id && Number(a.app_store_id) !== 0 ? a.app_store_id : a.id}`,
    icon: a.oldest_icon_sha256 ? `/icon/${a.oldest_icon_sha256}` : null,
  };
}

export const GET: APIRoute = async (ctx) => {
  const q = (ctx.url.searchParams.get('q') || '').trim().slice(0, 60);
  if (q.length < 2) return json({ suggestions: [] }, 200, 300);

  const supabase = supabaseFor(ctx);

  // A pasted bundle id resolves to exactly that app (same shape the search
  // page's exact-jump uses) — one row, nothing else.
  if (looksLikeBundleId(q)) {
    const { data } = await supabase
      .from('apps')
      .select(`${APP_LIST_COLS}, oldest_icon_sha256`)
      .eq('bundle_id', q)
      .not('excluded', 'is', true)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) return json({ suggestions: [appRow(flattenAppRow(data))] }, 200, 300);
    // No exact match → fall through (the C-weight lexemes still match the
    // bundle-id words through the normal path).
  }

  const like = escapeLike(q) + '%';
  const [appsRes, devsRes, genresRes] = await Promise.all([
    // Overfetch: the archive holds many junk clones sharing a famous name
    // (e.g. dozens of apps named "Snapchat") — dedupe by name below.
    supabase.rpc('search_apps', {
      p_query: buildPrefixTsquery(q),
      p_raw: q,
      p_genre_id: null,
      p_sort: 'relevance',
      p_limit: 15,
      p_offset: 0,
      p_dev_ids: null,
    }),
    supabase.from('developers').select('id, artist_id, artist_name')
      .ilike('artist_name', like).order('artist_name', { ascending: true }).limit(3),
    supabase.from('genres').select('id, genre_name')
      .ilike('genre_name', like).order('genre_name', { ascending: true }).limit(2),
  ]);
  if (appsRes.error) {
    console.error('suggest failed:', appsRes.error.message);
    return json({ suggestions: [] }, 200, 60);
  }
  // Highest-ranked app per name wins; cap at 6.
  const seen = new Set<string>();
  const apps: any[] = [];
  for (const a of appsRes.data || []) {
    const key = appTitleOf(a).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    apps.push(appRow(a));
    if (apps.length >= 6) break;
  }
  const suggestions = [
    ...(genresRes.data || []).map((g: any) => ({
      type: 'genre', name: g.genre_name, href: `/search?genre=${g.id}`,
    })),
    ...(devsRes.data || []).map((d: any) => ({
      type: 'developer', name: d.artist_name, href: `/developer/${d.artist_id ?? d.id}`,
    })),
    ...apps,
  ];
  return json({ suggestions }, 200, 300);
};
