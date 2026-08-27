// Shared plumbing for the public JSON API (/api/v1 and friends).
//
// The design contract (see plans + /developers):
// - GET-only, everything in the URL → every response is an edge-cache entry.
// - Lists are enveloped: {data, total, next_url|null}. Single resources: bare object.
// - All ids serialize as JSON strings (bigint > 2^53 mangles in JS; we've been
//   bitten by external_identifier already). Numbers only where math is meaningful.
// - Timestamps are ISO 8601 UTC.
// - Keys always present, value-or-null (matches the DB's true-or-null convention);
//   stable key sets keep responses byte-identical for caching.
// - Errors: real status + {error:{code,message}}; 5xx/blips are never edge-cached.

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// JSON response with split-header caching (see lib/http.ts for why s-maxage is
// avoided: it disables stale-while-revalidate/stale-if-error at the shared
// cache). `cache` is the edge TTL in seconds; browser TTL stays short (60s).
// Pass 0 (default) for no-store — errors and uncacheable answers.
const STALE = 'stale-while-revalidate=86400, stale-if-error=604800';
export function json(body: unknown, status = 200, cacheSeconds = 0): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    // Open data meant for programmatic use, not SERPs — keep JSON responses out
    // of search indexes regardless of what a crawler does with robots.txt.
    'X-Robots-Tag': 'noindex',
    ...CORS,
  };
  if (cacheSeconds > 0 && status < 500) {
    headers['Cache-Control'] = `public, max-age=60, ${STALE}`;
    headers['Cloudflare-CDN-Cache-Control'] = `public, max-age=${cacheSeconds}, ${STALE}`;
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function fail(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: { code, message, ...extra } }, status);
}

// DB blip: uncacheable 503 with a hint to retry — never let a transient failure
// pin itself at the edge as a 404 or an empty list.
export function degraded(message = 'the archive is briefly unavailable — retry shortly'): Response {
  const res = fail(503, 'degraded', message);
  res.headers.set('Retry-After', '30');
  return res;
}

// ---- serializers -----------------------------------------------------------

// Ids as strings (null stays null). Use for every id-like field.
export function idStr(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

// ISO 8601 UTC or null. Accepts Date | string | null.
export function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

// ---- entity serializers ----------------------------------------------------
// One serializer per entity: the app summary embedded anywhere is field-for-
// field this shape. Keys always present, value-or-null.

import { SITE_ORIGIN } from './http';
import { appTitleOf } from './apps';

// From an APP_LIST_COLS-shaped row (flattened or with developers embed).
export function appSummary(a: any): Record<string, unknown> {
  const slug = a.app_store_id && Number(a.app_store_id) !== 0 ? a.app_store_id : a.id;
  const iconSha = a.rep_icon_sha256 || a.oldest_icon_sha256 || null;
  return {
    app_store_id: idStr(a.app_store_id && Number(a.app_store_id) !== 0 ? a.app_store_id : null),
    bundle_id: a.bundle_id ?? null,
    name: appTitleOf(a) || null,
    developer: a.developer_artist_name ?? a.developers?.artist_name ?? null,
    genre_id: idStr(a.genre_id),
    version_count: a.version_count != null ? Number(a.version_count) : null,
    icon_url: iconSha
      ? `${SITE_ORIGIN}/icon/${iconSha}`
      : (typeof a.icon_url === 'string' && /^https?:\/\//.test(a.icon_url) ? a.icon_url : null),
    url: `${SITE_ORIGIN}/api/v1/apps/${slug}`,
    web_url: `${SITE_ORIGIN}/app/${slug}`,
  };
}

// Resolve an app {key} (App Store ID | bundle_id | internal id) for a v1
// route. Non-canonical keys 301 to the canonical (app_store_id-based) URL so
// the edge cache converges on one entry per app. Returns the app row, or a
// ready Response (301/404/503).
import { resolveApp } from './apps';
import { supabaseFor } from './supabase';

export async function resolveAppOr404(ctx: { params: any; url: URL; locals?: any }): Promise<{ app: any } | { response: Response }> {
  const key = String(ctx.params.key || '');
  const { app, dbError } = await resolveApp(supabaseFor(ctx), key);
  if (dbError) return { response: degraded() };
  if (!app) return { response: fail(404, 'not_found', `no app matches "${key}" (App Store ID, bundle_id, or internal id)`) };
  const canonical = String(app.app_store_id && Number(app.app_store_id) !== 0 ? app.app_store_id : app.id);
  if (key !== canonical) {
    const loc = ctx.url.pathname.replace(`/apps/${encodeURIComponent(key)}`, `/apps/${canonical}`).replace(`/apps/${key}`, `/apps/${canonical}`) + ctx.url.search;
    return {
      response: new Response(null, {
        status: 301,
        headers: { Location: loc, 'Cache-Control': 'public, max-age=3600', ...CORS },
      }),
    };
  }
  return { app };
}

// ---- pagination ------------------------------------------------------------

// Opaque keyset cursor: base64url of a JSON [sort_value, id] tuple. Opacity is
// the point — the encoding can change without breaking clients.
// btoa/atob (not Buffer) — always present in workers. Values are JSON of our
// own sort keys, so the latin1 limitation only bites on non-ASCII sort values;
// encodeURIComponent round-trip covers those.
export function encodeCursor(tuple: unknown[]): string {
  return btoa(encodeURIComponent(JSON.stringify(tuple)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(raw: string | null): unknown[] | null {
  if (!raw) return null;
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const v = JSON.parse(decodeURIComponent(atob(b64)));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// Clamp ?limit= to [1, cap] with a default. Junk → default (not an error — the
// param is advisory).
export function clampLimit(raw: string | null, def: number, cap: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) return def;
  return Math.max(1, Math.min(n, cap));
}

// Build the enveloped list response. `nextCursor` null = end of collection.
// next_url is ready-made so clients never assemble paging themselves.
export function listBody(
  reqUrl: URL,
  data: unknown[],
  total: number | null,
  nextCursor: string | null
): { data: unknown[]; total: number | null; next_url: string | null } {
  let next_url: string | null = null;
  if (nextCursor) {
    const u = new URL(reqUrl);
    u.searchParams.set('cursor', nextCursor);
    // Always the canonical public origin — never echo localhost/preview hosts.
    next_url = `${SITE_ORIGIN}${u.pathname}?${u.searchParams.toString()}`;
  }
  return { data, total, next_url };
}

// 400 for an unknown query param, naming what IS supported — the API's params
// are allowlisted so a typo fails loudly instead of silently returning the
// unfiltered collection.
export function checkParams(url: URL, allowed: string[]): Response | null {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) {
      return fail(400, 'unknown_parameter', `unknown parameter "${key}"`, { supported: allowed });
    }
  }
  return null;
}
