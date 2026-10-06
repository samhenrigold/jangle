// Dependency-free unit tests for the pure functions that encode the subtlest
// rules in the repo. Run with `npm test` (node --test, native TS on Node 22+).
// These four lib modules are import-free, so they load directly here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrefixTsquery, clampPage, clampPageSize, looksLikeBundleId, escapeLike } from '../src/lib/search.ts';
import { compareVersionLike } from '../src/lib/sorting.ts';
import { emulatorCompatible, compatOf, deviceFor, parseOs, type Target } from '../src/lib/emulator.ts';
import { dedupeFilesByHash } from '../src/lib/files.ts';

test('buildPrefixTsquery: tokenizes, prefix-stars, AND-joins', () => {
  assert.equal(buildPrefixTsquery('angry birds'), 'angry:* & birds:*');
  // Case is preserved (the DB's to_tsquery lowercases); whitespace collapses.
  assert.equal(buildPrefixTsquery('  Angry   Birds  '), 'Angry:* & Birds:*');
});

test('buildPrefixTsquery: folds diacritics to mirror DB f_unaccent', () => {
  // "Pokémon" indexes as unaccented "pokemon" — the query must fold the accent
  // too. Case is preserved here; to_tsquery('english', …) lowercases in the DB.
  assert.equal(buildPrefixTsquery('Pokémon'), 'Pokemon:*');
  assert.equal(buildPrefixTsquery('café'), 'cafe:*');
});

test('buildPrefixTsquery: null on all-punctuation / empty', () => {
  assert.equal(buildPrefixTsquery(''), null);
  assert.equal(buildPrefixTsquery('   '), null);
  assert.equal(buildPrefixTsquery('!!! ??? ...'), null);
});

test('buildPrefixTsquery: caps at 8 tokens', () => {
  const q = buildPrefixTsquery('a b c d e f g h i j');
  assert.equal((q || '').split(' & ').length, 8);
});

test('escapeLike: escapes LIKE metachars only', () => {
  assert.equal(escapeLike('50%'), '50\\%');
  assert.equal(escapeLike('a_b'), 'a\\_b');
  assert.equal(escapeLike('c\\d'), 'c\\\\d');
  assert.equal(escapeLike('plain'), 'plain');
});

test('looksLikeBundleId: reverse-DNS with a letter, not bare numbers', () => {
  assert.equal(looksLikeBundleId('com.rovio.angrybirds'), true);
  assert.equal(looksLikeBundleId('com.rovio'), true);
  assert.equal(looksLikeBundleId('2048'), false);
  assert.equal(looksLikeBundleId('123.456'), false); // no letter
  assert.equal(looksLikeBundleId('angrybirds'), false); // no dot
});

test('clampPage: floors to >=1 and caps at MAX_PAGE', () => {
  assert.equal(clampPage('1'), 1);
  assert.equal(clampPage('0'), 1);
  assert.equal(clampPage('-5'), 1);
  assert.equal(clampPage('abc'), 1);
  assert.equal(clampPage('999999'), 400); // MAX_PAGE
});

test('clampPageSize: snaps to {def, max} only', () => {
  assert.equal(clampPageSize('20'), 20);
  assert.equal(clampPageSize('50'), 50);
  assert.equal(clampPageSize('37'), 20); // intermediate → default
  assert.equal(clampPageSize('999'), 20);
  assert.equal(clampPageSize('50', 25, 50), 50);
  assert.equal(clampPageSize('37', 25, 50), 25);
});

test('compareVersionLike: numeric-component ordering, empty last', () => {
  assert.ok(compareVersionLike('1.0', '1.0.1') < 0);
  assert.ok(compareVersionLike('2.0', '1.9') > 0);
  assert.equal(compareVersionLike('1.0', '1.0'), 0);
  assert.ok(compareVersionLike('1.0', '') < 0);   // empty sorts last
  assert.ok(compareVersionLike('', '1.0') > 0);
});

test('emulatorCompatible: gates on armv6 for the iPod touch 2G target', () => {
  // Hold everything else compatible (installable, iPhone family, low OS) and
  // flip only the arch slice: no armv6 → cannot run on the armv6-only target.
  const v = { minimum_os_version: '3.1.3', device_family: ['1'] };
  const file = { available: true };
  const base = { install_status: 'installable', device_family_macho: ['1'] };
  assert.equal(emulatorCompatible(v, file, { ...base, architectures: ['armv7'] }), false);
  assert.equal(emulatorCompatible(v, file, { ...base, architectures: ['armv6', 'armv7'] }), true);
  // A hidden/quarantined binary is never compatible regardless of arch.
  assert.equal(emulatorCompatible(v, file, { ...base, architectures: ['armv6'], hidden: true }), false);
});

const target = (model: string, os: string, families?: string[]): Target => {
  const device = deviceFor(model)!;
  return { device, os: parseOs(os)!, families: families || device.families };
};

// ipa 195588 as stored: labelled a thin armv6 / iOS 3.0 build, but its armv6
// slice is ARMv7 code (MOVW, VFPv3, NEON) — it SIGILLs on the iPod touch 2G.
const enigmo = {
  version: { minimum_os_version: '3.0', device_family: null },
  file: { available: true },
  bin: {
    install_status: 'installable', architectures: ['armv6'], device_family_macho: null,
    plist_min_os: '3.0', required_capabilities: null,
    armv6_isa_scan: { armv7: true, hits: 2082, words: 267189, v: 1 },
  },
};

