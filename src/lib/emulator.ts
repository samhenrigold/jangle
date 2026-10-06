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
  minOs: string;          // first iOS release it ran
  maxOs: string;          // last iOS release it ran
}

// Every iPhone / iPod touch / iPad model id. Capabilities follow Apple's
// UIRequiredDeviceCapabilities table: the hardware keys are listed per row,
// the CPU-implied ones (arch, GL, metal, arkit, A12 floor) derive from the tier.
// ponytail: an iPad id stands for its Wi-Fi model (no gps), as iPad1,1 always
// has — split cellular ids out if a target ever needs gps on an iPad.
const TIERS: Record<string, string[]> = {
  armv6: ['armv6'],
  armv7: ['armv6', 'armv7'],
  armv7s: ['armv6', 'armv7', 'armv7s'],
  arm64: ['armv7', 'armv7s', 'arm64'],
  a9: ['armv7', 'armv7s', 'arm64'],
  a12: ['armv7', 'armv7s', 'arm64', 'arm64e'],
};
const PH1 = 'telephony sms microphone still-camera';
const PH3G = `${PH1} gps peer-peer gamekit`;
const PH3GS = `${PH3G} magnetometer auto-focus-camera video-camera`;
const PH4 = `${PH3GS} gyroscope front-facing-camera camera-flash`;
const PH4S = `${PH4} bluetooth-le healthkit`;
const PH7 = `${PH4S} nfc`;
const IP2 = 'microphone peer-peer gamekit';
const IP4 = `${IP2} gyroscope still-camera video-camera front-facing-camera`;
const IP5 = `${IP4} auto-focus-camera camera-flash bluetooth-le`;
const PAD1 = 'microphone peer-peer gamekit magnetometer';
const PAD2 = `${PAD1} gyroscope still-camera video-camera front-facing-camera`;
const PAD3 = `${PAD2} auto-focus-camera bluetooth-le`;
const PAD17 = `${PAD3} healthkit`; // Health came to iPad with iPadOS 17
const PRO = `${PAD3} camera-flash`;
const PRO17 = `${PRO} healthkit`;

