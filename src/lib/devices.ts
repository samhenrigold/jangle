// Human-readable OS labels for a version row: Apple's mobile OS was
// "iPhone OS" through 3.x, renamed "iOS" at version 4 in 2010.

function osMajor(version: unknown): number | null {
  const m = parseInt(String(version ?? '').split('.')[0], 10);
  return Number.isFinite(m) && m > 0 ? m : null;
}

// "iPhone OS" for 1–3, "iOS" for 4+.
function osName(version: unknown): string {
  const major = osMajor(version);
  return major != null && major <= 3 ? 'iPhone OS' : 'iOS';
}

// "Requires iPhone OS 3.1+" / "Requires iOS 6.0+". Empty for a missing version.
export function osRequirementLabel(version: unknown): string {
  if (!version) return '';
  return `Requires ${osName(version)} ${version}+`;
}

// Short label from a major version alone: "iPhone OS 3" / "iOS 6". Used by the
// "Runs on" filter chips and the stats charts.
export function osShortLabel(major: number): string {
  return `${major <= 3 ? 'iPhone OS' : 'iOS'} ${major}`;
}
