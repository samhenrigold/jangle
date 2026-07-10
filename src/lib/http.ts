// HTML responses reference content-hashed CSS/JS assets. A Cloudflare Pages
// deploy replaces those hashed files, so any HTML still cached at the edge from
// a previous deploy points at assets that now 404 — the page renders unstyled
// until its edge entry expires. Capping the edge TTL bounds that post-deploy
// skew window (e.g. categories was s-maxage=86400 → up to 24h of broken pages).
// Raise this only alongside a purge-on-deploy hook.
const MAX_HTML_CDN_SECONDS = 300;

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
