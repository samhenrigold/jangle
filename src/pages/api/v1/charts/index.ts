import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../../lib/supabase';
import { json, fail, degraded, idStr, appSummary, CORS, checkParams } from '../../../../lib/api';
import { flattenAppRow } from '../../../../lib/apps';
import { getChartTypes, getSnapshotIndex, getSnapshotPositions, nearestSnapshot, deviceOf, waybackUrl } from '../../../../lib/timemachine';

// GET /api/v1/charts — one archived chart snapshot with its ranked positions.
//   ?type=    chart type slug (default top-free; see /api/v1/charts/types)
//   ?genre=   internal genre id for genre charts (omit = the all-apps chart)
//   ?date=    YYYY-MM-DD — nearest archived snapshot is returned (the archive
//             is sparse; the response says which date you actually got)
//   ?device=  iphone (default) | ipad
// Bounded (≤300 positions): no pagination. Same index/positions loaders and
// anti-counterfeit rule as the site's /charts page.
export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, ['type', 'genre', 'date', 'device']);
  if (bad) return bad;
  const p = ctx.url.searchParams;

  const typeSlug = p.get('type') || 'top-free';
  const rawGenre = p.get('genre');
  if (rawGenre && !/^\d{1,7}$/.test(rawGenre)) return fail(400, 'invalid_parameter', 'genre must be a numeric id from /api/v1/genres');
  const genreId = rawGenre ? Number(rawGenre) : null;
  const date = p.get('date');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400, 'invalid_parameter', 'date must be YYYY-MM-DD');
  const device = p.get('device') || 'iphone';
  if (!['iphone', 'ipad'].includes(device)) return fail(400, 'invalid_parameter', 'device must be iphone or ipad');

  const supabase = supabaseFor(ctx);
  const [types, index] = await Promise.all([getChartTypes(supabase), getSnapshotIndex(supabase)]);
  if (!types || !index) return degraded();

  const type = types.find((t) => t.slug === typeSlug);
  if (!type) return fail(400, 'invalid_parameter', `unknown chart type "${typeSlug}"`, { supported: types.map((t) => t.slug) });

  const candidates = index
    .filter((s) => s.chart_type_id === type.id && (s.genre_id ?? null) === genreId && deviceOf(s.source_url) === device)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  if (!candidates.length) return fail(404, 'not_found', 'no archived snapshots for this chart/genre/device combination');

  const snap = date ? nearestSnapshot(candidates, date) : candidates[candidates.length - 1];
  if (!snap) return fail(404, 'not_found', 'no archived snapshot near that date');

  const positions = await getSnapshotPositions(supabase, snap.id);
  if (!positions) return degraded();

  return json(
    {
      chart_type: { chart_type_id: idStr(type.id), name: type.name, slug: type.slug },
      genre_id: idStr(genreId),
      device,
      snapshot_date: snap.snapshot_date,
      // 14-digit Wayback ts → ISO 8601 (the API-wide timestamp convention);
      // the raw form survives inside wayback_url.
      captured_at: ((cts: string | null) => (cts && /^\d{14}$/.test(cts)
        ? `${cts.slice(0, 4)}-${cts.slice(4, 6)}-${cts.slice(6, 8)}T${cts.slice(8, 10)}:${cts.slice(10, 12)}:${cts.slice(12, 14)}Z`
        : null))(snap.captured_ts),
      // source_url may carry an internal "wayback:" prefix marking a
      // Wayback-recovered page — strip it for the public record.
      source_url: (snap.source_url || '').replace(/^wayback:/, '') || null,
      wayback_url: waybackUrl(snap.captured_ts, (snap.source_url || '').replace(/^wayback:/, '')) || null,
      available_dates: Array.from(new Set(candidates.map((s) => s.snapshot_date))),
      positions: positions.map((r: any) => ({
        position: r.position,
        app_store_id: idStr(r.app_store_id),
        name: r.display_name ?? null, // the chart feed's own (period-accurate) name
        developer: r.developer_name ?? null,
        price_amount: r.price_amount != null ? Number(r.price_amount) : null,
        price_currency: r.price_currency ?? null,
        app: r.apps ? appSummary(flattenAppRow(r.apps)) : null,
      })),
    },
    200,
    3600
  );
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
