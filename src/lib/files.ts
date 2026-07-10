export function baseName(path: unknown): string {
  return String(path || '').split('/').pop() || '';
}

// Crawl-artifact filenames look like
//   "Angry Birds-(com.chillingo.angrybirdsipad)-1.2.2-(iOS_3.2)-<md5>.ipa"
// — reduce to "Angry Birds 1.2.2 (iOS 3.2)". Anything else displays as its
// basename (some rows carry directory prefixes like "A/HD 1.2.2.ipa").
const CRAWL_PATTERN = /^(.+)-\((.+)\)-(.+)-\((iOS[_ ][\d.]+)\)-[0-9a-f]{32}\.ipa$/i;

export function fileLabel(filename: unknown): string {
  const b = baseName(filename);
  const m = b.match(CRAWL_PATTERN);
  if (m) return `${m[1]} ${m[3]} (${m[4].replace('_', ' ')})`;
  return b;
}

export interface FileGroup {
  file: any;
  copies: number;
}

const INSTALL_RANK: Record<string, number> = { installable: 0, unknown: 1, encrypted: 2 };

// A binary that is arm64-only or carries app extensions cannot predate iOS 7/8;
// on a version row that claims to require iOS < 7 it's a modern repack
// mislabeled as an old release. (Icon-swapped-but-genuine old binaries are
// undetectable until the backend extracts CFBundleShortVersionString from the
// hoarded plists.)
function isAnachronistic(bin: any, versionMinOs: unknown): boolean {
  if (!bin) return false;
  const major = parseInt(String(versionMinOs || '').split('.')[0], 10);
  if (!Number.isFinite(major) || major <= 0 || major >= 7) return false;
  const archs: string[] = bin.architectures || [];
  const arm64Only = archs.length > 0 && archs.every((a) => a === 'arm64');
  return arm64Only || bin.has_extensions === true;
}

// Order a version's file groups best-first: copies that actually launch, then
// era-plausible over anachronistic repacks, then store-original rips (iTunes
// metadata) over cracks, then the cleanest filename. groups[0] is "the best
// known copy" the page offers by default.
export function sortGroupsByPreference(
  groups: FileGroup[],
  binaryOf: (f: any) => any,
  versionMinOs: unknown
): FileGroup[] {
  return [...groups].sort((a, b) => {
    const ba = binaryOf(a.file);
    const bb = binaryOf(b.file);
    const anach = Number(isAnachronistic(ba, versionMinOs)) - Number(isAnachronistic(bb, versionMinOs));
    if (anach) return anach;
    const rank = (INSTALL_RANK[ba?.install_status] ?? 1) - (INSTALL_RANK[bb?.install_status] ?? 1);
    if (rank) return rank;
    if (!!b.file.has_itunes_metadata !== !!a.file.has_itunes_metadata) {
      return (b.file.has_itunes_metadata ? 1 : 0) - (a.file.has_itunes_metadata ? 1 : 0);
    }
    return baseName(a.file.filename).length - baseName(b.file.filename).length;
  });
}

// Same md5 = byte-identical file mirrored under different names; one
// Install/Download button per distinct hash is enough. Within a group prefer
// the copy that has iTunes metadata (richer manifest), then the cleanest
// (shortest basename) filename for display.
export function dedupeFilesByHash(files: any[]): FileGroup[] {
  const groups = new Map<string, any[]>();
  for (const f of files || []) {
    const key = f?.md5_hash || `id:${f?.id}`;
    const arr = groups.get(key) || [];
    arr.push(f);
    groups.set(key, arr);
  }
  const out: FileGroup[] = [];
  for (const arr of groups.values()) {
    arr.sort((a: any, b: any) => {
      if (!!b.has_itunes_metadata !== !!a.has_itunes_metadata) {
        return (b.has_itunes_metadata ? 1 : 0) - (a.has_itunes_metadata ? 1 : 0);
      }
      return baseName(a.filename).length - baseName(b.filename).length;
    });
    out.push({ file: arr[0], copies: arr.length });
  }
  return out;
}
