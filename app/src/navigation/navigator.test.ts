// node --test で動かす（Node 23.6 以降は .ts をそのまま読める）
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  findNearestOnRoute,
  initialState,
  step,
  updateAnnouncements,
  updateOffRoute,
  updateProgress,
} from './navigator.ts';
import {
  offsetFromOrigin,
  pathAlongTestRoute,
  readingAt,
  straightTestRoute,
  TEST_ROUTE,
} from './test-route.ts';
import { DEFAULT_CONFIGURATION, type NavigationState, type OffRouteState } from './types.ts';

const route = TEST_ROUTE;
const ordinarySearch = { isOffRoute: false, afterLongGap: false };

/** 点の列を順に流し、鳴ったクリップを全部集める */
function drive(points: [number, number][], state: NavigationState = initialState(route)) {
  const played: string[] = [];
  points.forEach(([east, north], second) => {
    const output = step(route, state, readingAt(east, north, second));
    state = output.state;
    played.push(...output.clipIds);
  });
  return { played: played, state: state };
}

test('ルートどおりに走ると、開始・far・near・到着の順に1回ずつ鳴る', () => {
  const { played } = drive(pathAlongTestRoute(10));
  assert.deepEqual(played, ['common-start', 'turn-000-far', 'turn-000-near', 'common-arrive']);
});

test('位置が飛んで far の範囲を飛ばしたら near だけ鳴る', () => {
  const points: [number, number][] = [
    [0, 0],
    [100, 0],
    [500, 0],
    [960, 0],
    [1000, 50],
  ];
  const { played } = drive(points);
  assert.deepEqual(played, ['common-start', 'turn-000-near']);
});

test('3回続けて離れたら外れの警告、2回続けて戻ったら戻った知らせ', () => {
  const points: [number, number][] = [
    [0, 0],
    [100, 0],
    [200, 200],
    [200, 200],
    [200, 200],
    [300, 0],
    [310, 0],
  ];
  const { played } = drive(points);
  assert.deepEqual(played, ['common-start', 'common-offroute', 'common-onroute']);
});

test('1〜2回だけ離れても警告しない（トンネルの出口のずれ）', () => {
  const points: [number, number][] = [
    [0, 0],
    [100, 0],
    [200, 200],
    [200, 200],
    [300, 0],
    [400, 0],
  ];
  const { played } = drive(points);
  assert.deepEqual(played, ['common-start']);
});

test('外れたままなら1分ごとに警告を繰り返す', () => {
  const points: [number, number][] = [
    [0, 0],
    [100, 0],
  ];
  for (let second = 0; second < 70; second++) points.push([200, 300]);
  const { played } = drive(points);
  assert.deepEqual(played, ['common-start', 'common-offroute', 'common-offroute']);
});

test('精度の悪い位置は使わない', () => {
  let state = initialState(route);
  state = step(route, state, readingAt(0, 0, 0)).state;
  const bad = { ...readingAt(800, 0, 1), accuracyMeters: 200 };
  const output = step(route, state, bad);
  assert.equal(output.state.progress.distanceAlongMeters, state.progress.distanceAlongMeters);
  assert.deepEqual(output.clipIds, []);
});

test('進みは戻らない（ルートを少し戻っても減らない）', () => {
  const { state } = drive([
    [0, 0],
    [500, 0],
    [400, 0],
  ]);
  assert.ok(state.progress.distanceAlongMeters >= 499);
});

test('途中で再起動しても、保存した状態から続き、過ぎた案内は鳴らさない', () => {
  const first = drive([
    [0, 0],
    [600, 0],
  ]);
  const second = drive(
    [
      [650, 0],
      [700, 0],
      [760, 0],
      [960, 0],
    ],
    first.state,
  );
  assert.deepEqual(second.played, ['turn-000-far', 'turn-000-near']);
});

test('状態なしでルートの途中から始めたら、その場で合わせて開始を鳴らす', () => {
  const { played } = drive([
    [1000, 500],
    [1000, 600],
  ]);
  assert.deepEqual(played, ['common-start']);
});

// ---- 部品ごとのテスト ----

