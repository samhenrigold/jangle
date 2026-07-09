import type { APIRoute } from 'astro';
import { isProxyableIconHost } from '../lib/icons';

// 1x1 transparent GIF — returned when an icon can't be fetched, so old Safari
// shows a blank box instead of a broken-image glyph.
const BLANK_GIF = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0)
);

function blank(status = 200): Response {
  return new Response(BLANK_GIF, {
    status,
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'public, max-age=86400' },
  });
}

// Same-origin HTTPS proxy for Apple's HTTP-only / bad-HTTPS icon CDNs.
// Host-allowlisted so it can't be used as an open proxy.
export const GET: APIRoute = async (ctx) => {
  const raw = new URL(ctx.request.url).searchParams.get('u');
  if (!raw || raw.length > 512) return blank(400);

  let target: URL;
  try { target = new URL(raw); } catch { return blank(400); }
  if ((target.protocol !== 'http:' && target.protocol !== 'https:') || !isProxyableIconHost(target.hostname)) {
    return blank(400);
  }

  try {
    const upstream = await fetch(target.toString(), { headers: { Accept: 'image/*' } });
    if (!upstream.ok) return blank(404);
    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//i.test(ct)) return blank(404);
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': ct,
        // Icons are effectively immutable; cache hard at edge + client.
        'Cache-Control': 'public, max-age=604800, s-maxage=2592000, immutable',
      },
    });
  } catch {
    return blank(404);
  }
};
