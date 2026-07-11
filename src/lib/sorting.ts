export type SortDir = 'asc' | 'desc';

export function coerceDir(input: any): SortDir {
  const d = String(input || '').toLowerCase();
  return d === 'asc' ? 'asc' : 'desc';
}

function extractNumbers(input: any): number[] {
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

function compareNumArrays(a: number[], b: number[]): number {
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

// A monotonic scalar from a version string ("3.0.1.11" → packs the components),
// so undated versions can be placed by version number. Components clamp at 999.
function versionScalar(s: any): number | null {
  const nums = extractNumbers(s);
  if (!nums.length) return null;
  let scalar = 0;
  for (let i = 0; i < 5; i++) scalar = scalar * 1000 + Math.min(999, nums[i] ?? 0);
  return scalar;
}

// Linear interpolation of a value against (x → e) anchors sorted by x, clamped.
function interpolate(anchors: { x: number; e: number }[], x: number): number {
  if (x <= anchors[0].x) return anchors[0].e;
  const last = anchors[anchors.length - 1];
  if (x >= last.x) return last.e;
  for (let i = 1; i < anchors.length; i++) {
    if (x <= anchors[i].x) {
      const lo = anchors[i - 1], hi = anchors[i];
      const t = hi.x === lo.x ? 0 : (x - lo.x) / (hi.x - lo.x);
      return lo.e + t * (hi.e - lo.e);
    }
  }
  return last.e;
}

// Chronological ordering key per version. A version's known date (via dateOf —
// estimated_release_date, or a trustworthy release_date supplied by the caller)
// anchors it directly. Versions missing a date are placed by interpolating
// against the dated versions — first by Apple's monotonic external_identifier,
// then by version number — so nothing that has *any* ordering signal falls to
// the bottom. Versions with no date, no ext id, and no version number get no key.
export function buildChronoKeys<T extends Record<string, any>>(
  list: T[],
  dateOf?: (v: T) => string | null | undefined
): Map<T, number> {
  const dateFn = dateOf || ((v: any) => v?.estimated_release_date);
  const keys = new Map<T, number>();
  const extAnchors: { x: number; e: number }[] = [];
  const verAnchors: { x: number; e: number }[] = [];
  for (const v of list || []) {
    const e = epochOf(dateFn(v));
    if (e == null) continue;
    keys.set(v, e);
    const x = v?.external_identifier == null ? null : Number(v.external_identifier);
    if (x != null && Number.isFinite(x)) extAnchors.push({ x, e });
    const vs = versionScalar(v?.version_string);
    if (vs != null) verAnchors.push({ x: vs, e });
  }
  if (!keys.size) return keys;
  extAnchors.sort((a, b) => a.x - b.x);
  verAnchors.sort((a, b) => a.x - b.x);
  for (const v of list || []) {
    if (keys.has(v)) continue;
    const x = v?.external_identifier == null ? null : Number(v.external_identifier);
    if (x != null && Number.isFinite(x) && extAnchors.length) { keys.set(v, interpolate(extAnchors, x)); continue; }
    const vs = versionScalar(v?.version_string);
    if (vs != null && verAnchors.length) { keys.set(v, interpolate(verAnchors, vs)); continue; }
  }
  return keys;
}

// Chronological sort of an app's versions (the only ordering the site offers;
// only the direction toggles). Keys are precomputed over the whole list.
export function sortVersions<T extends Record<string, any>>(
  list: T[],
  dir: SortDir,
  dateOf?: (v: T) => string | null | undefined
): T[] {
  const dirMult = dir === 'asc' ? 1 : -1;
  const chrono = buildChronoKeys(list || [], dateOf);
  const cmp = (a: T, b: T) => {
    const ka = chrono.get(a);
    const kb = chrono.get(b);
    // Undated versions sort last regardless of direction (undo the dir flip).
    if (ka == null && kb == null) return dirMult * (compareVersionLike(a?.version_string, b?.version_string) || tieBreakByIdDesc(a, b));
    if (ka == null) return dirMult * 1;
    if (kb == null) return dirMult * -1;
    if (ka !== kb) return ka - kb;
    return compareVersionLike(a?.version_string, b?.version_string) || tieBreakByIdDesc(a, b);
  };
  return [...(list || [])].sort((a, b) => dirMult * cmp(a, b));
}
