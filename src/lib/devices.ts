// Human-readable device/OS labels for a version row.
//
// Two jobs: turn a binary's raw Mach-O CPU slices (armv6/armv7/…) into the
// oldest device that can run it, and name the OS era correctly (Apple's mobile
// OS was "iPhone OS" through 3.x, renamed "iOS" at version 4 in 2010).

// Oldest device per CPU floor. The archive is about running apps on old
// hardware, so the useful fact is the FLOOR — the oldest CPU (hence oldest
// device) the binary carries a slice for. Checked oldest-first.
const ARCH_FLOOR: [string, string][] = [
  ['armv6', 'iPhone 2G & later'], // armv6: original iPhone (2G), 3G, iPod touch 1-2
  ['armv7', 'iPhone 3GS & later'],
  ['armv7s', 'iPhone 5 & later'],
  ['arm64', 'iPhone 5s & later (64-bit)'],
];

// e.g. ['armv7','arm64'] → "iPhone 3GS & later". Simulator slices (i386/x86_64)
// and unknown archs are ignored. Empty string when nothing usable is known.
export function deviceClassLabel(archs: unknown): string {
  if (!Array.isArray(archs) || archs.length === 0) return '';
  for (const [arch, label] of ARCH_FLOOR) if (archs.includes(arch)) return label;
  return '';
}

function osMajor(version: unknown): number | null {
  const m = parseInt(String(version ?? '').split('.')[0], 10);
  return Number.isFinite(m) && m > 0 ? m : null;
}

// "iPhone OS" for 1–3, "iOS" for 4+.
export function osName(version: unknown): string {
  const major = osMajor(version);
  return major != null && major <= 3 ? 'iPhone OS' : 'iOS';
}

// "Requires iPhone OS 3.1+" / "Requires iOS 6.0+". Empty for a missing version.
export function osRequirementLabel(version: unknown): string {
  if (!version) return '';
  return `Requires ${osName(version)} ${version}+`;
}

// Short label for the "Runs on" filter chips: "iPhone OS 3" / "iOS 6".
export function osShortLabel(major: number): string {
  return `${major <= 3 ? 'iPhone OS' : 'iOS'} ${major}`;
}
