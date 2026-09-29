// The single definition of "runs on a Light Touch device". Used by
// /api/emulator/apps. Import-free so test/units.test.ts can load it directly.
//
// Every rule reads what the binary itself says first (derived at ingest from
// the .ipa: Mach-O slices, an instruction scan of the armv6 slice, the
// binary's own Info.plist), store metadata only as a fallback:
//   - arch: an armv6-only CPU (ARM11) needs an armv6 slice, and that slice
//     must not actually be ARMv7 code under an armv6 label
//     (binaries.armv6_isa_scan — cracked releases like Enigmo 3.3-H do this,
//     and the iPod touch 2G SIGILLs on them).
//   - min OS: Info.plist MinimumOSVersion (per binary) → version metadata →
//     LC_VERSION_MIN. Unknown still passes (min_os_source: 'unknown'), but
//     never below iPhone OS 2.0, the App Store's floor.
//   - family: UIDeviceFamily (binary → version); absent = iPhone-only, the
//     pre-3.2 convention. An iPad runs iPhone apps too.
//   - UIRequiredDeviceCapabilities: every required key must be one the
//     device has; "!key" (dict form, false) must be one it lacks.
// FairPlay-encrypted copies install but never launch: only 'installable'.

export interface Device {
  model: string;
  name: string;
  archs: string[];        // slices the CPU executes
  families: string[];     // UIDeviceFamily values it runs
  caps: string[];         // UIRequiredDeviceCapabilities it satisfies
}

// Capabilities per Apple's UIRequiredDeviceCapabilities table for each model.
// iPad1,1 is both the Wi-Fi and 3G model; this is the Wi-Fi one (no gps /
// telephony), which is what Light Touch emulates.
const DEVICES: Device[] = [
  {
    model: 'iPod1,1', name: 'iPod touch (1st generation)', archs: ['armv6'], families: ['1'],
    caps: ['armv6', 'wifi', 'accelerometer', 'opengles-1', 'location-services'],
  },
  {
    model: 'iPod2,1', name: 'iPod touch (2nd generation)', archs: ['armv6'], families: ['1'],
    caps: ['armv6', 'wifi', 'accelerometer', 'opengles-1', 'location-services', 'peer-peer',
      'microphone', 'gamekit'],
  },
  {
    model: 'iPad1,1', name: 'iPad', archs: ['armv6', 'armv7'], families: ['1', '2'],
    caps: ['armv6', 'armv7', 'wifi', 'accelerometer', 'opengles-1', 'opengles-2',
      'location-services', 'peer-peer', 'microphone', 'gamekit', 'magnetometer'],
  },
];

// What the shipped (0928d) app asks for without saying so.
export const DEFAULT_DEVICE = 'iPod2,1';
export const DEFAULT_OS = '3.1.3';
const APP_STORE_FLOOR = '2.0';

export function deviceFor(model: string): Device | null {
  return DEVICES.find((d) => d.model === model) || null;
}
export const DEVICE_MODELS = DEVICES.map((d) => d.model);

// "3.1.3" → [3,1,3]; null for anything that isn't 1-3 dotted numbers.
export function parseOs(v: unknown): number[] | null {
  const s = String(v ?? '').trim();
  if (!/^\d{1,2}(\.\d{1,2}){0,2}$/.test(s)) return null;
  const n = s.split('.').map(Number);
  while (n.length < 3) n.push(0);
  return n;
}
function osLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

export interface MinOs {
  os: string | null;
  source: 'plist' | 'metadata' | 'macho' | 'unknown';
}

export function emulatorMinOs(version: any, bin: any): MinOs {
  if (parseOs(bin?.plist_min_os)) return { os: String(bin.plist_min_os), source: 'plist' };
  if (version?.minimum_os_version) return { os: String(version.minimum_os_version), source: 'metadata' };
  if (bin?.macho_min_os) return { os: String(bin.macho_min_os), source: 'macho' };
  return { os: null, source: 'unknown' };
}

export interface Target {
  device: Device;
  os: number[];
  families: string[];     // subset of device.families the caller wants shown
}

export function defaultTarget(): Target {
  const device = deviceFor(DEFAULT_DEVICE)!;
  return { device, os: parseOs(DEFAULT_OS)!, families: device.families };
}

// The derived facts behind a verdict, exposed so a client can say why.
export function compatOf(version: any, file: any, bin: any, t: Target) {
  const min = emulatorMinOs(version, bin);
  const family: string[] = (bin?.device_family_macho?.length ? bin.device_family_macho
    : version?.device_family?.length ? version.device_family : ['1']).map(String);
  const scan = bin?.armv6_isa_scan;
  const armv7Code: boolean | null = scan && typeof scan.armv7 === 'boolean' ? scan.armv7 : null;
  const archs: string[] = bin?.architectures || [];
  const caps: string[] = bin?.required_capabilities || [];
  const reasons: string[] = [];

  if (!bin) reasons.push('not_analyzed');
  else {
    if (bin.hidden) reasons.push('quarantined');
    if (bin.install_status !== 'installable') {
      reasons.push(bin.install_status === 'encrypted' ? 'encrypted' : 'not_analyzed');
    }
    const runnable = archs.filter((a) => t.device.archs.includes(a));
    const onlyArmv6 = !t.device.archs.includes('armv7');
    if (!runnable.length) reasons.push(`no_${t.device.archs.join('_or_')}_slice`);
    else if (onlyArmv6 && armv7Code === true) reasons.push('armv6_slice_contains_armv7_code');
  }
  if (file?.available === false) reasons.push('unavailable');
  const need = parseOs(min.os) || parseOs(APP_STORE_FLOOR)!;
  if (osLess(t.os, need)) reasons.push(`requires_ios_${min.os || APP_STORE_FLOOR}`);
  if (!family.some((f) => t.families.includes(f))) {
    reasons.push(family.some((f) => t.device.families.includes(f)) ? 'family_not_requested' : 'unsupported_device_family');
  }
  for (const c of caps) {
    const lacks = c.startsWith('!') ? t.device.caps.includes(c.slice(1)) : !t.device.caps.includes(c);
    if (lacks) reasons.push(`capability:${c}`);
  }

  return {
    compatible: reasons.length === 0,
    reasons,
    architectures: archs,
    armv7_code: armv7Code,
    min_os: min.os,
    min_os_source: min.source,
    device_family: family,
    required_capabilities: bin?.required_capabilities ?? null,
    install_status: bin?.install_status ?? null,
  };
}

// Back-compat boolean for the default target (iPod touch 2G, iOS 3.1.3).
export function emulatorCompatible(version: any, file: any, bin: any, t: Target = defaultTarget()): boolean {
  return compatOf(version, file, bin, t).compatible;
}
