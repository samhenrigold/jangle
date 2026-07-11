import type { APIRoute } from 'astro';
import { blankGif } from '../../lib/http';

// binaries.icon_sha256 → content-addressed icon in the public R2 bucket. The
// object extension varies (.jpg or .png, not recorded in the DB), so this
// route probes both and streams the first hit. Same-origin also spares old
// iOS the cross-host TLS handshake.
const R2_ICON_BASE = 'https://pub-6cf9918644fd4d31bee31970d321985b.r2.dev/icons';

// s-maxage pins misses at the edge too — a miss costs two R2 probes, and a
// backfill-gap sha referenced from a popular page would otherwise re-pay that
// on every request (the /img free-tier-exhaustion shape).
const blank = (status: number) => blankGif(status, 'public, max-age=86400, s-maxage=86400');

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
    }
  }
  return blank(404);
};
