// Pure data-shaping for the app detail page (and the public API): transforms
// only — no Astro, no supabase. Inputs (versions, ipa_files rows, binaries map,
// chart/rating history) come in explicitly; comments carry the institutional
// knowledge they were written with.
import { sortVersions } from './sorting';
import { generateIpaDownloadUrl } from './urls';
import { formatDate, formatFileSize } from './format';
import { fileLabel, dedupeFilesByHash, sortGroupsByPreference } from './files';
import { deviceOf, sampleEvenly } from './timemachine';
import { osRequirementLabel, retinaLabel } from './devices';

// Cap on copies rendered inline (hidden) for the client-side "Show everything"
// reveal. Average copies/version is ~1.4, but a handful of versions have
// hundreds — rendering those all into the DOM would bloat the page, so the
// overflow only renders on the ?all=1 server navigation.
export const INLINE_COPY_CAP = 12;

// Fold raw chart rows into one group per (chart type, device, genre): peak,
// span, and a chronological trajectory for the sparkline.
export function foldChartGroups(chartHistory: any[]): any[] {
  const groups = new Map<string, any>();
  for (const row of chartHistory) {
    const snap = row.chart_snapshots;
    if (!snap) continue;
    const device = deviceOf(snap.source_url || '');
    const genreId = snap.genre_id == null ? null : Number(snap.genre_id);
    const typeId = Number(snap.chart_type_id);
    const key = `${typeId}:${device}:${genreId ?? 'all'}`;
    let g = groups.get(key);
    if (!g) {
      g = { typeId, device, genreId, points: [] };
      groups.set(key, g);
    }
    g.points.push({
      date: snap.snapshot_date,
      position: Number(row.position),
    });
  }
  for (const g of groups.values()) {
    // One point per date (duplicate captures of the same feed) — best rank wins.
    g.points.sort((a: any, b: any) => a.date.localeCompare(b.date) || a.position - b.position);
    const byDate = new Map<string, any>();
    for (const p of g.points) if (!byDate.has(p.date)) byDate.set(p.date, p);
    g.points = Array.from(byDate.values());
    g.peak = Math.min(...g.points.map((p: any) => p.position));
    g.peakDate = g.points.find((p: any) => p.position === g.peak)?.date;
    g.first = g.points[0].date;
    g.last = g.points[g.points.length - 1].date;
  }
  return Array.from(groups.values()).sort(
    (a, b) => Number(a.genreId != null) - Number(b.genreId != null) || b.points.length - a.points.length || a.peak - b.peak
  );
}

// The listing snapshots mix storefronts and rating bases: a US all-versions
// total (millions) sits next to a small non-US storefront capture or an
// Apple "this version only" count (thousands), so a raw plot whiplashes between
// them. An app's all-versions total only grows over time, so we keep a
// monotonic envelope — drop any capture whose count falls well below the
// highest established level (those are the non-US / current-version outliers),
// while still allowing the count to climb.
export function ratingRowsOf(ratingHistory: any[]): any[] {
  let ratingMax = 0;
  const ratingEnvelope = (ratingHistory || []).filter((r: any) => {
    const c = Number(r.rating_count);
    if (!Number.isFinite(c) || c <= 0) return r.rating_count == null; // keep count-less avg points
    if (ratingMax > 0 && c < ratingMax * 0.5) return false;          // storefront/current-version dip
    if (c > ratingMax) ratingMax = c;
    return true;
  });
  // Rating snapshots arrive in bursts (several captures of the same listing
  // state) — collapse identical consecutive states, then thin to a readable table.
  return sampleEvenly(
    ratingEnvelope.filter((r: any, i: number) => {
      if (i === 0) return true;
      const prev = ratingEnvelope[i - 1];
      return !(r.version === prev.version && r.rating_count === prev.rating_count && r.rating_avg === prev.rating_avg);
    }),
    15
  );
}

// Dead archive.org copies (available=false) never render a button; a version
// whose every copy is dead says so instead of "no file".
// Quarantined copies (re-signed/tweak-injected/wrapper repackages that reuse a
// real bundle id — see the Colophon's "What belongs in the archive") are
// dropped outright via binaries.hidden (a DB-generated column, the single
// definition of the quarantine set): editorial suppression, so unlike
// encrypted-only versions they do NOT come back under "Show everything".
// Unclassified binaries (hidden=false) pass; a hidden binary is recoverable by
// reclassifying to 'clean', which un-hides it everywhere at once.
export function partitionCopies(ipaFiles: any[], binariesBySha1: Map<string, any>) {
  const filesByVersionId = new Map<number, any[]>();
  const unavailableCountByVersion = new Map<number, number>();
  for (const f of ipaFiles) {
    if (f.available === false) {
      unavailableCountByVersion.set(f.app_version_id, (unavailableCountByVersion.get(f.app_version_id) || 0) + 1);
      continue;
    }
    if (f.binary_sha1 && binariesBySha1.get(f.binary_sha1)?.hidden) continue;
    const arr = filesByVersionId.get(f.app_version_id) || [];
    arr.push(f);
    filesByVersionId.set(f.app_version_id, arr);
  }
  return { filesByVersionId, unavailableCountByVersion };
}

