// Period-authentic app icons for list rows and app headers. "Oldest possible"
// icon by default (a first-gen-iPad-era store should look its age), sourced
// from the icon extracted from each app's earliest archived binary rather than
// Apple's current CDN artwork.
//
// binaries has no FK from ipa_files.binary_sha1, so PostgREST can't embed it —
// this resolves in three batched, index-hit queries (versions → files →
// binaries), joined in JS. Never throws: on any error it returns an empty map
// and callers fall back to apps.icon_url.

import { cached } from './cache';
import { compareVersionLike } from './sorting';

export type IconCandidate = {
  version_string: string | null;
  minimum_os_version: string | null;
  bundle_icon_sha256: string | null;   // build-time bundle icon only, never store artwork
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
  const withIcon = candidates.filter((c) => c.bundle_icon_sha256);
  if (!withIcon.length) return null;
  withIcon.sort((a, b) => {
    const ver = compareVersionLike(a.version_string, b.version_string); // oldest first
    if (ver) return ver;
    const anach = Number(anachronistic(a)) - Number(anachronistic(b));
    if (anach) return anach;
    return statusRank(a.install_status) - statusRank(b.install_status);
  });
  return withIcon[0].bundle_icon_sha256 || null;
}

// Map<internal app id → icon sha256 nearest a target date> (charts: a 2015
// chart should show 2015 icons, not each app's oldest). Backed by the
// get_icons_near_date RPC, which picks the icon of the version dated closest
// to the chart date (ties prefer released-on-or-before) and routes it through
// the alias registry to the largest same-design copy. Apps with no datable
// icon-bearing version are absent — callers fall back to the oldest icon.
export async function getIconsNearDate(
  supabase: any,
  appDbIds: number[],
  isoDate: string
): Promise<Map<number, string>> {
  const ids = Array.from(new Set(appDbIds.filter((n) => Number.isFinite(n) && n > 0)));
  const empty = new Map<number, string>();
  if (!ids.length || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return empty;
  const cacheKey = `icons:near:${isoDate}:${[...ids].sort((a, b) => a - b).join(',')}`;
  const { data: out } = await cached<Map<number, string>>(cacheKey, 10 * 60 * 1000, async () => {
    try {
      const { data, error } = await supabase.rpc('get_icons_near_date', {
        p_app_ids: ids,
        p_target: isoDate,
      });
      if (error) return { data: null, error };
      const out = new Map<number, string>();
      for (const r of data || []) if (r.icon_sha256) out.set(Number(r.app_id), r.icon_sha256);
      return { data: out, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  });
  return out || empty;
}

// Map<internal app id → oldest icon sha256> for a set of apps.
export async function getOldestIcons(supabase: any, appDbIds: number[]): Promise<Map<number, string>> {
  const ids = Array.from(new Set(appDbIds.filter((n) => Number.isFinite(n) && n > 0)));
  if (!ids.length) return new Map();
  const cacheKey = `icons:oldest:${[...ids].sort((a, b) => a - b).join(',')}`;
  const { data: hit } = await cached<Map<number, string>>(cacheKey, 10 * 60 * 1000, async () => {
    try {
      // Read the precomputed representative icon (rep_icon_sha256 = the icon
      // identity the app wore longest — its recognizable icon, maintained by
      // refresh_rep_icons()), falling back to the period-authentic oldest
      // (refresh_oldest_icons()). One indexed column read, chunked only to
      // bound the .in() list length.
      const out = new Map<number, string>();
      const CHUNK = 300;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data, error } = await supabase
          .from('apps')
          .select('id, rep_icon_sha256, oldest_icon_sha256')
          .in('id', ids.slice(i, i + CHUNK))
          .or('rep_icon_sha256.not.is.null,oldest_icon_sha256.not.is.null');
        if (error) return { data: null, error };
        for (const a of data || []) {
          const sha = a.rep_icon_sha256 || a.oldest_icon_sha256;
          if (sha) out.set(Number(a.id), sha);
        }
      }
      return { data: out, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  });
  return hit || new Map<number, string>();
}
