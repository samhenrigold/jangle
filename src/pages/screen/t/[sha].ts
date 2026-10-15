import type { APIRoute } from 'astro';
import { blankGif, serveR2Image } from '../../../lib/http';

// 520px-tall JPEG thumbnail of an archived screenshot (screen_thumbs.py on the
// mini derives screens-h520/<sha>.jpg from the master; recomputable). The app
// page strip shows shots 260px tall, so this is 2x — ~30-100KB vs ~800KB for the
// 2048px master. Falls back to the master if the thumb isn't generated yet.
const R2 = 'https://pub-6cf9918644fd4d31bee31970d321985b.r2.dev';

export const GET: APIRoute = async (ctx) => {
  const sha = ctx.params.sha || '';
  if (!/^[0-9a-f]{64}$/.test(sha)) return blankGif(400, 'public, max-age=86400, s-maxage=86400');
  const t = await serveR2Image(`${R2}/screens-h520`, sha, [['jpg', 'image/jpeg']]);
  if (t.status !== 404) return t;
  return serveR2Image(`${R2}/screens`, sha, [
    ['jpg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ]);
};