// [ids, name, tier, hardware caps]
const ROWS: [string, string, string, string][] = [
  ['iPhone1,1', 'iPhone', 'armv6', PH1],
  ['iPhone1,2', 'iPhone 3G', 'armv6', PH3G],
  ['iPhone2,1', 'iPhone 3GS', 'armv7', PH3GS],
  ['iPhone3,1 iPhone3,2 iPhone3,3', 'iPhone 4', 'armv7', PH4],
  ['iPhone4,1', 'iPhone 4S', 'armv7', PH4S],
  ['iPhone5,1 iPhone5,2', 'iPhone 5', 'armv7s', PH4S],
  ['iPhone5,3 iPhone5,4', 'iPhone 5c', 'armv7s', PH4S],
  ['iPhone6,1 iPhone6,2', 'iPhone 5s', 'arm64', PH4S],
  ['iPhone7,2', 'iPhone 6', 'arm64', PH4S],
  ['iPhone7,1', 'iPhone 6 Plus', 'arm64', PH4S],
  ['iPhone8,1', 'iPhone 6s', 'a9', PH4S],
  ['iPhone8,2', 'iPhone 6s Plus', 'a9', PH4S],
  ['iPhone8,4', 'iPhone SE', 'a9', PH4S],
  ['iPhone9,1 iPhone9,3', 'iPhone 7', 'a9', PH7],
  ['iPhone9,2 iPhone9,4', 'iPhone 7 Plus', 'a9', PH7],
  ['iPhone10,1 iPhone10,4', 'iPhone 8', 'a9', PH7],
  ['iPhone10,2 iPhone10,5', 'iPhone 8 Plus', 'a9', PH7],
  ['iPhone10,3 iPhone10,6', 'iPhone X', 'a9', PH7],
  ['iPhone11,2', 'iPhone XS', 'a12', PH7],
  ['iPhone11,4 iPhone11,6', 'iPhone XS Max', 'a12', PH7],
  ['iPhone11,8', 'iPhone XR', 'a12', PH7],
  ['iPhone12,1', 'iPhone 11', 'a12', PH7],
  ['iPhone12,3', 'iPhone 11 Pro', 'a12', PH7],
  ['iPhone12,5', 'iPhone 11 Pro Max', 'a12', PH7],
  ['iPhone12,8', 'iPhone SE (2nd generation)', 'a12', PH7],
  ['iPhone13,1', 'iPhone 12 mini', 'a12', PH7],
  ['iPhone13,2', 'iPhone 12', 'a12', PH7],
  ['iPhone13,3', 'iPhone 12 Pro', 'a12', PH7],
  ['iPhone13,4', 'iPhone 12 Pro Max', 'a12', PH7],
  ['iPhone14,4', 'iPhone 13 mini', 'a12', PH7],
  ['iPhone14,5', 'iPhone 13', 'a12', PH7],
  ['iPhone14,2', 'iPhone 13 Pro', 'a12', PH7],
  ['iPhone14,3', 'iPhone 13 Pro Max', 'a12', PH7],
  ['iPhone14,6', 'iPhone SE (3rd generation)', 'a12', PH7],
  ['iPhone14,7', 'iPhone 14', 'a12', PH7],
  ['iPhone14,8', 'iPhone 14 Plus', 'a12', PH7],
  ['iPhone15,2', 'iPhone 14 Pro', 'a12', PH7],
  ['iPhone15,3', 'iPhone 14 Pro Max', 'a12', PH7],
  ['iPhone15,4', 'iPhone 15', 'a12', PH7],
  ['iPhone15,5', 'iPhone 15 Plus', 'a12', PH7],
  ['iPhone16,1', 'iPhone 15 Pro', 'a12', PH7],
  ['iPhone16,2', 'iPhone 15 Pro Max', 'a12', PH7],
  ['iPhone17,3', 'iPhone 16', 'a12', PH7],
  ['iPhone17,4', 'iPhone 16 Plus', 'a12', PH7],
  ['iPhone17,1', 'iPhone 16 Pro', 'a12', PH7],
  ['iPhone17,2', 'iPhone 16 Pro Max', 'a12', PH7],
  ['iPhone17,5', 'iPhone 16e', 'a12', PH7],
  ['iPhone18,3', 'iPhone 17', 'a12', PH7],
  ['iPhone18,4', 'iPhone Air', 'a12', PH7],
  ['iPhone18,1', 'iPhone 17 Pro', 'a12', PH7],
  ['iPhone18,2', 'iPhone 17 Pro Max', 'a12', PH7],
  ['iPhone18,5', 'iPhone 17e', 'a12', PH7],
  ['iPhone19,2', 'iPhone 18 Pro', 'a12', PH7],
  ['iPhone19,3 iPhone19,7', 'iPhone 18 Pro Max', 'a12', PH7],

  ['iPod1,1', 'iPod touch (1st generation)', 'armv6', ''],
  ['iPod2,1', 'iPod touch (2nd generation)', 'armv6', IP2],
  ['iPod3,1', 'iPod touch (3rd generation)', 'armv7', IP2],
  ['iPod4,1', 'iPod touch (4th generation)', 'armv7', IP4],
  ['iPod5,1', 'iPod touch (5th generation)', 'armv7', IP5],
  ['iPod7,1', 'iPod touch (6th generation)', 'arm64', IP5],
  ['iPod9,1', 'iPod touch (7th generation)', 'a9', IP5],

  ['iPad1,1', 'iPad', 'armv7', PAD1],
  ['iPad2,1 iPad2,2 iPad2,3 iPad2,4', 'iPad 2', 'armv7', PAD2],
  ['iPad2,5 iPad2,6 iPad2,7', 'iPad mini', 'armv7', PAD3],
  ['iPad3,1 iPad3,2 iPad3,3', 'iPad (3rd generation)', 'armv7', PAD3],
  ['iPad3,4 iPad3,5 iPad3,6', 'iPad (4th generation)', 'armv7s', PAD3],
  ['iPad4,1 iPad4,2 iPad4,3', 'iPad Air', 'arm64', PAD3],
  ['iPad4,4 iPad4,5 iPad4,6', 'iPad mini 2', 'arm64', PAD3],
  ['iPad4,7 iPad4,8 iPad4,9', 'iPad mini 3', 'arm64', PAD3],
  ['iPad5,1 iPad5,2', 'iPad mini 4', 'arm64', PAD3],
  ['iPad5,3 iPad5,4', 'iPad Air 2', 'arm64', PAD3],
  ['iPad6,3 iPad6,4', 'iPad Pro (9.7-inch)', 'a9', PRO],
  ['iPad6,7 iPad6,8', 'iPad Pro (12.9-inch)', 'a9', PAD3],
  ['iPad6,11 iPad6,12', 'iPad (5th generation)', 'a9', PAD3],
  ['iPad7,1 iPad7,2', 'iPad Pro (12.9-inch) (2nd generation)', 'a9', PRO17],
  ['iPad7,3 iPad7,4', 'iPad Pro (10.5-inch)', 'a9', PRO17],
  ['iPad7,5 iPad7,6', 'iPad (6th generation)', 'a9', PAD17],
  ['iPad7,11 iPad7,12', 'iPad (7th generation)', 'a9', PAD17],
  ['iPad8,1 iPad8,2 iPad8,3 iPad8,4', 'iPad Pro (11-inch)', 'a12', PRO17],
  ['iPad8,5 iPad8,6 iPad8,7 iPad8,8', 'iPad Pro (12.9-inch) (3rd generation)', 'a12', PRO17],
  ['iPad8,9 iPad8,10', 'iPad Pro (11-inch) (2nd generation)', 'a12', PRO17],
  ['iPad8,11 iPad8,12', 'iPad Pro (12.9-inch) (4th generation)', 'a12', PRO17],
  ['iPad11,1 iPad11,2', 'iPad mini (5th generation)', 'a12', PAD17],
  ['iPad11,3 iPad11,4', 'iPad Air (3rd generation)', 'a12', PAD17],
  ['iPad11,6 iPad11,7', 'iPad (8th generation)', 'a12', PAD17],
  ['iPad12,1 iPad12,2', 'iPad (9th generation)', 'a12', PAD17],
  ['iPad13,1 iPad13,2', 'iPad Air (4th generation)', 'a12', PAD17],
  ['iPad13,4 iPad13,5 iPad13,6 iPad13,7', 'iPad Pro (11-inch) (3rd generation)', 'a12', PRO17],
  ['iPad13,8 iPad13,9 iPad13,10 iPad13,11', 'iPad Pro (12.9-inch) (5th generation)', 'a12', PRO17],
  ['iPad13,16 iPad13,17', 'iPad Air (5th generation)', 'a12', PAD17],
  ['iPad13,18 iPad13,19', 'iPad (10th generation)', 'a12', PAD17],
  ['iPad14,1 iPad14,2', 'iPad mini (6th generation)', 'a12', PAD17],
  ['iPad14,3 iPad14,4', 'iPad Pro (11-inch) (4th generation)', 'a12', PRO17],
  ['iPad14,5 iPad14,6', 'iPad Pro (12.9-inch) (6th generation)', 'a12', PRO17],
  ['iPad14,8 iPad14,9', 'iPad Air (11-inch) (M2)', 'a12', PAD17],
  ['iPad14,10 iPad14,11', 'iPad Air (13-inch) (M2)', 'a12', PAD17],
  ['iPad15,3 iPad15,4', 'iPad Air (11-inch) (M3)', 'a12', PAD17],
  ['iPad15,5 iPad15,6', 'iPad Air (13-inch) (M3)', 'a12', PAD17],
  ['iPad15,7 iPad15,8', 'iPad (A16)', 'a12', PAD17],
  ['iPad16,1 iPad16,2', 'iPad mini (A17 Pro)', 'a12', PAD17],
  ['iPad16,3 iPad16,4', 'iPad Pro (11-inch) (M4)', 'a12', PRO17],
  ['iPad16,5 iPad16,6', 'iPad Pro (13-inch) (M4)', 'a12', PRO17],
  ['iPad16,8 iPad16,9', 'iPad Air (11-inch) (M4)', 'a12', PAD17],
  ['iPad16,10 iPad16,11', 'iPad Air (13-inch) (M4)', 'a12', PAD17],
  ['iPad17,1 iPad17,2', 'iPad Pro (11-inch) (M5)', 'a12', PRO17],
  ['iPad17,3 iPad17,4', 'iPad Pro (13-inch) (M5)', 'a12', PRO17],
];

