// Shared helpers for the Wayback "Time Machine" features (plan 010 Phase 5):
// the historical charts browser (/charts) and the app-page history
// sections (chart trajectory, rating history, archived reviews).

import { cacheGet, cacheSet } from './cache';

export type ChartType = { id: number; name: string; slug: string };

export type SnapshotMeta = {
  id: number;
  snapshot_date: string; // YYYY-MM-DD
  chart_type_id: number;
  genre_id: number | null;
  source_url: string;
  captured_ts: string | null;
  positions: number;
};

export type Device = 'iphone' | 'ipad';

// Gen-1 feed slugs carry the device in the path (topfreeipadapplications);
// everything else is the iPhone/all chart.
export function deviceOf(sourceUrl: string): Device {
  return /ipad/i.test(sourceUrl || '') ? 'ipad' : 'iphone';
}

export function waybackUrl(ts: string | null, sourceUrl: string): string {
  if (!ts || !sourceUrl) return '';
  return `https://web.archive.org/web/${ts}/${sourceUrl}`;
}

// chart_types is a 5-row lookup table; null means the query failed (degrade,
// don't cache).
export async function getChartTypes(supabase: any): Promise<ChartType[] | null> {
  const cached = cacheGet<ChartType[]>('tm:chart_types');
  if (cached) return cached;
  const { data, error } = await supabase.from('chart_types').select('id, name, slug').order('id');
  if (error) {
    console.error('chart_types query failed:', error.message);
    return null;
  }
  const types = data || [];
  cacheSet('tm:chart_types', types, 60 * 60 * 1000);
  return types;
}

// genres.id doubles as the App Store genre id (chart_snapshots.genre_id FK).
export async function getGenreNames(supabase: any): Promise<Map<number, string> | null> {
  const cached = cacheGet<Map<number, string>>('tm:genre_names');
  if (cached) return cached;
  const { data, error } = await supabase.from('genres').select('id, genre_name');
  if (error) {
    console.error('genres query failed:', error.message);
    return null;
  }
  const map = new Map<number, string>();
  for (const g of data || []) map.set(Number(g.id), g.genre_name);
  cacheSet('tm:genre_names', map, 60 * 60 * 1000);
  return map;
}

// Chart depth from the feed URL (…/limit=100/xml). Cheaper than counting
// chart_positions per snapshot, which blows the anon statement timeout.
function limitOf(sourceUrl: string): number {
  const m = /limit=(\d+)/.exec(sourceUrl || '');
  return m ? Number(m[1]) : 0;
}

// The full snapshot index (~1.3k rows) in one query; every navigation control
// on /charts derives from it, so it's cached as a unit.
export async function getSnapshotIndex(supabase: any): Promise<SnapshotMeta[] | null> {
  const cached = cacheGet<SnapshotMeta[]>('tm:snapshot_index');
  if (cached) return cached;
  // PostgREST caps responses at max-rows (1000) regardless of .limit(), so
  // page through; the index is ~1.3k rows and growing.
  const CHUNK = 1000;
  const MAX_CHUNKS = 20;
  const rows: any[] = [];
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const { data, error } = await supabase
      .from('chart_snapshots')
      .select('id, snapshot_date, chart_type_id, genre_id, source_url, captured_ts, position_count')
      // Hide sparse captures (<=3 apps): those are noise to page through, and a
      // chart_type/device/genre combo whose captures are all sparse drops out of
      // the filter options entirely. position_count is a maintained column, so
      // this is an indexed filter, not a per-request aggregate over chart_positions.
      .gt('position_count', 3)
      .order('snapshot_date', { ascending: true })
      .order('id', { ascending: true })
      .range(i * CHUNK, i * CHUNK + CHUNK - 1);
    if (error) {
      console.error('chart_snapshots index query failed:', error.message);
      return null;
    }
    rows.push(...(data || []));
    if ((data || []).length < CHUNK) break;
  }
  const index: SnapshotMeta[] = rows.map((s: any) => ({
    id: Number(s.id),
    snapshot_date: s.snapshot_date,
    chart_type_id: Number(s.chart_type_id),
    genre_id: s.genre_id == null ? null : Number(s.genre_id),
    source_url: s.source_url || '',
    captured_ts: s.captured_ts || null,
    // Actual archived depth (maintained count), falling back to the URL's declared
    // limit; used for "densest capture wins" dedupe and the sparse-capture filter.
    positions: s.position_count != null ? Number(s.position_count) : limitOf(s.source_url),
  }));
  cacheSet('tm:snapshot_index', index, 10 * 60 * 1000);
  return index;
}

