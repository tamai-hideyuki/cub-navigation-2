import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fileProblems, mapDateLabel, parseManifest } from './manifest-check.ts';

const MANIFEST = JSON.stringify({
  schemaVersion: 1,
  osmDate: '2026-11-24T21:21:23Z',
  builtAt: '2026-11-26T15:00:00+09:00',
  files: {
    routingTiles: { path: 'valhalla_tiles.tar', bytes: 500, sha256: 'a' },
    mapTiles: { path: 'map/kansai.pmtiles', bytes: 200, sha256: 'b' },
  },
});

test('manifest.json を読む。形が違えば null', () => {
  assert.equal(parseManifest(MANIFEST)?.osmDate, '2026-11-24T21:21:23Z');
  assert.equal(parseManifest('{'), null);
  assert.equal(parseManifest('{"osmDate": "x"}'), null);
  assert.equal(parseManifest('{"osmDate": "x", "files": {"a": {"path": 1}}}'), null);
});

test('ファイルが無い・大きさが違うものを挙げる', () => {
  const manifest = parseManifest(MANIFEST)!;
  assert.deepEqual(fileProblems(manifest, (path) => (path === 'valhalla_tiles.tar' ? 500 : 200)), []);
  assert.deepEqual(fileProblems(manifest, (path) => (path === 'valhalla_tiles.tar' ? null : 199)), [
    'valhalla_tiles.tar が無い',
    'map/kansai.pmtiles の大きさが違う（写す途中で止まった？）',
  ]);
});

test('地図の日付は日本の日付で、何日前かを付ける', () => {
  // UTC の 11/24 21:21 は、日本の 11/25 6:21
  assert.equal(mapDateLabel('2026-11-24T21:21:23Z', new Date('2026-11-26T12:00:00+09:00')), '地図 2026/11/25（1日前）');
  assert.equal(mapDateLabel('2026-11-24T21:21:23Z', new Date('2026-11-25T07:00:00+09:00')), '地図 2026/11/25（今日）');
  assert.equal(mapDateLabel('?', new Date()), '地図の日付が分からない');
});