// [first, last] release each model ran, from AppleDB (api.appledb.dev/ios/main.json,
// 2026-10-06): release builds only (no beta/rc/internal), counted for a model
// only when AppleDB has an Apple download for it or lists it as factory-
// installed. RSR suffixes ("26.3.1 (a)") fold to their base. Checked against
// ipsw.me; every disagreement spot-checked came out AppleDB's way (factory
// builds, the 32-bit 10.3.4 restores — confirmed from Apple's BuildManifests).
// Models still getting updates need a re-capture when a newer iOS ships.
const OS_RANGE: Record<string, [string, string]> = {
  'iPhone1,1': ['1.0', '3.1.3'], 'iPhone1,2': ['2.0', '4.2.1'], 'iPhone2,1': ['3.0', '6.1.6'],
  'iPhone3,1': ['4.0', '7.1.2'], 'iPhone3,2': ['6.0', '7.1.2'], 'iPhone3,3': ['4.2.5', '7.1.2'],
  'iPhone4,1': ['5.0', '9.3.6'], 'iPhone5,1': ['6.0', '10.3.4'], 'iPhone5,2': ['6.0', '10.3.4'],
  'iPhone5,3': ['7.0', '10.3.4'], 'iPhone5,4': ['7.0', '10.3.4'], 'iPhone6,1': ['7.0', '12.5.8'],
  'iPhone6,2': ['7.0', '12.5.8'], 'iPhone7,1': ['8.0', '12.5.8'], 'iPhone7,2': ['8.0', '12.5.8'],
  'iPhone8,1': ['9.0', '15.8.8'], 'iPhone8,2': ['9.0', '15.8.8'], 'iPhone8,4': ['9.3', '15.8.8'],
  'iPhone9,1': ['10.0', '15.8.8'], 'iPhone9,2': ['10.0', '15.8.8'], 'iPhone9,3': ['10.0', '15.8.8'],
  'iPhone9,4': ['10.0', '15.8.8'], 'iPhone10,1': ['11.0', '16.7.16'],
  'iPhone10,2': ['11.0', '16.7.16'], 'iPhone10,3': ['11.0', '16.7.16'],
  'iPhone10,4': ['11.0', '16.7.16'], 'iPhone10,5': ['11.0', '16.7.16'],
  'iPhone10,6': ['11.0', '16.7.16'], 'iPhone11,2': ['12.0', '18.7.10'],
  'iPhone11,4': ['12.0', '18.7.10'], 'iPhone11,6': ['12.0', '18.7.10'],
  'iPhone11,8': ['12.0', '18.7.10'], 'iPhone12,1': ['13.0', '27.0.1'],
  'iPhone12,3': ['13.0', '27.0.1'], 'iPhone12,5': ['13.0', '27.0.1'],
  'iPhone12,8': ['13.4', '27.0.1'], 'iPhone13,1': ['14.1', '27.0.1'],
  'iPhone13,2': ['14.1', '27.0.1'], 'iPhone13,3': ['14.1', '27.0.1'],
  'iPhone13,4': ['14.1', '27.0.1'], 'iPhone14,2': ['15.0', '27.0.1'],
  'iPhone14,3': ['15.0', '27.0.1'], 'iPhone14,4': ['15.0', '27.0.1'],
  'iPhone14,5': ['15.0', '27.0.1'], 'iPhone14,6': ['15.4', '27.0.1'],
  'iPhone14,7': ['16.0', '27.0.1'], 'iPhone14,8': ['16.0', '27.0.1'],
  'iPhone15,2': ['16.0', '27.0.1'], 'iPhone15,3': ['16.0', '27.0.1'],
  'iPhone15,4': ['17.0', '27.0.1'], 'iPhone15,5': ['17.0', '27.0.1'],
  'iPhone16,1': ['17.0', '27.0.1'], 'iPhone16,2': ['17.0', '27.0.1'],
  'iPhone17,1': ['18.0', '27.0.1'], 'iPhone17,2': ['18.0', '27.0.1'],
  'iPhone17,3': ['18.0', '27.0.1'], 'iPhone17,4': ['18.0', '27.0.1'],
  'iPhone17,5': ['18.3', '27.0.1'], 'iPhone18,1': ['26.0', '27.0.1'],
  'iPhone18,2': ['26.0', '27.0.1'], 'iPhone18,3': ['26.0', '27.0.1'],
  'iPhone18,4': ['26.0', '27.0.1'], 'iPhone18,5': ['26.3', '27.0.1'],
  'iPhone19,2': ['27.0', '27.0.1'], 'iPhone19,3': ['27.0', '27.0.1'],
  'iPhone19,7': ['27.0', '27.0.1'], 'iPod1,1': ['1.1', '3.1.3'], 'iPod2,1': ['2.1.1', '4.2.1'],
  'iPod3,1': ['3.1.1', '5.1.1'], 'iPod4,1': ['4.1', '6.1.6'], 'iPod5,1': ['6.0', '9.3.5'],
  'iPod7,1': ['8.4', '12.5.8'], 'iPod9,1': ['12.3', '15.8.8'], 'iPad1,1': ['3.2', '5.1.1'],
  'iPad2,1': ['4.3', '9.3.5'], 'iPad2,2': ['4.3', '9.3.5'], 'iPad2,3': ['4.3', '9.3.6'],
  'iPad2,4': ['5.1', '9.3.5'], 'iPad2,5': ['6.0', '9.3.5'], 'iPad2,6': ['6.0.1', '9.3.6'],
  'iPad2,7': ['6.0.1', '9.3.6'], 'iPad3,1': ['5.1', '9.3.5'], 'iPad3,2': ['5.1', '9.3.6'],
  'iPad3,3': ['5.1', '9.3.6'], 'iPad3,4': ['6.0', '10.3.4'], 'iPad3,5': ['6.0.1', '10.3.4'],
  'iPad3,6': ['6.0.1', '10.3.4'], 'iPad4,1': ['7.0.3', '12.5.8'], 'iPad4,2': ['7.0.3', '12.5.8'],
  'iPad4,3': ['7.1', '12.5.8'], 'iPad4,4': ['7.0.3', '12.5.8'], 'iPad4,5': ['7.0.3', '12.5.8'],
  'iPad4,6': ['7.1', '12.5.8'], 'iPad4,7': ['8.0.2', '12.5.8'], 'iPad4,8': ['8.1', '12.5.8'],
  'iPad4,9': ['8.1', '12.5.8'], 'iPad5,1': ['9.0', '15.8.8'], 'iPad5,2': ['9.0', '15.8.8'],
  'iPad5,3': ['8.1', '15.8.8'], 'iPad5,4': ['8.1', '15.8.8'], 'iPad6,3': ['9.3', '16.7.16'],
  'iPad6,4': ['9.3', '16.7.16'], 'iPad6,7': ['9.1', '16.7.16'], 'iPad6,8': ['9.1', '16.7.16'],
  'iPad6,11': ['10.3', '16.7.16'], 'iPad6,12': ['10.3', '16.7.16'], 'iPad7,1': ['10.3', '17.7.11'],
  'iPad7,2': ['10.3', '17.7.11'], 'iPad7,3': ['10.3', '17.7.11'], 'iPad7,4': ['10.3', '17.7.11'],
  'iPad7,5': ['11.3', '17.7.11'], 'iPad7,6': ['11.3', '17.7.11'], 'iPad7,11': ['13.1', '18.7.10'],
  'iPad7,12': ['13.1', '18.7.10'], 'iPad8,1': ['12.1', '26.7.1'], 'iPad8,2': ['12.1', '26.7.1'],
  'iPad8,3': ['12.1', '26.7.1'], 'iPad8,4': ['12.1', '26.7.1'], 'iPad8,5': ['12.1', '26.7.1'],
  'iPad8,6': ['12.1', '26.7.1'], 'iPad8,7': ['12.1', '26.7.1'], 'iPad8,8': ['12.1', '26.7.1'],
  'iPad8,9': ['13.4', '27.0.1'], 'iPad8,10': ['13.4', '27.0.1'], 'iPad8,11': ['13.4', '27.0.1'],
  'iPad8,12': ['13.4', '27.0.1'], 'iPad11,1': ['12.2', '26.7.1'], 'iPad11,2': ['12.2', '26.7.1'],
  'iPad11,3': ['12.2', '26.7.1'], 'iPad11,4': ['12.2', '26.7.1'], 'iPad11,6': ['14.0', '26.7.1'],
  'iPad11,7': ['14.0', '26.7.1'], 'iPad12,1': ['15.0', '27.0.1'], 'iPad12,2': ['15.0', '27.0.1'],
  'iPad13,1': ['14.0', '27.0.1'], 'iPad13,2': ['14.0', '27.0.1'], 'iPad13,4': ['14.5', '27.0.1'],
  'iPad13,5': ['14.5', '27.0.1'], 'iPad13,6': ['14.5', '27.0.1'], 'iPad13,7': ['14.5', '27.0.1'],
  'iPad13,8': ['14.5', '27.0.1'], 'iPad13,9': ['14.5', '27.0.1'], 'iPad13,10': ['14.5', '27.0.1'],
  'iPad13,11': ['14.5', '27.0.1'], 'iPad13,16': ['15.4', '27.0.1'], 'iPad13,17': ['15.4', '27.0.1'],
  'iPad13,18': ['16.0', '27.0.1'], 'iPad13,19': ['16.0', '27.0.1'], 'iPad14,1': ['15.0', '27.0.1'],
  'iPad14,2': ['15.0', '27.0.1'], 'iPad14,3': ['16.0', '27.0.1'], 'iPad14,4': ['16.0', '27.0.1'],
  'iPad14,5': ['16.0', '27.0.1'], 'iPad14,6': ['16.0', '27.0.1'], 'iPad14,8': ['17.4', '27.0.1'],
  'iPad14,9': ['17.4', '27.0.1'], 'iPad14,10': ['17.4', '27.0.1'], 'iPad14,11': ['17.4', '27.0.1'],
  'iPad15,3': ['18.3', '27.0.1'], 'iPad15,4': ['18.3', '27.0.1'], 'iPad15,5': ['18.3', '27.0.1'],
  'iPad15,6': ['18.3', '27.0.1'], 'iPad15,7': ['18.3', '27.0.1'], 'iPad15,8': ['18.3', '27.0.1'],
  'iPad16,1': ['18.0', '27.0.1'], 'iPad16,2': ['18.0', '27.0.1'], 'iPad16,3': ['17.4', '27.0.1'],
  'iPad16,4': ['17.4', '27.0.1'], 'iPad16,5': ['17.4', '27.0.1'], 'iPad16,6': ['17.4', '27.0.1'],
  'iPad16,8': ['26.3', '27.0.1'], 'iPad16,9': ['26.3', '27.0.1'], 'iPad16,10': ['26.3', '27.0.1'],
  'iPad16,11': ['26.3', '27.0.1'], 'iPad17,1': ['26.0', '27.0.1'], 'iPad17,2': ['26.0', '27.0.1'],
  'iPad17,3': ['26.0', '27.0.1'], 'iPad17,4': ['26.0', '27.0.1'],
};