test('findNearestOnRoute: 探す範囲の外（limitMeters より先）は見ない', () => {
  const pointNearCorner = offsetFromOrigin(1000, 500);
  const nearest = findNearestOnRoute(route, pointNearCorner, 0, 300);
  assert.ok(nearest !== null);
  assert.ok(nearest.distanceAlongMeters <= 400);
  const whole = findNearestOnRoute(route, pointNearCorner, 0, Infinity);
  assert.ok(whole !== null && whole.distanceMeters < 1);
});

test('updateProgress: ルートから離れている間は進めない', () => {
  const acquired = { segmentIndex: 2, distanceAlongMeters: 250, acquired: true };
  const result = updateProgress(
    route,
    acquired,
    offsetFromOrigin(500, 200),
    ordinarySearch,
    DEFAULT_CONFIGURATION,
  );
  assert.deepEqual(result.progress, acquired);
  assert.ok(result.distanceToRouteMeters !== null && result.distanceToRouteMeters > 190);
});

test('updateProgress: 最初の位置合わせは 50m 以内のときだけ', () => {
  const notAcquired = initialState(route).progress;
  const far = updateProgress(
    route,
    notAcquired,
    offsetFromOrigin(500, 80),
    ordinarySearch,
    DEFAULT_CONFIGURATION,
  );
  assert.equal(far.progress.acquired, false);
  const near = updateProgress(
    route,
    notAcquired,
    offsetFromOrigin(500, 20),
    ordinarySearch,
    DEFAULT_CONFIGURATION,
  );
  assert.equal(near.progress.acquired, true);
});

const onRoute: OffRouteState = {
  status: 'on',
  awayCount: 0,
  backCount: 0,
  lastWarningMilliseconds: null,
};

test('updateOffRoute: 30m〜50m の間は数えない（ばたつきを防ぐ）', () => {
  const result = updateOffRoute({ ...onRoute, awayCount: 2 }, 40, 0, DEFAULT_CONFIGURATION);
  assert.equal(result.offRoute.awayCount, 2);
  assert.deepEqual(result.clipIds, []);
});

test('updateOffRoute: 離れかけ（suspect）から戻れば on に戻る', () => {
  const suspect = updateOffRoute(onRoute, 80, 0, DEFAULT_CONFIGURATION).offRoute;
  assert.equal(suspect.status, 'suspect');
  assert.equal(updateOffRoute(suspect, 5, 1000, DEFAULT_CONFIGURATION).offRoute.status, 'on');
});

test('updateAnnouncements: 曲がる地点から 100m 以内では far を鳴らさず near を待つ', () => {
  const progress = { segmentIndex: 9, distanceAlongMeters: 920, acquired: true };
  const result = updateAnnouncements(route, progress, new Set(), DEFAULT_CONFIGURATION);
  assert.deepEqual(result.clipIds, []);
  assert.equal(result.nextManeuverId, 'turn-000');
  assert.equal(Math.round(result.remainingMeters ?? 0), 80);
});

// ---- 長い途切れ・長い回り道・到着の後（レビューで見つかった不具合の再発を防ぐ） ----

const longRoute = straightTestRoute(30000, 1000);

/** まっすぐのルートを、秒速 17m で eastMeters の列のとおりに走る。null は位置が来ない秒 */
function driveStraight(eastPositions: (number | null)[], northMeters = 0) {
  let state = initialState(longRoute);
  const played: string[] = [];
  eastPositions.forEach((east, second) => {
    if (east === null) return;
    const output = step(longRoute, state, readingAt(east, northMeters, second));
    state = output.state;
    played.push(...output.clipIds);
  });
  return { played: played, state: state };
}

function positionsWithGap(gapStartMeters: number, gapLengthMeters: number): (number | null)[] {
  const positions: (number | null)[] = [];
  for (let east = 0; east <= 20000; east += 17) {
    const inGap = east > gapStartMeters && east < gapStartMeters + gapLengthMeters;
    positions.push(inGap ? null : east);
  }
  return positions;
}

