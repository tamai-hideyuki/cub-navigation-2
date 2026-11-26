import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { pointAlongRoute } from '../navigation/geometry.ts';
import { initialState, step } from '../navigation/navigator.ts';
import { COMMON_CLIPS } from '../navigation/types.ts';
import { allPhrases } from '../voice/phrases.ts';
import { audioClipIds, routeFromValhalla } from './route-from-valhalla.ts';

// パソコンの Valhalla（tiles/）で引いた本物の答え。草津駅 → 甲西駅 10.9km
const RESPONSE = JSON.parse(readFileSync(new URL('./fixtures/valhalla-kusatsu-kosei.json', import.meta.url), 'utf8'));
const SOURCE = { engine: 'valhalla', osmDate: 'test', computedAt: 'test-1' };

test('Valhalla の答えから、曲がる所と案内を作る', () => {
  const route = routeFromValhalla(RESPONSE, '草津駅 → 甲西駅', SOURCE);
  assert.ok(Math.abs(route.totalMeters - 10_933) < 50, `距離 ${route.totalMeters}`);
  assert.deepEqual(
    route.maneuvers.map((maneuver) => maneuver.direction),
    ['right', 'right', 'right', 'keep_right', 'slight_right', 'left', 'right', 'left', 'right', 'arrive'],
  );
  assert.equal(route.maneuvers.at(-1)?.clips.near, 'turn-0009-near');
  assert.equal(route.clipAudio?.['turn-0009-near'], COMMON_CLIPS.arrive);
  // 国道1号に入る左折は、前の曲がる所から十分離れているので far もある
  const intoRoute1 = route.maneuvers[5];
  assert.equal(intoRoute1.roadName, '国道1号');
  assert.equal(route.clipAudio?.[intoRoute1.clips.far ?? ''], 'joined-far-left');
});

test('鳴らす声は、どれも作った声の一覧にある', () => {
  const route = routeFromValhalla(RESPONSE, 'test', SOURCE);
  const phrases = allPhrases();
  for (const audio of Object.values(route.clipAudio ?? {})) assert.ok(phrases[audio], audio);
});

test('同じ向きの案内（右折が何回も）が、ルートの最後まで毎回鳴る', () => {
  const route = routeFromValhalla(RESPONSE, 'test', SOURCE);
  let state = initialState(route);
  const played: string[] = [];
  let second = 0;
  for (let along = 0; along <= route.totalMeters + 20; along += 8) {
    second++;
    const [longitude, latitude] = pointAlongRoute(route.geometry, route.cumulativeMeters, Math.min(along, route.totalMeters));
    const output = step(route, state, {
      latitude,
      longitude,
      accuracyMeters: 5,
      speedMetersPerSecond: 8,
      timestampMilliseconds: second * 1000,
    });
    state = output.state;
    played.push(...audioClipIds(route, output.clipIds));
  }
  const nearCount = (direction: string) => played.filter((clipId) => clipId === `joined-near-${direction}`).length;
  assert.equal(nearCount('right'), 5, played.join(' '));
  assert.equal(nearCount('left'), 2);
  assert.equal(played[0], COMMON_CLIPS.start);
  assert.equal(played.at(-1), COMMON_CLIPS.arrive);
  assert.ok(!played.includes(COMMON_CLIPS.offRoute));
});
