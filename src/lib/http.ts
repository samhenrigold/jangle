// The public origin — canonical links and the sitemap must not echo whatever
// host the request came in on (previews, localhost).
export const SITE_ORIGIN = 'https://legacystore.app';

// HTML responses reference content-hashed CSS/JS assets. A Cloudflare Pages
// deploy replaces those hashed files, so any HTML still cached at the edge from
// a previous deploy points at assets that now 404 — the page renders unstyled
// until its edge entry expires. Capping the edge TTL bounds that post-deploy
// skew window; the cap and a purge-on-deploy hook are two halves of one knob.
//
// At 300s every page's requested TTL (600/3600/86400) was flattened to 5 min,
// so expensive RPC-backed pages re-ran ~12×/hr per PoP under bot crawl. Raised
// to 1h: the worst-case post-deploy skew becomes ≤1h (acceptable for the
// pre-launch beta with infrequent manual deploys), and per-page TTLs below 1h
// (e.g. search at 600) are now honored as authored rather than clamped.
//
// To lift this to 86400 (categories/stats/colophon are genuinely daily) without
// any skew risk, purge the edge cache on deploy, e.g. in the deploy step:
//   curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/purge_cache" \
//     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
//     --data '{"purge_everything":true}'
const MAX_HTML_CDN_SECONDS = 3600;

// How long a stale (expired) copy may still be served.
//   • stale-while-revalidate covers the normal refresh gap: the edge returns the
//     expired copy instantly and revalidates in the background, so no visitor
//     ever blocks on a slow RPC render.
//   • stale-if-error covers origin failure: if a re-render throws, times out, or
//     503s (see setDegraded), the edge keeps serving the last good copy for up to
//     a week instead of showing an error — the right default for a preservation
//     archive, and the reason the launch-day origin blips were invisible to users.
// Both directives are DISABLED at a shared cache by s-maxage / must-revalidate /
// proxy-revalidate (RFC 9111 §4.2.4), so the edge TTL below must be expressed as
// max-age. We keep a *short* browser TTL and a *long* edge TTL by putting them on
// separate headers (Cloudflare-CDN-Cache-Control is edge-only and stripped before
// the response reaches the browser) rather than the old s-maxage split.
const STALE_WHILE_REVALIDATE = 86400; // 1 day
const STALE_IF_ERROR = 604800; // 7 days

// Sets shared-cache headers. Browser TTL stays short (so users pick up fixes and
// never hold HTML pointing at rotated content-hashed assets); the edge TTL does
// the heavy lifting (bounded by MAX_HTML_CDN_SECONDS). Both layers carry the
// stale-serve cushions above.
export function setCacheHeaders(response: Response | { headers: Headers }, cdnSeconds: number, browserSeconds = 300): void {
  const cdn = Math.min(cdnSeconds, MAX_HTML_CDN_SECONDS);
  const stale = `stale-while-revalidate=${STALE_WHILE_REVALIDATE}, stale-if-error=${STALE_IF_ERROR}`;
  response.headers.set('Cache-Control', `public, max-age=${browserSeconds}, ${stale}`);
  response.headers.set('Cloudflare-CDN-Cache-Control', `public, max-age=${cdn}, ${stale}`);
}

// Marks a degraded response (transient DB failure) as uncacheable and 503. The
// 503 itself is never pinned (no-store on BOTH the browser and the edge header),
// and because it's a 5xx returned while revalidating an expired entry, the edge
// serves the last good copy via that copy's stale-if-error instead of showing the
// error — the whole point of dropping s-maxage above. Overrides any cache headers
// set earlier in the request.
export function setDegraded(response: { headers: Headers; status?: number }): void {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  response.status = 503;
}

// 1x1 transparent GIF — the image endpoints (/img, /icon) return it on any
// miss so old Safari shows a blank box instead of a broken-image glyph.
const BLANK_GIF = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0)
);

export function blankGif(status: number, cacheControl: string): Response {
  return new Response(BLANK_GIF, {
    status,
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': cacheControl },
  });
}
