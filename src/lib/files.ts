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
