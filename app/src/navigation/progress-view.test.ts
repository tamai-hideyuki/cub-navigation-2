import assert from 'node:assert/strict';
import { test } from 'node:test';

import { initialState } from './navigator.ts';
import { formatDistance, formatDuration, progressView, splitRoute } from './progress-view.ts';
import {
  DEFAULT_REROUTE_CONFIGURATION,
  EMPTY_REROUTE_HISTORY,
  shouldReroute,
} from './reroute-policy.ts';
import { straightTestRoute } from './test-route.ts';
import type { NavigationState } from './types.ts';

const ROUTE = straightTestRoute(1000, 400); // まっすぐ 1000m、400m ごとに曲がる所

function stateAt(meters: number, offRouteStatus: 'on' | 'suspect' | 'off' = 'on'): NavigationState {
  const state = initialState(ROUTE);
  return {
    ...state,
    progress: { ...state.progress, acquired: true, distanceAlongMeters: meters },
    offRoute: { ...state.offRoute, status: offRouteStatus },
  };
}

test('ルートを進んだ所で2つに分ける。分けた点は両方に入る', () => {
  const { passed, ahead } = splitRoute(ROUTE, 250);
  assert.deepEqual(passed.at(-1), ahead[0]);
  assert.deepEqual(passed[0], ROUTE.geometry[0]);
  assert.deepEqual(ahead.at(-1), ROUTE.geometry.at(-1));
});

test('残りの距離・時間・次の曲がる所・進み具合を出す', () => {
  const view = progressView(ROUTE, stateAt(250), 600);
  assert.ok(Math.abs(view.fraction - 0.25) < 1e-9);
  assert.ok(Math.abs(view.remainingMeters - 750) < 1);
  assert.ok(Math.abs(view.remainingSeconds - 450) < 1);
  assert.ok(view.nextManeuver !== null);
  assert.ok(Math.abs((view.nextManeuver?.distanceMeters ?? 0) - 150) < 1);
  assert.equal(view.maneuverFractions.length, ROUTE.maneuvers.length);
});

test('外れが確かになったらリルートする。前の計算から間が空くまではしない。着いた後はしない', () => {
  assert.equal(shouldReroute(stateAt(250, 'suspect'), EMPTY_REROUTE_HISTORY, 0, false), false);
  assert.equal(shouldReroute(stateAt(250, 'off'), EMPTY_REROUTE_HISTORY, 0, false), true);
  assert.equal(shouldReroute(stateAt(250, 'off'), EMPTY_REROUTE_HISTORY, 0, true), false);
  const justTried = { lastAttemptMilliseconds: 100_000, lastAttemptFailed: false };
  assert.equal(shouldReroute(stateAt(250, 'off'), justTried, 110_000, false), false);
  assert.equal(
    shouldReroute(
      stateAt(250, 'off'),
      justTried,
      100_000 + DEFAULT_REROUTE_CONFIGURATION.minimumIntervalMilliseconds,
      false,
    ),
    true,
  );
  const failed = { lastAttemptMilliseconds: 100_000, lastAttemptFailed: true };
  assert.equal(shouldReroute(stateAt(250, 'off'), failed, 140_000, false), false);
});

test('距離と時間の書き方', () => {
  assert.equal(formatDistance(347), '350m');
  assert.equal(formatDistance(12_345), '12.3km');
  assert.equal(formatDuration(25 * 60), '25分');
  assert.equal(formatDuration(135 * 60), '2時間15分');
});