function capsOf(tier: string, hw: string): string[] {
  const archs = TIERS[tier];
  const has = (a: string) => archs.includes(a);
  const c = ['wifi', 'accelerometer', 'location-services', 'opengles-1', ...hw.split(' ').filter(Boolean)];
  if (has('armv6')) c.push('armv6');
  if (has('armv7')) c.push('armv7', 'opengles-2');
  if (has('arm64')) c.push('arm64', 'opengles-3', 'metal');
  if (tier === 'a9' || tier === 'a12') c.push('arkit');
  if (tier === 'a12') c.push('iphone-ipad-minimum-performance-a12');
  return c;
}

const DEVICES: Device[] = ROWS.flatMap(([ids, name, tier, hw]) => ids.split(' ').map((model) => ({
  model, name, archs: TIERS[tier], families: model.startsWith('iPad') ? ['1', '2'] : ['1'], caps: capsOf(tier, hw),
  minOs: OS_RANGE[model][0], maxOs: OS_RANGE[model][1],
})));

// Whether the device ever ran this iOS version (an iPhone 4 never ran 2.x).
export function runsOs(d: Device, os: number[]): boolean {
  return !osLess(os, parseOs(d.minOs)!) && !osLess(parseOs(d.maxOs)!, os);
}

// What the shipped (0928d) app asks for without saying so.
export const DEFAULT_DEVICE = 'iPod2,1';
export const DEFAULT_OS = '3.1.3';
const APP_STORE_FLOOR = '2.0';

export function deviceFor(model: string): Device | null {
  return DEVICES.find((d) => d.model === model) || null;
}

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
    // iOS 11 dropped 32-bit apps.
    const cpu = t.os[0] >= 11 ? t.device.archs.filter((a) => a.startsWith('arm64')) : t.device.archs;
    const runnable = archs.filter((a) => cpu.includes(a));
    const onlyArmv6 = !cpu.includes('armv7') && cpu.includes('armv6');
    if (!runnable.length) reasons.push(`no_${cpu.join('_or_')}_slice`);
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
