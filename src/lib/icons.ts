// Apple's legacy icon CDNs (phobos) are HTTP-only, and their per-shard
// hostnames have no valid HTTPS cert — so an http icon URL breaks as mixed
// content on our HTTPS pages (the browser upgrades it to https, which then
// fails cert validation). Route those through the same-origin /img proxy
// (src/pages/img.ts), which fetches over http server-side and re-serves over
// our own https. Long-term these get rehosted to R2 (content-addressed).

const APPLE_ICON_HOSTS = /(^|\.)(phobos\.apple\.com|mzstatic\.com)$/i;

export function isProxyableIconHost(host: string): boolean {
  return APPLE_ICON_HOSTS.test(host);
}

// Returns a src usable on an HTTPS page: a same-origin /img?u=… proxy URL for
// Apple-CDN icons, a pass-through for already-https hosts, or '' when it can't
// be shown safely (e.g. a non-Apple http URL that would be mixed content).
export function iconSrc(rawUrl: string | null | undefined): string {
  if (!rawUrl) return '';
  let u: URL;
  try { u = new URL(rawUrl); } catch { return ''; }
  if ((u.protocol === 'http:' || u.protocol === 'https:') && isProxyableIconHost(u.hostname)) {
    return `/img?u=${encodeURIComponent(rawUrl)}`;
  }
  return u.protocol === 'https:' ? rawUrl : '';
}

// THE app-icon selection chain, one place: the archive's own content-addressed
// icon when we have one, else the app's live listing icon (era-wrong, last
// resort) via iconSrc. Every list/grid surface uses this — inlining the chain
// per-page is how surfaces drifted apart (see plans/017).
export function appIconSrc(
  sha: string | null | undefined,
  liveUrl: string | null | undefined
): string {
  return sha ? `/icon/${sha}` : iconSrc(liveUrl);
}

// Absolute variant for contexts fetched off-page (e.g. the itms install
// manifest's display-image, which the device loads directly).
export function absoluteIconSrc(rawUrl: string | null | undefined, origin: string): string | null {
  const rel = iconSrc(rawUrl);
  if (!rel) return null;
  return rel.startsWith('/') ? origin + rel : rel;
}
