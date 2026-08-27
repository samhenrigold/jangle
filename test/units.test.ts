// Dependency-free unit tests for the pure functions that encode the subtlest
// rules in the repo. Run with `npm test` (node --test, native TS on Node 22+).
// These four lib modules are import-free, so they load directly here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrefixTsquery, clampPage, clampPageSize, looksLikeBundleId, escapeLike } from '../src/lib/search.ts';
import { compareVersionLike } from '../src/lib/sorting.ts';
import { emulatorCompatible } from '../src/lib/emulator.ts';
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

test('dedupeFilesByHash: groups copies sharing an md5', () => {
  const files = [
    { id: 1, md5_hash: 'aaa' },
    { id: 2, md5_hash: 'aaa' },
    { id: 3, md5_hash: 'bbb' },
  ];
  const groups = dedupeFilesByHash(files);
  assert.equal(groups.length, 2);
});