// Chart entries for one capture, ranked. Shared by /charts and the
// Featured page's "years ago this week" module.
export async function getSnapshotPositions(supabase: any, snapshotId: number): Promise<any[] | null> {
  const key = `tm:positions:${snapshotId}`;
  const cached = cacheGet<any[]>(key);
  if (cached) return cached;
  const { data, error } = await supabase
    .from('chart_positions')
    .select('position, app_store_id, display_name, developer_name, price_amount, price_currency, artwork_url, apps(id, app_store_id, app_store_name, icon_url)')
    .eq('chart_snapshot_id', snapshotId)
    .order('position', { ascending: true })
    .limit(300);
  if (error) {
    console.error('chart_positions query failed:', error.message);
    return null;
  }
  // The leaked-marketing chart source reconstructed names from URL slugs and
  // .title()-cased them ("infinity-blade-ii" -> "Infinity Blade Ii"), mangling
  // roman numerals and lowercase-initial brands (iPhoto -> Iphoto). Those rows are
  // identifiable by a null developer_name; real chart-feed rows carry a developer
  // and a period-accurate name. So ONLY for the slug-derived rows, and only when
  // the entry links to a known app, swap in that app's authoritative iTunes name.
  // Real-feed names are left untouched (period-accurate; avoids showing a later
  // rename on an old chart). Only the display string changes — app_store_id drives
  // all chart logic (fingerprints, prev/next), so this is display-only.
  const rows = (data || []).map((r: any) =>
    !r.developer_name && r.apps?.app_store_name
      ? { ...r, display_name: r.apps.app_store_name }
      : r
  );
  cacheSet(key, rows, 10 * 60 * 1000);
  return rows;
}

type Peak = {
  position: number;
  typeId: number;
  date: string;
  device: Device;
};

// Best all-genre chart placement per app, for badge lines under list rows.
// !inner + the embedded genre_id filter keeps this to the all-apps charts
// (a #1 in a niche genre chart isn't "peaked at #1").
async function getPeaks(
  supabase: any,
  appStoreIds: number[],
  cacheKey: string
): Promise<Map<number, Peak> | null> {
  const ids = appStoreIds.filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) return new Map();
  const key = `tm:peaks:${cacheKey}`;
  const cached = cacheGet<Map<number, Peak>>(key);
  if (cached) return cached;
  // get_app_peaks returns the single best all-genre placement per app (DISTINCT
  // ON, index-backed) — no blanket row cap that could truncate an app's true peak.
  const { data, error } = await supabase.rpc('get_app_peaks', { p_app_store_ids: ids });
  if (error) {
    console.error('chart peaks query failed:', error.message);
    return null;
  }
  const peaks = new Map<number, Peak>();
  for (const row of data || []) {
    peaks.set(Number(row.app_store_id), {
      position: Number(row.peak_position),
      typeId: Number(row.chart_type_id),
      date: row.snapshot_date,
      device: deviceOf(row.source_url || ''),
    });
  }
  cacheSet(key, peaks, 10 * 60 * 1000);
  return peaks;
}

// "Peaked at #1 Top Paid · Dec 2010" — one line under a list row.
function peakText(peak: Peak | null | undefined, typesById: Map<number, { name: string }>): string {
  if (!peak) return '';
  const typeName = typesById.get(peak.typeId)?.name || 'the charts';
  const device = peak.device === 'ipad' ? ' (iPad)' : '';
  return `Peaked at #${peak.position} ${typeName}${device} · ${formatMonthYear(peak.date)}`;
}

// Chart-type lookup + best-placement badges in one call — shared by the
// Featured and Top 25 pages. Returns null on any query failure (degrade).
export async function getPeakLines(
  supabase: any,
  appStoreIds: number[],
  cacheKey: string
): Promise<Map<number, string> | null> {
  const [types, peaks] = await Promise.all([
    getChartTypes(supabase),
    getPeaks(supabase, appStoreIds, cacheKey),
  ]);
  if (!types || peaks === null) return null;
  const typesById = new Map(types.map((t) => [Number(t.id), t]));
  const lines = new Map<number, string>();
  for (const [id, peak] of peaks) lines.set(id, peakText(peak, typesById));
  return lines;
}

// --- Per-app history (the app page's Chart History / Ratings / Reviews
// sections). All keyed by app_store_id; each returns null on a query failure
// so the caller can drop just that section (decorative — never 503 the page).

// Raw chart placements for one app, joined to their snapshot's date/genre/feed.
export async function getAppChartHistory(supabase: any, appStoreId: number): Promise<any[] | null> {
  const key = `tm:apphist:${appStoreId}`;
  const cached = cacheGet<any[]>(key);
  if (cached) return cached;
  const { data, error } = await supabase
    .from('chart_positions')
    .select('position, chart_snapshots(snapshot_date, genre_id, chart_type_id, source_url)')
    .eq('app_store_id', appStoreId)
    .limit(1000);
  if (error) {
    console.error('chart history query failed:', error.message);
    return null;
  }
  cacheSet(key, data || [], 10 * 60 * 1000);
  return data || [];
}

// Listing-snapshot trail (rating avg/count, version, price), oldest first.
export async function getAppRatingHistory(supabase: any, appStoreId: number): Promise<any[] | null> {
  const key = `tm:ratings:${appStoreId}`;
  const cached = cacheGet<any[]>(key);
  if (cached) return cached;
  const { data, error } = await supabase
    .from('app_listing_snapshots')
    .select('captured_at, rating_avg, rating_count, version, price_amount, price_currency')
    .eq('app_store_id', appStoreId)
    .order('captured_at', { ascending: true })
    .limit(1000);
  if (error) {
    console.error('rating history query failed:', error.message);
    return null;
  }
  cacheSet(key, data || [], 10 * 60 * 1000);
  return data || [];
}

