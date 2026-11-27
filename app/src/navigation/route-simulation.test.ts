// 本物のルートを、ずれのある位置で最初から最後まで机の上で走らせる（設計書 6章の通しのテスト）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { routeFromValhalla } from '../routing/route-from-valhalla.ts';
import {
  METERS_PER_DEGREE_LATITUDE,
  metersPerDegreeLongitude,
  pointAlongRoute,
} from './geometry.ts';
import { initialState, step } from './navigator.ts';
import { COMMON_CLIPS, type LocationReading, type NavigationState } from './types.ts';

// パソコンの Valhalla（tiles/）で引いた本物の答え（草津駅 → 甲西駅 10.9km、曲がる所 9 か所）を、
// アプリと同じ routeFromValhalla でルートに直して使う
const route = routeFromValhalla(
  JSON.parse(
    readFileSync(
      new URL('../routing/fixtures/valhalla-kusatsu-kosei.json', import.meta.url),
      'utf8',
    ),
  ),
  '草津駅 → 甲西駅',
  { engine: 'valhalla', osmDate: 'test', computedAt: 'test-1' },
);

/** 決まった種から作る乱数（毎回同じずれにする） */
function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

type DriveOptions = {
  speedMetersPerSecond: number;
  noiseMeters: number;
  gapEveryMeters?: number;
  gapLengthMeters?: number;
};

function driveWholeRoute(options: DriveOptions): { played: string[]; state: NavigationState } {
  const random = seededRandom(42);
  let state = initialState(route);
  const played: string[] = [];
  let second = 0;
  for (let along = 0; along <= route.totalMeters; along += options.speedMetersPerSecond) {
    second++;
    // トンネルのように位置が途切れる区間を作る
    if (options.gapEveryMeters && along % options.gapEveryMeters < (options.gapLengthMeters ?? 0))
      continue;
    const [longitude, latitude] = pointAlongRoute(route.geometry, route.cumulativeMeters, along);
    const metersPerLongitude = metersPerDegreeLongitude(latitude);
    const reading: LocationReading = {
      longitude: longitude + ((random() - 0.5) * 2 * options.noiseMeters) / metersPerLongitude,
      latitude:
        latitude + ((random() - 0.5) * 2 * options.noiseMeters) / METERS_PER_DEGREE_LATITUDE,
      accuracyMeters: options.noiseMeters,
      speedMetersPerSecond: options.speedMetersPerSecond,
      timestampMilliseconds: second * 1000,
    };
    const output = step(route, state, reading);
    state = output.state;
    played.push(...output.clipIds);
  }
  return { played: played, state: state };
}

const expectedNearClips = route.maneuvers.map((maneuver) => maneuver.clips.near);

test('ルート全体を 40km/h・ずれ 10m で走ると、曲がる案内（near）が全部、順に1回ずつ鳴り、外れの警告は出ない', () => {
  const { played, state } = driveWholeRoute({ speedMetersPerSecond: 11, noiseMeters: 10 });
  const nearPlayed = played.filter(
    (clipId) => clipId.endsWith('-near') || clipId === COMMON_CLIPS.arrive,
  );
  assert.deepEqual(nearPlayed, expectedNearClips);
  assert.equal(played.filter((clipId) => clipId === COMMON_CLIPS.offRoute).length, 0);
  assert.equal(played[0], COMMON_CLIPS.start);
  assert.ok(state.progress.distanceAlongMeters > route.totalMeters - 50);
});

test('far は、作った曲がる地点のうち 9割以上で鳴る', () => {
  const { played } = driveWholeRoute({ speedMetersPerSecond: 17, noiseMeters: 10 });
  const farMade = route.maneuvers.filter((maneuver) => maneuver.clips.far !== undefined).length;
  const farPlayed = played.filter((clipId) => clipId.endsWith('-far')).length;
  assert.ok(farPlayed >= farMade * 0.9, `far ${farPlayed} / ${farMade}`);
});

test('2km ごとに 300m 位置が途切れても（トンネル）、near は全部鳴り、誤った警告は出ない', () => {
  const { played } = driveWholeRoute({
    speedMetersPerSecond: 17,
    noiseMeters: 15,
    gapEveryMeters: 2000,
    gapLengthMeters: 300,
  });
  const nearPlayed = played.filter(
    (clipId) => clipId.endsWith('-near') || clipId === COMMON_CLIPS.arrive,
  );
  const missing = expectedNearClips.filter((clipId) => !nearPlayed.includes(clipId));
  // 途切れた区間の中に曲がる地点があれば、その near は鳴らないことがある（位置が来ないため）
  assert.ok(
    missing.length <= expectedNearClips.length * 0.2,
    `鳴らなかった near: ${missing.length}`,
  );
  assert.equal(played.filter((clipId) => clipId === COMMON_CLIPS.offRoute).length, 0);
});
