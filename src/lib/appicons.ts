// Period-authentic app icons for list rows and app headers. "Oldest possible"
// icon by default (a first-gen-iPad-era store should look its age), sourced
// from the icon extracted from each app's earliest archived binary rather than
// Apple's current CDN artwork.
//
// binaries has no FK from ipa_files.binary_sha1, so PostgREST can't embed it —
// this resolves in three batched, index-hit queries (versions → files →
// binaries), joined in JS. Never throws: on any error it returns an empty map
// and callers fall back to apps.icon_url.

import { cacheGet, cacheSet } from './cache';
import { compareVersionLike } from './sorting';

export type IconCandidate = {
  version_string: string | null;
  minimum_os_version: string | null;
  icon_sha256: string | null;
  install_status?: string | null;
  architectures?: string[] | null;
  has_extensions?: boolean | null;
};

// A binary that is arm64-only or ships app extensions can't predate iOS 7/8;
// on a version row claiming iOS < 7 it's a later repack whose icon isn't
// period-authentic, so it loses ties.
function anachronistic(c: IconCandidate): boolean {
  const major = parseInt(String(c.minimum_os_version || '').split('.')[0], 10);
  if (!Number.isFinite(major) || major <= 0 || major >= 7) return false;
  const archs = c.architectures || [];
  const arm64Only = archs.length > 0 && archs.every((a) => a === 'arm64');
  return arm64Only || c.has_extensions === true;
}

// installable/encrypted are store-shaped; unknown means we couldn't parse the
// binary and the file is likelier to be a cracked/repacked oddity.
const STATUS_RANK: Record<string, number> = { installable: 0, encrypted: 0, unknown: 1 };
const statusRank = (s: unknown) => STATUS_RANK[String(s ?? 'unknown')] ?? 1;

// The oldest version that carries an icon, and within it the least
// anachronistic, most store-shaped copy.
export function pickOldestIcon(candidates: IconCandidate[]): string | null {
  const withIcon = candidates.filter((c) => c.icon_sha256);
  if (!withIcon.length) return null;
  withIcon.sort((a, b) => {
    const ver = compareVersionLike(a.version_string, b.version_string); // oldest first
    if (ver) return ver;
    const anach = Number(anachronistic(a)) - Number(anachronistic(b));
    if (anach) return anach;
    return statusRank(a.install_status) - statusRank(b.install_status);
  });
  return withIcon[0].icon_sha256 || null;
}

// Map<internal app id → oldest icon sha256> for a set of apps.
export async function getOldestIcons(supabase: any, appDbIds: number[]): Promise<Map<number, string>> {
  const ids = Array.from(new Set(appDbIds.filter((n) => Number.isFinite(n) && n > 0)));
  if (!ids.length) return new Map();
  const cacheKey = `icons:oldest:${[...ids].sort((a, b) => a - b).join(',')}`;
  const cached = cacheGet<Map<number, string>>(cacheKey);
  if (cached) return cached;

  const empty = new Map<number, string>();
  try {
    // Read the precomputed apps.oldest_icon_sha256 (maintained by the
    // refresh_oldest_icons() pg_cron job — the SQL port of pickOldestIcon below).
    // This replaced a per-request 3-query fan-out (versions → files → binaries)
    // that also had to page past PostgREST's 1000-row cap; now it's one indexed
    // column read, chunked only to bound the .in() list length.
    const out = new Map<number, string>();
    const CHUNK = 300;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase
        .from('apps')
        .select('id, oldest_icon_sha256')
        .in('id', ids.slice(i, i + CHUNK))
        .not('oldest_icon_sha256', 'is', null);
      if (error) return empty;
      for (const a of data || []) out.set(Number(a.id), a.oldest_icon_sha256);
    }
    cacheSet(cacheKey, out, 10 * 60 * 1000);
    return out;
  } catch (err) {
    console.error('getOldestIcons failed:', (err as any)?.message);
    return empty;
  }
}
