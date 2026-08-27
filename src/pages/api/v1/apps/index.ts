import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../../lib/supabase';
import {
  json, fail, degraded, appSummary, CORS, checkParams,
  clampLimit, encodeCursor, decodeCursor, listBody,
} from '../../../../lib/api';
import { APP_LIST_COLS, flattenAppRow } from '../../../../lib/apps';
import { buildPrefixTsquery, looksLikeBundleId, escapeLike } from '../../../../lib/search';

// GET /api/v1/apps — search / list the catalog.
//   ?q=       keyword (FTS, prefix-matched) or bundle-id substring (q contains a dot)
//   ?genre=   internal genre id (see /api/v1/genres)
//   ?sort=    versions (default, most-archived first) | relevance (best match,
//             needs q) | first_date | newest | name
//   ?limit=   1-200 (default 50)
//   ?cursor=  opaque, from a previous response's next_url
//
// Mirrors the search page's branches over the same RPCs/queries — one logic,
// two presentations.
// ponytail: the cursor wraps an offset (the backing RPCs are offset-based);
// swap to true keyset inside the same opaque token if deep pages ever matter.
const SORTS = ['versions', 'relevance', 'first_date', 'newest', 'name'];

export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, ['q', 'genre', 'sort', 'limit', 'cursor']);
  if (bad) return bad;
  const p = ctx.url.searchParams;

  const q = (p.get('q') || '').trim();
  const rawGenre = p.get('genre');
  if (rawGenre && !/^\d{1,7}$/.test(rawGenre)) return fail(400, 'invalid_parameter', 'genre must be a numeric id from /api/v1/genres');
  const genreId = rawGenre ? Number(rawGenre) : null;
  const sort = p.get('sort') || 'versions';
  if (!SORTS.includes(sort)) return fail(400, 'invalid_parameter', `sort must be one of ${SORTS.join(', ')}`);
  const limit = clampLimit(p.get('limit'), 50, 200);
  const cur = decodeCursor(p.get('cursor'));
  const offset = cur && Number.isInteger(cur[0]) && (cur[0] as number) >= 0 ? (cur[0] as number) : 0;

  const supabase = supabaseFor(ctx);
  const looksLikeBundle = looksLikeBundleId(q);
  const tsquery = q && !looksLikeBundle ? buildPrefixTsquery(q) : null;
  if (q && !looksLikeBundle && !tsquery) return json(listBody(ctx.url, [], 0, null), 200, 300);

  try {
    let rows: any[] = [];
    let total: number | null = null;

    if (looksLikeBundle) {
      // Bundle-id substring branch (FTS strips dots, so this is its own path).
      const like = `%${escapeLike(q)}%`;
      const applyFilters = (query: any) => {
        let out = query.not('excluded', 'is', true).ilike('bundle_id', like);
        if (genreId) out = out.eq('genre_id', genreId);
        return out;
      };
      const [{ count, error: cErr }, { data, error: lErr }] = await Promise.all([
        applyFilters(supabase.from('apps').select('id', { count: 'exact', head: true })),
        (sort === 'first_date' || sort === 'newest'
          ? applyFilters(supabase.from('apps').select(APP_LIST_COLS))
              .order('first_version_date', { ascending: sort === 'first_date', nullsFirst: false })
          : applyFilters(supabase.from('apps').select(APP_LIST_COLS))
              .order(sort === 'name' ? 'display_name' : 'version_count', { ascending: sort === 'name' })
        )
          .order('bundle_id', { ascending: true })
          .range(offset, offset + limit - 1),
      ]);
      if (cErr || lErr) throw new Error((cErr || lErr)!.message);
      rows = (data || []).map(flattenAppRow);
      total = count ?? null;
    } else {
      // One ranked-search RPC: list + total in one round trip, ranking and
      // typo-tolerant fallback inside the function (see search_apps in
      // supabase_functions.sql). Matches names, developer names, and
      // bundle-id words.
      const { data, error } = await supabase.rpc('search_apps', {
        p_query: tsquery,
        p_raw: q || null,
        p_genre_id: genreId,
        p_sort: sort,
        p_limit: limit,
        p_offset: offset,
        p_dev_ids: null,
      });
      if (error) throw new Error(error.message);
      rows = data || [];
      total = Number(rows[0]?.total) || 0;
    }

    const data = rows.map(appSummary);
    const nextCursor = rows.length === limit ? encodeCursor([offset + limit]) : null;
    return json(listBody(ctx.url, data, total, nextCursor), 200, 300);
  } catch (err) {
    console.error('v1 apps list error:', (err as any)?.message);
    return degraded();
  }
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
