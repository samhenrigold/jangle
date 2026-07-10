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

export function sortVersions<T extends Record<string, any>>(list: T[], sortKey: SortKey, dir: SortDir): T[] {
  const dirMult = dir === 'asc' ? 1 : -1;

  const cmpMap: Record<SortKey, (a: T, b: T) => number> = {
    date: (a, b) => {
      const at = timeOf(a?.release_date);
      const bt = timeOf(b?.release_date);
      if (at === undefined && bt === undefined) return tieBreakByIdDesc(a, b);
      if (at === undefined) return 1;
      if (bt === undefined) return -1;
      return at - bt;
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