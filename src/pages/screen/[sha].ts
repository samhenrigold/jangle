import type { APIRoute } from 'astro';
import { blankGif, serveR2Image } from '../../lib/http';

// Content-addressed archived screenshot master in R2 (screens/<sha>.<ext>),
// recovered by rehost_screens.py from the App Store's dead phobos/mzstatic CDNs.
// Mirrors /icon but reads the screens/ prefix and prefers jpg (screenshots are
// overwhelmingly jpeg masters; png/webp fall back). Same-origin also spares old
// iOS the cross-host TLS handshake.
const R2_SCREEN_BASE = 'https://pub-6cf9918644fd4d31bee31970d321985b.r2.dev/screens';

export const GET: APIRoute = async (ctx) => {
  const sha = ctx.params.sha || '';
  if (!/^[0-9a-f]{64}$/.test(sha)) return blankGif(400, 'public, max-age=86400, s-maxage=86400');
  return serveR2Image(R2_SCREEN_BASE, sha, [
    ['jpg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ]);
};
