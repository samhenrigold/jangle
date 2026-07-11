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

// Sets shared-cache headers. Browser TTL stays short so users pick up
// fixes; the CDN TTL does the heavy lifting (bounded by MAX_HTML_CDN_SECONDS).
export function setCacheHeaders(response: Response | { headers: Headers }, cdnSeconds: number, browserSeconds = 300): void {
  const cdn = Math.min(cdnSeconds, MAX_HTML_CDN_SECONDS);
  response.headers.set(
    'Cache-Control',
    `public, max-age=${browserSeconds}, s-maxage=${cdn}`
  );
}

// Marks a degraded response (transient DB failure) as uncacheable and 503, so
// the edge never pins an empty page for the full TTL. Overrides any
// Cache-Control set earlier in the request.
export function setDegraded(response: { headers: Headers; status?: number }): void {
  response.headers.set('Cache-Control', 'no-store');
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