for (const gapKilometers of [2.5, 12]) {
  test(`位置が ${gapKilometers}km 途切れても、外れの警告は出ず、途切れの後の案内は鳴る`, () => {
    const { played } = driveStraight(positionsWithGap(3500, gapKilometers * 1000));
    assert.equal(played.filter((clipId) => clipId === 'common-offroute').length, 0);
    const resumeAt = 3500 + gapKilometers * 1000;
    const firstKilometer = String(Math.ceil(resumeAt / 1000)).padStart(3, '0');
    const firstManeuverAfterGap = `turn-${firstKilometer}-near`;
    assert.ok(
      played.includes(firstManeuverAfterGap),
      `${firstManeuverAfterGap} が鳴らない: ${played.join(',')}`,
    );
    assert.ok(played.includes('turn-018-near'));
  });
}

test('12km の回り道（ずっと外れている）の後でも、ルートに戻れば戻った知らせと案内が鳴る', () => {
  const positions: [number, number][] = [];
  for (let east = 0; east <= 3000; east += 17) positions.push([east, 0]);
  for (let east = 3000; east <= 15000; east += 17) positions.push([east, 300]); // 300m 北の別の道
  for (let east = 15000; east <= 18000; east += 17) positions.push([east, 0]);
  let state = initialState(longRoute);
  const played: string[] = [];
  positions.forEach(([east, north], second) => {
    const output = step(longRoute, state, readingAt(east, north, second));
    state = output.state;
    played.push(...output.clipIds);
  });
  assert.ok(played.includes('common-offroute'));
  assert.ok(played.includes('common-onroute'));
  assert.ok(played.includes('turn-015-near') || played.includes('turn-016-near'));
  assert.ok(played.includes('turn-017-near'));
});

test('着いた後は、ルートから離れても外れの警告を出さない', () => {
  const { played, state } = drive([
    ...pathAlongTestRoute(10),
    [1200, 1000],
    [1300, 1000],
    [1400, 1000],
    [1500, 1000],
  ]);
  assert.ok(played.includes('common-arrive'));
  assert.equal(played.filter((clipId) => clipId === 'common-offroute').length, 0);
  assert.equal(state.offRoute.status, 'on');
});

test('updateProgress: 長い途切れの後は、2km より先でもルートに合わせる', () => {
  const progress = { segmentIndex: 10, distanceAlongMeters: 1000, acquired: true };
  const point = offsetFromOrigin(8000, 5);
  const ordinary = updateProgress(
    longRoute,
    progress,
    point,
    ordinarySearch,
    DEFAULT_CONFIGURATION,
  );
  assert.equal(ordinary.progress.distanceAlongMeters, 1000);
  const afterGap = updateProgress(
    longRoute,
    progress,
    point,
    { isOffRoute: false, afterLongGap: true },
    DEFAULT_CONFIGURATION,
  );
  assert.ok(Math.abs(afterGap.progress.distanceAlongMeters - 8000) < 1);
});

// ---- リグレッション: 決まった走り方の、位置1件ごとの出力を全部固定する ----

test('リグレッション: いろいろな走り方の step の出力', (context) => {
  const scenarios: Record<string, [number, number][]> = {
    ルートどおり: pathAlongTestRoute(25),
    外れて戻る: [
      [0, 0],
      [100, 0],
      [200, 200],
      [200, 200],
      [200, 200],
      [300, 0],
      [310, 0],
      [400, 0],
    ],
    位置が飛ぶ: [
      [0, 0],
      [100, 0],
      [500, 0],
      [960, 0],
      [1000, 50],
      [1000, 990],
    ],
    途中から始める: [
      [1000, 500],
      [1000, 600],
      [1000, 990],
    ],
  };
  const traces: Record<string, unknown[]> = {};
  for (const [name, points] of Object.entries(scenarios)) {
    let state = initialState(route);
    traces[name] = points.map(([east, north], second) => {
      const output = step(route, state, readingAt(east, north, second));
      state = output.state;
      return {
        clipIds: output.clipIds,
        distanceAlongMeters: Math.round(output.state.progress.distanceAlongMeters * 10) / 10,
        offRoute: output.state.offRoute.status,
        nextManeuverId: output.debug.nextManeuverId,
      };
    });
  }
  context.assert.snapshot(traces);
});
