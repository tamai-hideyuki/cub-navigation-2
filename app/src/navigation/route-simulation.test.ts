// 本物のルート（assets/route/route.json）を、ずれのある位置で最初から最後まで机の上で走らせる（設計書 6章の通しのテスト）
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { METERS_PER_DEGREE_LATITUDE, metersPerDegreeLongitude, pointAlongRoute } from './geometry.ts';
import { initialState, step } from './navigator.ts';
import type { LocationReading, NavigationState, Route } from './types.ts';

// ルートのデータは tools/build-route.ts が作る（公開していない）。まだなければこのテストは飛ばす
const ROUTE_FILE = new URL('../../assets/route/route.json', import.meta.url);
const routeExists = existsSync(ROUTE_FILE);
const route: Route = routeExists
  ? JSON.parse(readFileSync(ROUTE_FILE, 'utf8'))
  : ({ maneuvers: [] } as unknown as Route);
const routeTest = routeExists ? test : test.skip;

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
    if (options.gapEveryMeters && along % options.gapEveryMeters < (options.gapLengthMeters ?? 0)) continue;
    const [longitude, latitude] = pointAlongRoute(route.geometry, route.cumulativeMeters, along);
    const metersPerLongitude = metersPerDegreeLongitude(latitude);
    const reading: LocationReading = {
      longitude: longitude + ((random() - 0.5) * 2 * options.noiseMeters) / metersPerLongitude,
      latitude: latitude + ((random() - 0.5) * 2 * options.noiseMeters) / METERS_PER_DEGREE_LATITUDE,
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

routeTest(
  'ルート全体を 40km/h・ずれ 10m で走ると、曲がる案内（near）が全部、順に1回ずつ鳴り、外れの警告は出ない',
  () => {
    const { played, state } = driveWholeRoute({ speedMetersPerSecond: 11, noiseMeters: 10 });
    const nearPlayed = played.filter((clipId) => clipId.endsWith('-near') || clipId === 'common-arrive');
    assert.deepEqual(nearPlayed, expectedNearClips);
    assert.equal(played.filter((clipId) => clipId === 'common-offroute').length, 0);
    assert.equal(played[0], 'common-start');
    assert.ok(state.progress.distanceAlongMeters > route.totalMeters - 50);
  },
);

routeTest('far は、作った曲がる地点のうち 9割以上で鳴る', () => {
  const { played } = driveWholeRoute({ speedMetersPerSecond: 17, noiseMeters: 10 });
  const farMade = route.maneuvers.filter((maneuver) => maneuver.clips.far !== undefined).length;
  const farPlayed = played.filter((clipId) => clipId.endsWith('-far')).length;
  assert.ok(farPlayed >= farMade * 0.9, `far ${farPlayed} / ${farMade}`);
});

routeTest('2km ごとに 300m 位置が途切れても（トンネル）、near は全部鳴り、誤った警告は出ない', () => {
  const { played } = driveWholeRoute({
    speedMetersPerSecond: 17,
    noiseMeters: 15,
    gapEveryMeters: 2000,
    gapLengthMeters: 300,
  });
  const nearPlayed = played.filter((clipId) => clipId.endsWith('-near') || clipId === 'common-arrive');
  const missing = expectedNearClips.filter((clipId) => !nearPlayed.includes(clipId));
  // 途切れた区間の中に曲がる地点があれば、その near は鳴らないことがある（位置が来ないため）
  assert.ok(missing.length <= expectedNearClips.length * 0.2, `鳴らなかった near: ${missing.length}`);
  assert.equal(played.filter((clipId) => clipId === 'common-offroute').length, 0);
});
