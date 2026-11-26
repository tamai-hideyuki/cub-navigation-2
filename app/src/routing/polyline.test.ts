import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodePolyline6 } from './polyline.ts';

test('精度 6 桁の polyline を [経度, 緯度] に戻す', () => {
  // Google の例（精度 5 桁）"_p~iF~ps|U_ulLnnqC_mqNvxq`@" を精度 6 桁で作り直したもの
  // (38.5, -120.2), (40.7, -120.95), (43.252, -126.453)
  const encoded = '_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI';
  const coordinates = decodePolyline6(encoded);
  assert.equal(coordinates.length, 3);
  const rounded = coordinates.map(([longitude, latitude]) => [Number(longitude.toFixed(3)), Number(latitude.toFixed(3))]);
  assert.deepEqual(rounded, [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ]);
});

test('空の文字列は空の並び。途中で切れていたら投げる', () => {
  assert.deepEqual(decodePolyline6(''), []);
  assert.throws(() => decodePolyline6('_izlhA~rlg'));
});
