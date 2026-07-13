import type { APIRoute } from 'astro';
import { blankGif } from '../../lib/http';

// Content-addressed archived screenshot master in R2 (screens/<sha>.<ext>),
// recovered by rehost_screens.py from the App Store's dead phobos/mzstatic CDNs.
// Mirrors /icon but reads the screens/ prefix and prefers jpg (screenshots are
// overwhelmingly jpeg masters; png/webp fall back). Same-origin also spares old
// iOS the cross-host TLS handshake.
const R2_SCREEN_BASE = 'https://pub-6cf9918644fd4d31bee31970d321985b.r2.dev/screens';

const blank = (status: number) => blankGif(status, 'public, max-age=86400, s-maxage=86400');

export const GET: APIRoute = async (ctx) => {
  const sha = ctx.params.sha || '';
  if (!/^[0-9a-f]{64}$/.test(sha)) return blank(400);

  for (const [ext, ct] of [['jpg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']] as const) {
    try {
      const upstream = await fetch(`${R2_SCREEN_BASE}/${sha}.${ext}`, { headers: { Accept: 'image/*' } });
      if (!upstream.ok) continue;
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': ct,
          // Content-addressed → truly immutable; cache as hard as possible.
          'Cache-Control': 'public, max-age=604800, s-maxage=31536000, immutable',
        },
      });
    } catch { /* try next ext */ }
  }
  return blank(404);
};