// The consensus icon for a version: group its copies' icons by perceptual
// cluster (icon_aliases canonical) and take the cluster the most copies agree
// on, weighting encrypted copies (untamperable ground truth) double. A lone
// mis-extraction — YouTube's Google "g", Google+'s play-slash — is its own
// 1-vote cluster and loses to the real icon. Ties/singletons keep the plain
// best-copy order. Returns a concrete sha (the best copy's icon in the winning
// cluster), which /icon then canonicalizes.
export function consensusIconSha(
  files: any[],
  binaryOf: (f: any) => any,
  canonicalBySha: Map<string, string>
): string | null {
  const byCluster = new Map<string, { weight: number; sha: string }>();
  for (const f of files) {
    const bin = binaryOf(f);
    const sha = bin?.bundle_icon_sha256;      // bundle icon only — never store artwork
    if (!sha) continue;
    const cluster = canonicalBySha.get(sha) || sha;
    const w = bin?.install_status === 'encrypted' ? 2 : 1;
    const cur = byCluster.get(cluster);
    if (!cur) byCluster.set(cluster, { weight: w, sha });
    else { cur.weight += w; if (bin?.bundle_icon_sha256 && cur.sha !== bin.bundle_icon_sha256) cur.sha = bin.bundle_icon_sha256; }
  }
  let best: { weight: number; sha: string } | null = null;
  for (const c of byCluster.values()) if (!best || c.weight > best.weight) best = c;
  return best?.sha ?? null;
}

// A date can't precede the iOS release its binary requires: iMovie 1.2.2 (stored
// as "122") needs iOS 5.0 yet carried a bulk-artifact release_date of Jun 2010 —
// two years before iOS 5 existed. Reject any displayed date earlier than the
// min-OS's release year (year floor is conservative, so it only rejects the
// clearly-impossible, never a plausibly-early one).
export const OS_RELEASE_YEAR: Record<number, number> = {
  2: 2008, 3: 2009, 4: 2010, 5: 2011, 6: 2012, 7: 2013, 8: 2014, 9: 2015,
  10: 2016, 11: 2017, 12: 2018, 13: 2019, 14: 2020, 15: 2021, 16: 2022, 17: 2023, 18: 2024,
};

export const minOsMajor = (v: any) => {
  const m = parseInt(String(v?.minimum_os_version || '').split('.')[0], 10);
  return Number.isFinite(m) && m > 0 ? m : null;
};

// Bulk-imported versions share one bogus release_date (e.g. 487 versions
// catalog-wide claim "Apr 1, 2010"). Real releases don't land 3+ versions on
// the same day, so a date that repeats that often within this app is an
// import artifact — hide it.
export function buildDateTrust(versions: any[]) {
  const dateCounts = new Map<string, number>();
  // A release_date is the iTunes *original*-release stamp (not a per-version date)
  // whenever some version carrying it has its own, different estimated date. That
  // contradiction proves the value is a shared placeholder — e.g. Shazam stamps
  // "2008-07-07" on both 1.0 (whose real estimate is 2008-08-27) and 1.5.3 (no
  // estimate). The bare <3 count misses it when the stamp lands on only two
  // versions, which then sorts 1.5.3 *before* 1.0. Distrust such values so the
  // undated version interpolates by ext-id/version instead of inheriting a date
  // that predates a lower-numbered sibling.
  const contradictedDates = new Set<string>();
  for (const v of versions || []) {
    // Key on the calendar day, not the full timestamp — a bulk-imported date
    // reused across versions is the artifact we want to catch even when the times
    // differ slightly.
    const d = v?.release_date ? String(v.release_date).slice(0, 10) : null;
    if (d) {
      dateCounts.set(d, (dateCounts.get(d) || 0) + 1);
      const est = v?.estimated_release_date ? String(v.estimated_release_date).slice(0, 10) : null;
      if (est && est !== d) contradictedDates.add(d);
    }
  }
  const isTrustworthyDate = (d: any) => {
    if (!d) return false;
    const key = String(d).slice(0, 10);
    return (dateCounts.get(key) || 0) < 3 && !contradictedDates.has(key);
  };

  function datePlausible(dateStr: any, v: any): boolean {
    if (!dateStr) return false;
    const yr = parseInt(String(dateStr).slice(0, 4), 10);
    if (!Number.isFinite(yr)) return false;
    const major = parseInt(String(v?.minimum_os_version || '').split('.')[0], 10);
    const floor = Number.isFinite(major) ? OS_RELEASE_YEAR[major] : undefined;
    return !floor || yr >= floor;
  }

  // Chronological key source: the estimated date, else a trustworthy release_date
  // (day precision). Undated versions get placed by ext id / version number.
  const chronoDateOf = (v: any) =>
    (v?.estimated_release_date && datePlausible(v.estimated_release_date, v))
      ? String(v.estimated_release_date).slice(0, 10)
      : (isTrustworthyDate(v?.release_date) && datePlausible(v.release_date, v) ? String(v.release_date).slice(0, 10) : null);

  return { isTrustworthyDate, datePlausible, chronoDateOf };
}

