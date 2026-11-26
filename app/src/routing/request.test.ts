import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRouteRequest, summarizeRouteResponse } from './request.ts';

const OSAKA = { longitude: 135.4959, latitude: 34.7025 };
const KYOTO = { longitude: 135.7588, latitude: 34.9858 };

test('向きが無いときは heading を付けない', () => {
  const request = buildRouteRequest(OSAKA, KYOTO);
  assert.deepEqual(request.locations[0], { lon: 135.4959, lat: 34.7025 });
  assert.equal(request.costing, 'auto');
  assert.equal(request.costing_options.auto.use_highways, 1);
  assert.equal(request.costing_options.auto.top_speed, 60);
});

test('向きがあるときは出発地に heading を付ける（360 を超えたら回す・負の値は付けない）', () => {
  assert.deepEqual(buildRouteRequest(OSAKA, KYOTO, { headingDegrees: 370.4 }).locations[0], {
    lon: 135.4959,
    lat: 34.7025,
    heading: 10,
    heading_tolerance: 45,
  });
  assert.equal('heading' in buildRouteRequest(OSAKA, KYOTO, { headingDegrees: -1 }).locations[0], false);
  assert.equal('heading' in buildRouteRequest(OSAKA, KYOTO, { headingDegrees: null }).locations[0], false);
});

test('答えから距離・時間・曲がる所の数を取り出す', () => {
  const response = {
    trip: { summary: { length: 47.123, time: 5100 }, legs: [{ maneuvers: [{}, {}, {}] }, { maneuvers: [{}] }] },
  };
  assert.deepEqual(summarizeRouteResponse(response), { kilometers: 47.1, minutes: 85, maneuverCount: 4 });
  assert.throws(() => summarizeRouteResponse({}));
});
