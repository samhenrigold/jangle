// Resolve an iOS-6-TLS-compatible archive.org data node for an item's .ipa.
//
// Background: archive.org is migrating item storage onto a newer `dn###` data
// node fleet whose TLS is ECDSA + AES-GCM-only. Vintage clients — notably iOS 6
// `itunesstored`, the whole point of this archive's OTA-install feature — share
// no cipher suite with those nodes (Apple didn't ship AES-GCM until iOS 9) and
// can't validate their all-ECDSA-P384 chain, so the handshake dies before a
// byte moves. The legacy `ia###.us` nodes still offer RSA + ECDHE-RSA-AES-CBC-
// SHA, which iOS 6 speaks. `archive.org/download/…` round-robins across the
// whole mixed fleet, so an OTA install fails whenever it lands on a `dn###`
// node — intermittently, per request, which is exactly the reported symptom.
//
// This resolves a specific *compatible* node from IA's own metadata and returns
// a direct URL to it, so the manifest can hand `itunesstored` a node it can
// actually reach. We are a link, not a proxy: the bytes still flow archive.org
// → device and never transit our infra.
//
// Respectful to IA by construction:
//  - Reads `workable_servers` (IA's own per-item health signal) instead of
//    probing nodes ourselves — zero HEAD/GET liveness traffic against them.
//  - Tiny sub-path metadata queries (`/metadata/<id>/workable_servers`, `/dir`)
//    — never the full item metadata, which for grab-bag items is multi-MB.
//  - One metadata lookup per item per TTL window, cached; repeat installs of an
//    already-resolved item add no IA traffic at all.
//  - Identifying User-Agent + a short timeout; any hiccup falls back to the
//    plain download URL rather than retry-storming.

// IA etiquette asks automated clients to identify themselves with a reachable
// contact. TODO(sam): swap in a mailbox you actually monitor if you'd rather IA
// reach you by email than via the site.
const POLITE_UA =
  'legacystore.app OTA-install node resolver (+https://legacystore.app; preservation archive)';
const META_TIMEOUT_MS = 5000;
// 15m bounds IA metadata load while keeping node health fresh enough that a
// drained node fails over within a reasonable window.
const CACHE_TTL_MS = 15 * 60 * 1000;

type Cached = { url: string | null; at: number };
// Module-scope, best-effort (per-isolate) cache — same pattern as urls.ts. Keyed
// by item+filename; the value is the resolved node URL (or null = no compatible
// node, also cached so dn###-only items don't re-hit metadata every install).
const nodeCache = new Map<string, Cached>();

// ia600508.us.archive.org → legacy node, iOS-6-compatible TLS (RSA + CBC-SHA).
// dn720004.ca.archive.org → modern node, ECDSA/AES-GCM-only, unreachable by iOS 6.
function isLegacyCompatible(host: string): boolean {
  return /^ia\d+\./i.test(host);
}

async function fetchMetaField(item: string, field: string): Promise<unknown> {
  const res = await fetch(
    `https://archive.org/metadata/${encodeURIComponent(item)}/${field}`,
    {
      headers: { 'User-Agent': POLITE_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    }
  );
  if (!res.ok) throw new Error(`metadata ${field} → ${res.status}`);
  const body = (await res.json()) as { result?: unknown };
  return body?.result;
}

/**
 * Direct URL to an iOS-6-reachable node hosting `filename` in `item`, or null if
 * the item has no compatible workable node (e.g. fully migrated to the dn###
 * fleet, or metadata unreachable) — in which case the caller should fall back to
 * the plain archive.org download URL. `spreadKey` (the ipa id) only spreads load
 * deterministically across the item's healthy compatible mirrors.
 */
export async function resolveCompatibleNodeUrl(
  item: string,
  filename: string,
  spreadKey: number
): Promise<string | null> {
  if (!item || !filename) return null;
  const cacheKey = `${item}/${filename}`;
  const hit = nodeCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.url;

  let url: string | null = null;
  try {
    const [workable, dir] = await Promise.all([
      fetchMetaField(item, 'workable_servers'),
      fetchMetaField(item, 'dir'),
    ]);
    const healthy = Array.isArray(workable) ? (workable as string[]) : [];
    const compatible = healthy.filter((h) => typeof h === 'string' && isLegacyCompatible(h));
    if (compatible.length && typeof dir === 'string' && dir) {
      // Spread deterministically across the item's healthy compatible mirrors
      // instead of always hammering d1.
      const host = compatible[Math.abs(spreadKey) % compatible.length];
      // filename may carry an item-relative subdir prefix (e.g. "A/HD 1.2.2.ipa")
      // — encode each path segment but keep the separators.
      const path =
        String(dir).replace(/\/+$/, '') +
        '/' +
        filename.split('/').map(encodeURIComponent).join('/');
      url = `https://${host}${path}`;
    }
  } catch {
    url = null; // any hiccup → caller uses the plain archive.org download URL
  }

  nodeCache.set(cacheKey, { url, at: Date.now() });
  return url;
}