// One archived copy of a version → its display detail + download affordances.
export function describeCopy(f: any, withFilename: boolean, binaryOf: (f: any) => any, origin: string) {
  const bin = binaryOf(f);
  const size = formatFileSize(f.file_size);
  const detailBits = withFilename ? [fileLabel(f.filename), size] : [size];
  if (bin?.has_watch_app) detailBits.push('Watch app');
  let ipaUrl: string | null = null;
  try {
    ipaUrl = generateIpaDownloadUrl({
      id: f.id,
      filename: f.filename,
      info_plist_path: f.info_plist_path,
      archive_item: { ia_item_id: f.archive_items?.ia_item_id || '' },
    });
  } catch {
    ipaUrl = null;
  }
  return {
    detail: detailBits.filter(Boolean).join(' · '),
    encrypted: bin?.install_status === 'encrypted',
    ipaUrl,
    manifestUrl: `${origin}/manifest/${f.id}.plist`,
  };
}

// The best copy fronts the lockup (its stats stacked under the meta, its button
// centered opposite); the rest are extra copies revealed by "Show all copies".
export function buildVersionRows(
  sortedVersions: any[],
  opts: {
    filesByVersionId: Map<number, any[]>;
    unavailableCountByVersion: Map<number, number>;
    binaryOf: (f: any) => any;
    canonicalBySha: Map<string, string>;
    showEverything: boolean;
    origin: string;
    isTrustworthyDate: (d: any) => boolean;
    datePlausible: (dateStr: any, v: any) => boolean;
  }
) {
  const { filesByVersionId, unavailableCountByVersion, binaryOf, canonicalBySha, showEverything, origin, isTrustworthyDate, datePlausible } = opts;

  // A version's icon is the build-time bundle icon it declared (period-accurate,
  // on-device truth). We deliberately do NOT fall back to itunes_artwork_sha256 (iTunesArtwork
  // = the App Store LISTING icon, a separate and sometimes hand-differed artifact);
  // a version with no loose bundle icon (iOS7+ Assets.car) falls back to a SIBLING
  // version's bundle icon instead — see vIconSha. Content-addressed at /icon/<sha>.
  const iconShaOf = (f: any) => binaryOf(f)?.bundle_icon_sha256 || null;

  return (sortedVersions || []).map((v: any) => {
    const groups = sortGroupsByPreference(
      dedupeFilesByHash(filesByVersionId.get(v.id) || []),
      binaryOf,
      v.minimum_os_version
    );
    const inlineGroups = showEverything ? groups : groups.slice(0, INLINE_COPY_CAP);
    // Hidden unless "Show everything": versions with no available copy, or whose
    // only copies are FairPlay-encrypted (install but won't launch).
    const hasInstallable = groups.some((g: any) => binaryOf(g.file)?.install_status === 'installable');
    const hideByDefault = !hasInstallable;
    // A version whose only archived copies are FairPlay-encrypted (they install
    // but won't launch) — no usable install exists. Its icon is dimmed to signal
    // that. Distinct from "no file at all" (groups.length === 0).
    const encryptedOnly = groups.length > 0
      && groups.every((g: any) => binaryOf(g.file)?.install_status === 'encrypted');
    const versionLabel = v.version_string || v.build_number || 'Unknown version';
    const showBuild = v.build_number && v.build_number !== versionLabel;
    // Consensus across this version's copies (all of them, not just the deduped
    // display groups), so a lone mis-extracted icon can't win by sorting first.
    // Null here (Assets.car version, no loose bundle icon) is filled from the
    // NEAREST icon-bearing sibling version in the timeline pass below.
    const vIconSha = consensusIconSha(filesByVersionId.get(v.id) || [], binaryOf, canonicalBySha)
      || groups.map((g: any) => iconShaOf(g.file)).find(Boolean)
      || null;
    const bin0 = groups.map((g: any) => binaryOf(g.file)).find(Boolean);
    const machoMinOs = bin0?.macho_min_os;
    // Each compatibility fact gets its own stacked line (OS requirement + date;
    // the CPU-architecture line was cut — the iOS requirement is enough).
    const metaLines: { text: string; title?: string; retina?: boolean }[] = [];
    const osReq = osRequirementLabel(v.minimum_os_version) || osRequirementLabel(machoMinOs);
    if (osReq) metaLines.push({ text: osReq });
    // Universal (iPhone + iPad) → the App Store's "fat binary" + badge.
    const df = (v.device_family || []).map((x: any) => String(x));
    // Retina support, per idiom (plan 013). The binary's own UIDeviceFamily
    // (device_family_macho) is authoritative for which idioms the build targets —
    // the App Store metadata device_family is often missing for archived apps —
    // so prefer it, falling back to the version's when absent.
    const binFam = (bin0?.device_family_macho || []).map((x: any) => String(x));
    const retina = retinaLabel(bin0, binFam.length ? binFam : df);
    if (retina) metaLines.push({ ...retina, retina: true });
    if (v.estimated_release_date && datePlausible(v.estimated_release_date, v)) metaLines.push({ text: formatDate(v.estimated_release_date), title: 'Estimated release date' });
    else if (isTrustworthyDate(v.release_date) && datePlausible(v.release_date, v)) metaLines.push({ text: `Released ${formatDate(v.release_date)}` });
    const minosMajor = minOsMajor(v) ?? (machoMinOs ? parseInt(String(machoMinOs).split('.')[0], 10) : null);
    const isUniversal = df.indexOf('1') >= 0 && df.indexOf('2') >= 0;
    const multi = groups.length > 1;
    const primary = inlineGroups[0] ? describeCopy(inlineGroups[0].file, false, binaryOf, origin) : null;
    const extras = inlineGroups.slice(1).map((g: any) => describeCopy(g.file, multi, binaryOf, origin));
    const nofileText = groups.length === 0
      ? (unavailableCountByVersion.get(v.id)
          ? 'This version is no longer available on archive.org'
          : 'No file in the archive for this version')
      : null;
    return { v, versionLabel, showBuild, vIconSha, metaLines, minosMajor, isUniversal, hideByDefault, encryptedOnly, primary, extras, nofileText };
  });
}

