// Sets shared-cache headers. Browser TTL stays short so users pick up
// fixes; the CDN TTL does the heavy lifting.
export function setCacheHeaders(response: Response | { headers: Headers }, cdnSeconds: number, browserSeconds = 300): void {
  response.headers.set(
    'Cache-Control',
    `public, max-age=${browserSeconds}, s-maxage=${cdnSeconds}`
  );
}
