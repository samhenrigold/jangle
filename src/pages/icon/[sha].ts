import type { APIRoute } from 'astro';

// binaries.icon_sha256 → content-addressed icon in the public R2 bucket. The
// object extension varies (.jpg or .png, not recorded in the DB), so this
// route probes both and streams the first hit. Same-origin also spares old
// iOS the cross-host TLS handshake.
const R2_ICON_BASE = 'https://pub-6cf9918644fd4d31bee31970d321985b.r2.dev/icons';

// 1x1 transparent GIF for misses — blank box instead of a broken-image glyph.
const BLANK_GIF = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0)
);

function blank(status = 404): Response {
  return new Response(BLANK_GIF, {
    status,
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'public, max-age=86400' },
  });
}

export const GET: APIRoute = async (ctx) => {
  const sha = ctx.params.sha || '';
  if (!/^[0-9a-f]{64}$/.test(sha)) return blank(400);

  for (const ext of ['jpg', 'png']) {
    try {
      const upstream = await fetch(`${R2_ICON_BASE}/${sha}.${ext}`, { headers: { Accept: 'image/*' } });
      if (!upstream.ok) continue;
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': ext === 'png' ? 'image/png' : 'image/jpeg',
          // Content-addressed → truly immutable; cache as hard as possible.
          'Cache-Control': 'public, max-age=604800, s-maxage=31536000, immutable',
        },
      });
    } catch {
      // try the next extension
    }
  }
  return blank(404);
};