// The most-helpful archived reviews plus the app's total review count.
export async function getAppReviews(
  supabase: any,
  appStoreId: number,
  limit: number
): Promise<{ rows: any[]; total: number } | null> {
  const key = `tm:reviews:${appStoreId}`;
  const cached = cacheGet<{ rows: any[]; total: number }>(key);
  if (cached) return cached;
  // Chronological, oldest first. Ordering by vote_sum surfaced the handful of
  // recently live-fetched reviews (stamped with today's fetch date) over the
  // hundreds of genuine period reviews recovered from archived feeds — which
  // carry app_version + the capture timestamp (first_seen_ts) but no vote_sum.
  // first_seen_ts (14-digit Wayback ts) sorts lexically = chronologically; the
  // few live rows (first_seen_ts NULL) fall to the end.
  const { data, error, count } = await supabase
    .from('app_reviews')
    .select('review_id, stars, title, body, author, app_version, vote_sum, vote_count, reviewed_at, first_seen_ts', { count: 'exact' })
    .eq('app_store_id', appStoreId)
    .order('first_seen_ts', { ascending: true, nullsFirst: false })
    .order('review_id', { ascending: true })
    .limit(limit);
  if (error) {
    console.error('archived reviews query failed:', error.message);
    return null;
  }
  const result = { rows: data || [], total: count || (data || []).length };
  cacheSet(key, result, 10 * 60 * 1000);
  return result;
}

const waybackTsFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
});

// 14-digit Wayback timestamp → "Nov 23, 2010, 6:31 PM UTC".
export function formatWaybackTs(ts: string | null | undefined): string {
  if (!ts || !/^\d{14}$/.test(ts)) return '';
  const iso = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return waybackTsFmt.format(d);
}

// 14-digit Wayback timestamp → "Jul 2012". Used as an approximate review date:
// review feeds carry no per-entry date in our store, so the capture month is
// the best "written on or before" anchor we have.
export function formatApproxMonthYear(ts: string | null | undefined): string {
  if (!ts || ts.length < 6) return '';
  return formatMonthYear(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-01`);
}

// Several captures of the same feed can land on one date (partner-link URL
// variants, different limit= sizes). One snapshot per date: the deepest chart
// wins, then the cleaner (shorter) source URL.
export function dedupeByDate(snapshots: SnapshotMeta[]): SnapshotMeta[] {
  const byDate = new Map<string, SnapshotMeta>();
  for (const s of snapshots) {
    const cur = byDate.get(s.snapshot_date);
    if (
      !cur ||
      s.positions > cur.positions ||
      (s.positions === cur.positions && s.source_url.length < cur.source_url.length)
    ) {
      byDate.set(s.snapshot_date, s);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
}

// Nearest capture to the requested date (ties go to the earlier one), so any
// date link works even where the archive has gaps.
export function nearestSnapshot(sorted: SnapshotMeta[], targetDate: string): SnapshotMeta | null {
  if (!sorted.length) return null;
  const target = Date.parse(targetDate + 'T00:00:00Z');
  if (!Number.isFinite(target)) return sorted[0];
  let best = sorted[0];
  let bestDiff = Infinity;
  for (const s of sorted) {
    const diff = Math.abs(Date.parse(s.snapshot_date + 'T00:00:00Z') - target);
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

const currencyFmts = new Map<string, Intl.NumberFormat>();

// "Free" / "$0.99" — chart feeds carry (amount, currency); null amount → ''.
// The try/catch survives junk currency codes in scraped data, not missing Intl.
export function formatPrice(amount: unknown, currency: unknown): string {
  const v = Number(amount);
  if (amount == null || !Number.isFinite(v)) return '';
  if (v === 0) return 'Free';
  const code = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  try {
    let fmt = currencyFmts.get(code);
    if (!fmt) {
      fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: code });
      currencyFmts.set(code, fmt);
    }
    return fmt.format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

// "★★★★☆" — text stars render on every iOS back to 3.x, no images needed.
export function starString(stars: unknown): string {
  const n = Math.max(0, Math.min(5, Math.round(Number(stars) || 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

// Evenly thins a long series to maxItems, always keeping first and last.
export function sampleEvenly<T>(items: T[], maxItems: number): T[] {
  if (items.length <= maxItems) return items;
  const out: T[] = [];
  const step = (items.length - 1) / (maxItems - 1);
  for (let i = 0; i < maxItems; i++) out.push(items[Math.round(i * step)]);
  return out.filter((v, i) => i === 0 || v !== out[i - 1]);
}

const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

// "Nov 2010" — coarse label for ranges and sparkline endpoints.
export function formatMonthYear(iso: unknown): string {
  if (!iso || typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return monthFmt.format(d);
}
