import assert from 'node:assert/strict';
import { test } from 'node:test';

import { initialState } from '../navigation/navigator.ts';
import { EMPTY_REROUTE_HISTORY } from '../navigation/reroute-policy.ts';
import { straightTestRoute, TEST_ROUTE } from '../navigation/test-route.ts';
import { COMMON_CLIPS } from '../navigation/types.ts';
import type { Trip } from './trip-runner.ts';
import { isSameTrip, tripAfterReroute, tripAfterRerouteFailure } from './trip-reroute.ts';

function testTrip(): Trip {
  return {
    destination: { longitude: 135.9, latitude: 35.0 },
    route: TEST_ROUTE,
    totalSeconds: 600,
    state: initialState(TEST_ROUTE),
    reroute: EMPTY_REROUTE_HISTORY,
    rerouteCount: 2,
    arrived: false,
    arrivedAtMilliseconds: null,
    lastRerouteFailed: true,
    logFileName: '2026-11-28-090000.jsonl',
  };
}

const NEW_ROUTE = straightTestRoute(800, 200);
const PLANNED = { route: NEW_ROUTE, totalSeconds: 120 };

test('計算し直す間に何も起きなければ、新しいルートに替える', () => {
  const trip = testTrip();
  const rerouted = tripAfterReroute(trip, trip, PLANNED, 1_000)!;
  assert.equal(rerouted.route, NEW_ROUTE);
  assert.equal(rerouted.totalSeconds, 120);
  assert.deepEqual(rerouted.destination, trip.destination);
  assert.equal(rerouted.logFileName, trip.logFileName);
  assert.equal(rerouted.rerouteCount, 3);
  assert.equal(rerouted.lastRerouteFailed, false);
  assert.deepEqual(rerouted.reroute, { lastAttemptMilliseconds: 1_000, lastAttemptFailed: false });
  assert.equal(rerouted.state.routeComputedAt, NEW_ROUTE.source.computedAt);
  // 「案内を始めます」は鳴らさない
  assert.deepEqual(rerouted.state.playedClipIds, [COMMON_CLIPS.start]);
});

test('計算し直す間に「停止」が押されたら、止めた走行を戻さない（issue #18）', () => {
  const trip = testTrip();
  assert.equal(tripAfterReroute(trip, null, PLANNED, 1_000), null);
  assert.equal(tripAfterRerouteFailure(trip, null, 1_000), null);
});

test('計算し直す間に別の走行が始まっていたら、前の走行の結果で上書きしない', () => {
  const before = testTrip();
  const next = { ...testTrip(), destination: { longitude: 136.0, latitude: 35.1 } };
  assert.equal(tripAfterReroute(before, next, PLANNED, 1_000), null);
  assert.equal(tripAfterRerouteFailure(before, next, 1_000), null);
});

test('計算し直せなかったら、失敗を覚える（ルートはそのまま）', () => {
  const trip = { ...testTrip(), lastRerouteFailed: false };
  const failed = tripAfterRerouteFailure(trip, trip, 2_000)!;
  assert.equal(failed.route, TEST_ROUTE);
  assert.equal(failed.rerouteCount, 2);
  assert.equal(failed.lastRerouteFailed, true);
  assert.deepEqual(failed.reroute, { lastAttemptMilliseconds: 2_000, lastAttemptFailed: true });
});

test('同じ走行かは、中身ではなく、走行そのもので見る', () => {
  const trip = testTrip();
  assert.equal(isSameTrip(trip, trip), true);
  assert.equal(isSameTrip(trip, null), false);
  assert.equal(isSameTrip(trip, { ...trip }), false);
});