// Assets.car versions (no loose bundle icon of their own) borrow the NEAREST
// sibling's bundle icon along the timeline: the latest earlier icon-bearing
// version, else the earliest later one. Nearest beats app-oldest — a 2017
// version must not wear the 2010 icon — and it's always a real bundle icon
// from this app, never the store artwork. Only apps that never shipped a
// loose icon at all go without (→ header's app-level icon_url).
export function fillNearestSiblingIcons(
  versionRows: any[],
  filtered: any[],
  chronoDateOf: (v: any) => string | null
) {
  const rowById = new Map(versionRows.map((r: any) => [r.v.id, r]));
  const chronoRows = sortVersions(filtered, 'asc', chronoDateOf)
    .map((v: any) => rowById.get(v.id))
    .filter(Boolean);
  let carry: string | null = null;
  for (const r of chronoRows) { if (r.vIconSha) carry = r.vIconSha; else r.vIconSha = carry; }
  carry = null;
  for (let i = chronoRows.length - 1; i >= 0; i--) {
    const r = chronoRows[i];
    if (r.vIconSha) carry = r.vIconSha; else r.vIconSha = carry;
  }
}

// Bundle size over time — the largest copy per dated version, chronological.
// Uses every version (not the current sort/filter) so the trend is complete.
export function buildSizePoints(
  versions: any[],
  filesByVersionId: Map<number, any[]>,
  binaryOf: (f: any) => any,
  isTrustworthyDate: (d: any) => boolean,
  datePlausible: (dateStr: any, v: any) => boolean
) {
  return (versions || [])
    .map((v: any) => {
      // Encrypted copies are excluded — they're not a real installable size.
      const files = (filesByVersionId.get(v.id) || []).filter((f: any) => binaryOf(f)?.install_status !== 'encrypted');
      const bytes = files.reduce((mx: number, f: any) => Math.max(mx, Number(f.file_size) || 0), 0);
      const dateStr = (v.estimated_release_date && datePlausible(v.estimated_release_date, v)) ? v.estimated_release_date
        : (isTrustworthyDate(v.release_date) && datePlausible(v.release_date, v) ? v.release_date : null);
      const t = dateStr ? Date.parse(dateStr) : NaN;
      return { t, y: bytes, dateStr };
    })
    .filter((p: any) => Number.isFinite(p.t) && p.y > 0)
    .sort((a: any, b: any) => a.t - b.t);
}
