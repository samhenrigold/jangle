// Sets shared-cache headers. Browser TTL stays short so users pick up
// fixes; the CDN TTL does the heavy lifting.
export function setCacheHeaders(response: Response | { headers: Headers }, cdnSeconds: number, browserSeconds = 300): void {
  response.headers.set(
    'Cache-Control',
    `public, max-age=${browserSeconds}, s-maxage=${cdnSeconds}`
  );
}

// Marks a degraded response (transient DB failure) as uncacheable and 503, so
// the edge never pins an empty page for the full TTL. Overrides any
// Cache-Control set earlier in the request.
export function setDegraded(response: { headers: Headers; status?: number }): void {
  response.headers.set('Cache-Control', 'no-store');
  response.status = 503;
}
