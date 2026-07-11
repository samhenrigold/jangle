import type { APIRoute } from 'astro';
import { isProxyableIconHost } from '../lib/icons';
import { blankGif } from '../lib/http';

// Pin the negative result at the edge too (s-maxage), not just the browser.
// The miss path does up to N upstream fetches; without an edge-cached blank,
// a crawler hitting many distinct unresolvable ?u= URLs re-pays that cost on
// every request — the shape of the earlier free-tier-exhaustion incident.
const blank = (status: number) => blankGif(status, 'public, max-age=86400, s-maxage=86400');

// "mzstatic resurrection" (from plan 010): Apple rarely deletes the underlying
// image even when an old derivative URL 404s. Old-style pool derivatives
//   <host>/us/rNN[/NNN]/<Pool>/xx/yy/zz/mzl.<hash>.<W>x<H>-<Q>.<ext>
// recover from the live thumb service by dropping the host, the /us/rNN/ prefix,
// the 3-digit shard, and the derivative suffix, then asking for a fresh size.
// Originals are usually .png but not always, so try a few extensions.
const POOL_PATH = /\/us\/r\d+\/(?:\d{3}\/)?(.+)\/([^/]+?)(?:\.\d+x\d+(?:-\d+)?)?\.(?:jpg|jpeg|png|tif)$/i;

function resurrectionUrls(target: URL): string[] {
  const m = POOL_PATH.exec(target.pathname);
  if (!m) return [];
  const [, poolDir, base] = m;
  // 512x512 covers our largest icon slot (57px @2x) with headroom.
  // Cap the fan-out at the two extensions that actually resolve in practice
  // (png originals, jpg fallback) — each extra tried extension is another
  // upstream subrequest paid on every miss before we give up.
  return ['png', 'jpg'].map(
    (ext) => `https://is1-ssl.mzstatic.com/image/thumb/${poolDir}/${base}.${ext}/512x512bb.jpg`
  );
}

async function fetchImage(url: string): Promise<Response | null> {
  try {
    const upstream = await fetch(url, { headers: { Accept: 'image/*' } });
    if (!upstream.ok) return null;
    const ct = upstream.headers.get('content-type') || '';
    // The thumb service answers misses with 200-ish JSON ("Nothing found for
    // token …"), so an image content-type is the real success signal.
    if (!/^image\//i.test(ct)) return null;
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': ct,
        // Icons/artwork are effectively immutable; cache hard at edge + client.
        'Cache-Control': 'public, max-age=604800, s-maxage=2592000, immutable',
      },
    });
  } catch {
    return null;
  }
}

// Same-origin HTTPS proxy for Apple's HTTP-only / bad-HTTPS icon+artwork CDNs.
// Host-allowlisted so it can't be used as an open proxy.
export const GET: APIRoute = async (ctx) => {
  const raw = new URL(ctx.request.url).searchParams.get('u');
  if (!raw || raw.length > 512) return blank(400);

  let target: URL;
  try { target = new URL(raw); } catch { return blank(400); }
  if ((target.protocol !== 'http:' && target.protocol !== 'https:') || !isProxyableIconHost(target.hostname)) {
    return blank(400);
  }

  // 1) Try the URL as given (swapping to https on the mzstatic host it maps to).
  const direct = await fetchImage(target.toString());
  if (direct) return direct;

  // 2) Old derivative that 404'd — try to recover the original from the live
  //    thumb service (dead Wayback URLs frequently resurrect this way).
  for (const url of resurrectionUrls(target)) {
    const recovered = await fetchImage(url);
    if (recovered) return recovered;
  }

  return blank(404);
};