test('compatOf: Enigmo (armv7 code under an armv6 label) is out on armv6 devices only', () => {
  const { version, file, bin } = enigmo;
  const ipod = compatOf(version, file, bin, target('iPod2,1', '3.1.3'));
  assert.equal(ipod.compatible, false);
  assert.deepEqual(ipod.reasons, ['armv6_slice_contains_armv7_code']);
  assert.equal(ipod.armv7_code, true);
  assert.equal(compatOf(version, file, bin, target('iPad1,1', '4.2.1')).compatible, true);
  // The default target is the shipped app's iPod touch 2G / 3.1.3.
  assert.equal(emulatorCompatible(version, file, bin), false);
  // Scanned clean → back in.
  const clean = { ...bin, armv6_isa_scan: { armv7: false, hits: 4, words: 39715, v: 1 } };
  assert.equal(emulatorCompatible(version, file, clean), true);
});

test('compatOf: min OS compares full versions, plist first, App Store floor', () => {
  const file = { available: true };
  const bin = { install_status: 'installable', architectures: ['armv6'], plist_min_os: '3.1.3' };
  assert.equal(compatOf({}, file, bin, target('iPod2,1', '3.1.3')).compatible, true);
  assert.deepEqual(compatOf({}, file, bin, target('iPod2,1', '2.2.1')).reasons, ['requires_ios_3.1.3']);
  // Binary's own Info.plist beats version metadata.
  assert.equal(compatOf({ minimum_os_version: '4.0' }, file, bin, target('iPod2,1', '3.1.3')).min_os_source, 'plist');
  // Unknown min OS still passes, but no App Store app runs on iPhone OS 1.x.
  const unknown = { install_status: 'installable', architectures: ['armv6'] };
  assert.equal(compatOf({}, file, unknown, target('iPod2,1', '2.2.1')).compatible, true);
  assert.deepEqual(compatOf({}, file, unknown, target('iPod1,1', '1.1.5')).reasons, ['requires_ios_2.0']);
});

test('compatOf: families — iPad runs both, family= narrows, iPod never runs iPad-only', () => {
  const file = { available: true };
  const bin = (fam: string[] | null) => ({ install_status: 'installable', architectures: ['armv7'], device_family_macho: fam, plist_min_os: '3.2' });
  assert.equal(compatOf({}, file, bin(null), target('iPad1,1', '3.2')).compatible, true);   // no key = iPhone app
  assert.equal(compatOf({}, file, bin(['2']), target('iPad1,1', '3.2')).compatible, true);
  assert.deepEqual(compatOf({}, file, bin(null), target('iPad1,1', '3.2', ['2'])).reasons, ['family_not_requested']);
  const ipod = { ...bin(['2']), architectures: ['armv6'] };
  assert.deepEqual(compatOf({}, file, ipod, target('iPod2,1', '4.2.1')).reasons, ['unsupported_device_family']);
});

test('compatOf: modern model ids, 32-bit cut at iOS 11', () => {
  const file = { available: true };
  const v7 = { install_status: 'installable', architectures: ['armv7'], required_capabilities: ['gps', 'front-facing-camera'] };
  assert.equal(compatOf({}, file, v7, target('iPhone6,1', '10.3.3')).compatible, true);
  assert.deepEqual(compatOf({}, file, v7, target('iPhone6,1', '11.0')).reasons, ['no_arm64_slice']);
  assert.deepEqual(compatOf({}, file, v7, target('iPad13,18', '10.0')).reasons, ['capability:gps']);
  assert.equal(deviceFor('iPhone99,1'), null);
});

test('compatOf: arch and UIRequiredDeviceCapabilities', () => {
  const file = { available: true };
  const base = { install_status: 'installable', plist_min_os: '3.0' };
  assert.deepEqual(compatOf({}, file, { ...base, architectures: ['armv7'] }, target('iPod2,1', '4.2.1')).reasons, ['no_armv6_slice']);
  const gl2 = { ...base, architectures: ['armv6', 'armv7'], required_capabilities: ['opengles-2'] };
  assert.deepEqual(compatOf({}, file, gl2, target('iPod2,1', '4.2.1')).reasons, ['capability:opengles-2']);
  assert.equal(compatOf({}, file, gl2, target('iPad1,1', '4.2.1')).compatible, true);
  const noPhone = { ...base, architectures: ['armv6'], required_capabilities: ['!telephony', 'wifi'] };
  assert.equal(compatOf({}, file, noPhone, target('iPod2,1', '3.1.3')).compatible, true);
  const encrypted = { ...base, architectures: ['armv6'], install_status: 'encrypted' };
  assert.deepEqual(compatOf({}, file, encrypted, target('iPod2,1', '3.1.3')).reasons, ['encrypted']);
});

test('dedupeFilesByHash: groups copies sharing an md5', () => {
  const files = [
    { id: 1, md5_hash: 'aaa' },
    { id: 2, md5_hash: 'aaa' },
    { id: 3, md5_hash: 'bbb' },
  ];
  const groups = dedupeFilesByHash(files);
  assert.equal(groups.length, 2);
});
