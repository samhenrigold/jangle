// The single definition of "runs on the LightTouch emulator" (iPod touch 2G,
// iOS 3.1.3, ARM11). Shared by /api/emulator/apps and the app-page "Open in
// LightTouch" button so the policy can't fork.
//
// The armv6 check is the one that actually protects the device: min-OS
// metadata is sometimes wrong (see isAnachronistic in files.ts), but an
// armv7-only slice will not execute on ARM11 no matter what the metadata says.
// FairPlay-encrypted copies install but never launch, so only 'installable'
// passes. Unknown min-OS is included (min_os_source: 'unknown') rather than
// dropped — same posture as the app page's ?ios filter.

const EMULATOR_MAX_OS_MAJOR = 3;

export interface MinOs {
  os: string | null;
  source: 'metadata' | 'macho' | 'unknown';
}

// Store metadata first, the binary's own load command as fallback.
export function emulatorMinOs(version: any, bin: any): MinOs {
  if (version?.minimum_os_version) return { os: String(version.minimum_os_version), source: 'metadata' };
  if (bin?.macho_min_os) return { os: String(bin.macho_min_os), source: 'macho' };
  return { os: null, source: 'unknown' };
}

function majorOf(os: string | null): number | null {
  const n = parseInt(String(os || '').split('.')[0], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// True when this archived copy should run on the emulator. Requires the
// binary row: an unclassified copy can't prove it has an armv6 slice.
export function emulatorCompatible(version: any, file: any, bin: any): boolean {
  if (!bin) return false;
  if (bin.hidden) return false;
  if (file?.available === false) return false;
  if (bin.install_status !== 'installable') return false;
  if (!(bin.architectures || []).includes('armv6')) return false;
  // The binary's own UIDeviceFamily is authoritative over store metadata.
  const family: string[] =
    (bin.device_family_macho?.length ? bin.device_family_macho : version?.device_family) || [];
  if (family.length > 0 && !family.includes('1')) return false;
  const major = majorOf(emulatorMinOs(version, bin).os);
  if (major !== null && major > EMULATOR_MAX_OS_MAJOR) return false;
  return true;
}
