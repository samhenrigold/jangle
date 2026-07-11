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
    const { data: vers, error: vErr } = await supabase
      .from('app_versions')
      .select('id, app_id, version_string, minimum_os_version')
      .in('app_id', ids)
      .limit(8000);
    if (vErr || !vers?.length) return empty;

    const versionById = new Map<number, any>();
    for (const v of vers) versionById.set(Number(v.id), v);

    const { data: files, error: fErr } = await supabase
      .from('ipa_files')
      .select('app_version_id, binary_sha1')
      .in('app_version_id', Array.from(versionById.keys()))
      .not('binary_sha1', 'is', null)
      .limit(20000);
    if (fErr || !files?.length) return empty;

    const shas = Array.from(new Set(files.map((f: any) => f.binary_sha1).filter(Boolean)));
    const binBySha = new Map<string, any>();
    const CHUNK = 150;
    for (let i = 0; i < shas.length; i += CHUNK) {
      const { data: bins, error: bErr } = await supabase
        .from('binaries')
        .select('sha1, icon_sha256, bundle_icon_sha256, install_status, architectures, has_extensions')
        .in('sha1', shas.slice(i, i + CHUNK))
        // Candidacy is "has ANY extracted icon". The old filter gated on
        // icon_sha256 only, but the candidate below prefers bundle_icon_sha256 —
        // so a binary carrying only the newer bundle icon (icon_sha256 NULL) was
        // silently dropped, leaving apps like Snapchat iconless in every list even
        // though their own page (which doesn't filter) showed the icon fine.
        .or('icon_sha256.not.is.null,bundle_icon_sha256.not.is.null');
      if (bErr) return empty;
      for (const b of bins || []) binBySha.set(b.sha1, b);
    }
    if (!binBySha.size) return empty;

    // Gather icon candidates per app, then pick the oldest.
    const candidatesByApp = new Map<number, IconCandidate[]>();
    for (const f of files) {
      const bin = binBySha.get(f.binary_sha1);
      if (!bin) continue;
      const v = versionById.get(Number(f.app_version_id));
      if (!v) continue;
      const appId = Number(v.app_id);
      const arr = candidatesByApp.get(appId) || [];
      arr.push({
        version_string: v.version_string,
        minimum_os_version: v.minimum_os_version,
        // Prefer the build-time bundle icon (period-accurate); fall back to the
        // legacy icon_sha256 (iTunesArtwork-derived, download-date-stamped).
        icon_sha256: bin.bundle_icon_sha256 || bin.icon_sha256,
        install_status: bin.install_status,
        architectures: bin.architectures,
        has_extensions: bin.has_extensions,
      });
      candidatesByApp.set(appId, arr);
    }

    const out = new Map<number, string>();
    for (const [appId, cands] of candidatesByApp) {
      const sha = pickOldestIcon(cands);
      if (sha) out.set(appId, sha);
    }
    cacheSet(cacheKey, out, 10 * 60 * 1000);
    return out;
  } catch (err) {
    console.error('getOldestIcons failed:', (err as any)?.message);
    return empty;
  }
}
