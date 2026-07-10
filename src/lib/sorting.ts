export type SortKey = 'date' | 'version' | 'build' | 'ios' | 'id';
export type SortDir = 'asc' | 'desc';

export function coerceSortKey(input: any): SortKey {
  const s = String(input || '').toLowerCase();
  // Default to semantic version, NOT build: build numbers are non-monotonic
  // across an app's history (e.g. Netflix v9.55.0=build 1812 but v7.2.5=build
  // 3005564), so a build-desc default sinks the newest versions to the bottom.
  return (s === 'date' || s === 'version' || s === 'build' || s === 'ios' || s === 'id') ? s : 'version';
}

export function coerceDir(input: any): SortDir {
  const d = String(input || '').toLowerCase();
  return d === 'asc' ? 'asc' : 'desc';
}

export function defaultDirForSort(sortKey: SortKey): SortDir {
  // Reasonable defaults. Most lists show newest/highest first.
  return 'desc';
}

export function extractNumbers(input: any): number[] {
  if (typeof input !== 'string') return [];
  const matches = input.match(/\d+/g);
  if (!matches) return [];
  const nums: number[] = [];
  for (const m of matches) {
    const n = parseInt(m, 10);
    if (Number.isFinite(n)) nums.push(n);
  }
  return nums;
}

export function compareNumArrays(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

export function compareVersionLike(a: any, b: any): number {
  const an = extractNumbers(a);
  const bn = extractNumbers(b);
  if (an.length === 0 && bn.length === 0) return 0;
  if (an.length === 0) return 1; // empty/null last
  if (bn.length === 0) return -1;
  return compareNumArrays(an, bn);
}

export function timeOf(d: any): number | undefined {
  if (!d || typeof d !== 'string') return undefined;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : undefined;
}

function tieBreakByIdDesc(a: any, b: any): number {
  const aid = typeof a?.id === 'number' ? a.id : 0;
  const bid = typeof b?.id === 'number' ? b.id : 0;
  return bid - aid;
}

function epochOf(d: any): number | null {
  if (!d || typeof d !== 'string') return null;
  const t = Date.parse(d.length <= 10 ? `${d}T00:00:00Z` : d);
  return Number.isFinite(t) ? t : null;
}

// Chronological ordering key per version. release_date is unreliable (bulk-import
// + scrape-date artifacts), so we ignore it: estimated_release_date and Apple's
// globally-monotonic external_identifier are the trustworthy, mutually-agreeing
// signals. Key = the version's est date where known; where it's missing but an
// external_identifier exists, interpolate a date from the (ext_id → est_date)
// anchors in the same list. Versions with neither signal get no key (sorted last).
export function buildChronoKeys<T extends Record<string, any>>(list: T[]): Map<T, number> {
  const keys = new Map<T, number>();
  const anchors: { x: number; e: number }[] = [];
  for (const v of list || []) {
    const e = epochOf(v?.estimated_release_date);
    const x = v?.external_identifier == null ? null : Number(v.external_identifier);
    if (e != null) {
      keys.set(v, e);
      if (x != null && Number.isFinite(x)) anchors.push({ x, e });
    }
  }
  if (!keys.size) return keys;
  anchors.sort((a, b) => a.x - b.x);
  if (anchors.length) {
    for (const v of list || []) {
      if (keys.has(v)) continue;
      const x = v?.external_identifier == null ? null : Number(v.external_identifier);
      if (x == null || !Number.isFinite(x)) continue;
      // Linear interpolation between the bracketing ext_id anchors (clamped).
      if (x <= anchors[0].x) { keys.set(v, anchors[0].e); continue; }
      if (x >= anchors[anchors.length - 1].x) { keys.set(v, anchors[anchors.length - 1].e); continue; }
      for (let i = 1; i < anchors.length; i++) {
        if (x <= anchors[i].x) {
          const lo = anchors[i - 1], hi = anchors[i];
          const t = hi.x === lo.x ? 0 : (x - lo.x) / (hi.x - lo.x);
          keys.set(v, lo.e + t * (hi.e - lo.e));
          break;
        }
      }
    }
  }
  return keys;
}

export function sortVersions<T extends Record<string, any>>(list: T[], sortKey: SortKey, dir: SortDir): T[] {
  const dirMult = dir === 'asc' ? 1 : -1;
  // 'date' is a true chronological sort; keys are precomputed over the whole list.
  const chrono = sortKey === 'date' ? buildChronoKeys(list) : null;

  const cmpMap: Record<SortKey, (a: T, b: T) => number> = {
    date: (a, b) => {
      const ka = chrono!.get(a);
      const kb = chrono!.get(b);
      // Undated versions sort last regardless of direction (undo the dir flip).
      if (ka == null && kb == null) return dirMult * (compareVersionLike(a?.version_string, b?.version_string) || tieBreakByIdDesc(a, b));
      if (ka == null) return dirMult * 1;
      if (kb == null) return dirMult * -1;
      if (ka !== kb) return ka - kb;
      return compareVersionLike(a?.version_string, b?.version_string) || tieBreakByIdDesc(a, b);
    },
    version: (a, b) => {
      const c = compareVersionLike(a?.version_string, b?.version_string);
      return c !== 0 ? c : tieBreakByIdDesc(a, b);
    },
    build: (a, b) => {
      const c = compareVersionLike(a?.build_number, b?.build_number);
      return c !== 0 ? c : tieBreakByIdDesc(a, b);
    },
    ios: (a, b) => {
      const c = compareVersionLike(a?.minimum_os_version, b?.minimum_os_version);
      return c !== 0 ? c : tieBreakByIdDesc(a, b);
    },
    id: (a, b) => {
      const aid = typeof a?.id === 'number' ? a.id : 0;
      const bid = typeof b?.id === 'number' ? b.id : 0;
      return aid - bid;
    }
  };

  const baseCmp = cmpMap[sortKey] || cmpMap.date;
  return [...(list || [])].sort((a, b) => dirMult * baseCmp(a, b));
}

export function parseIOSVersionFromUA(ua: string | null | undefined): { isIOS: boolean; versionNumbers: number[] } {
  const u = ua || '';
  const hasIOSDevice = /(iPhone|iPad|iPod)/i.test(u);
  if (!hasIOSDevice) return { isIOS: false, versionNumbers: [] };

  // Common patterns: "CPU iPhone OS 16_2 like Mac OS X", "CPU OS 14_7_1 like Mac OS X"
  const m = u.match(/OS\s(\d+)[_.](\d+)(?:[_.](\d+))?/i) || u.match(/iPhone OS\s(\d+)[_.](\d+)(?:[_.](\d+))?/i);
  if (!m) return { isIOS: true, versionNumbers: [] };
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2] || '0', 10);
  const patch = parseInt(m[3] || '0', 10);
  const nums = [major, minor, patch].filter((n) => Number.isFinite(n));
  return { isIOS: true, versionNumbers: nums };
}

export function isMinimumOSSupported(minimumOS: any, deviceVersionNumbers: number[]): boolean {
  if (!deviceVersionNumbers || deviceVersionNumbers.length === 0) return true; // if unknown device version, don't hide
  const minNums = extractNumbers(minimumOS);
  if (minNums.length === 0) return true; // if unknown min, don't hide
  return compareNumArrays(minNums, deviceVersionNumbers) <= 0; // min <= device
}