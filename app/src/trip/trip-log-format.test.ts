import assert from 'node:assert/strict';
import { test } from 'node:test';

import { initialState, step } from '../navigation/navigator.ts';
import { offsetFromOrigin, readingAt, TEST_ROUTE } from '../navigation/test-route.ts';
import {
  navigationRecord,
  routeRecord,
  routeStartOffsetMeters,
  tripLogFileName,
} from './trip-log-format.ts';

test('記録のファイル名は、日本の時刻の出発の日時', () => {
  assert.equal(tripLogFileName(new Date('2026-11-27T04:03:01.500Z')), '2026-11-27-130301.jsonl');
  // UTC の 11/27 15:30 は、日本の 11/28 0:30
  assert.equal(tripLogFileName(new Date('2026-11-27T15:30:00Z')), '2026-11-28-003000.jsonl');
});

test('ルートの始まりが、頼んだ出発点から何 m 離れているか', () => {
  const [longitude, latitude] = offsetFromOrigin(0, 40);
  const offset = routeStartOffsetMeters({ longitude, latitude }, TEST_ROUTE)!;
  assert.ok(Math.abs(offset - 40) < 0.5, String(offset));
  assert.equal(
    routeStartOffsetMeters({ longitude, latitude }, { ...TEST_ROUTE, geometry: [] }),
    null,
  );
});

test('ルートの記録には、曲がる所がすべて入る', () => {
  const record = routeRecord(TEST_ROUTE);
  assert.equal(record.maneuvers.length, TEST_ROUTE.maneuvers.length);
  assert.equal(record.points, TEST_ROUTE.geometry.length);
  assert.deepEqual(Object.keys(record.maneuvers[0]), [
    'id',
    'distanceAlongMeters',
    'direction',
    'roadName',
  ]);
});

test('位置ごとの記録に、ナビの判断と、位置を使ったかが入る', () => {
  const before = initialState(TEST_ROUTE);
  const used = step(TEST_ROUTE, before, readingAt(0, 0, 1));
  const usedRecord = navigationRecord(before, used);
  assert.equal(usedRecord.used, true);
  assert.equal(usedRecord.progress.acquired, true);
  assert.equal(usedRecord.offRoute.status, 'on');
  assert.equal(typeof usedRecord.distanceToRouteMeters, 'number');

  // 精度の悪い位置は使わない
  const blurred = { ...readingAt(10, 0, 2), accuracyMeters: 200 };
  const skipped = navigationRecord(used.state, step(TEST_ROUTE, used.state, blurred));
  assert.equal(skipped.used, false);
});
