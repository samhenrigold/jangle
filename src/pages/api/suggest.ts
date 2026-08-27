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
    icon: (a.rep_icon_sha256 || a.oldest_icon_sha256) ? `/icon/${a.rep_icon_sha256 || a.oldest_icon_sha256}` : null,
  };
}

export const GET: APIRoute = async (ctx) => {
  const q = (ctx.url.searchParams.get('q') || '').trim().slice(0, 60);
  if (q.length < 2) return json({ suggestions: [] }, 200, 300);

  const supabase = supabaseFor(ctx);

  // A pasted bundle id resolves to exactly that app (same shape the search
  // page's exact-jump uses) — one row, nothing else. Trailing "." / "*" mark
  // an explicit prefix query ("com.clickgamer." / "com.rovio.*") — strip them
  // BEFORE the shape test or the * fails it and the query leaks to FTS.
  const qBundle = q.replace(/[*]+$/, '').replace(/\.+$/, '');
  if (looksLikeBundleId(qBundle)) {
    const { data } = await supabase
      .from('apps')
      .select(`${APP_LIST_COLS}, rep_icon_sha256, oldest_icon_sha256`)
      .eq('bundle_id', qBundle)
      .not('excluded', 'is', true)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) return json({ suggestions: [appRow(flattenAppRow(data))] }, 200, 300);
    // No exact match → prefix lookup: "com.clickgamer." (or "com.clickgamer.*")
    // lists that namespace's apps. Left-anchored LIKE with escaped metachars,
    // so a stray * can't turn into an unanchored scan.
    const { data: pfx } = await supabase
      .from('apps')
      .select(`${APP_LIST_COLS}, rep_icon_sha256, oldest_icon_sha256`)
      .ilike('bundle_id', escapeLike(qBundle) + '%')
      .not('excluded', 'is', true)
      .order('version_count', { ascending: false, nullsFirst: false })
      .limit(6);
    if (pfx?.length) return json({ suggestions: pfx.map((a: any) => appRow(flattenAppRow(a))) }, 200, 300);
    // Still nothing → fall through (the C-weight lexemes may match the
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
    // Overfetch developers too: alphabetical limit-3 buried Microsoft behind
    // "microkernel" — rank them by archived-catalog weight below instead.
    supabase.from('developers').select('id, artist_id, artist_name')
      .ilike('artist_name', like).limit(25),
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
  // Weight matched developers by their archived catalog (sum of version
  // counts). Decides both which 3 to show and WHERE: a heavyweight developer
  // ("micr" → Microsoft) leads the list; lightweights ("doodle" → Doodle
  // Buddy Labs) sit below the apps the user more likely wants.
  let devs: any[] = [];
  let maxDevWeight = 0;
  if (devsRes.data?.length) {
    const weight = new Map<number, number>();
    const { data: devApps } = await supabase
      .from('apps')
      .select('developer_id, version_count')
      .in('developer_id', devsRes.data.map((d: any) => d.id))
      .not('excluded', 'is', true)
      .limit(1000);
    for (const a of devApps || []) {
      const id = Number(a.developer_id);
      weight.set(id, (weight.get(id) || 0) + (Number(a.version_count) || 0));
    }
    devs = [...devsRes.data]
      .sort((x: any, y: any) => (weight.get(Number(y.id)) || 0) - (weight.get(Number(x.id)) || 0))
      .slice(0, 3)
      .map((d: any) => ({
        type: 'developer', name: d.artist_name, href: `/developer/${d.artist_id ?? d.id}`,
      }));
    maxDevWeight = Math.max(0, ...devsRes.data.map((d: any) => weight.get(Number(d.id)) || 0));
  }
  const topAppWeight = Number(appsRes.data?.[0]?.version_count) || 0;
  const devsLead = maxDevWeight > topAppWeight * 1.5;
  const genres = (genresRes.data || []).map((g: any) => ({
    type: 'genre', name: g.genre_name, href: `/search?genre=${g.id}`,
  }));
  const suggestions = devsLead
    ? [...devs, ...apps, ...genres]
    : [...apps, ...devs, ...genres];
  return json({ suggestions }, 200, 300);
};
