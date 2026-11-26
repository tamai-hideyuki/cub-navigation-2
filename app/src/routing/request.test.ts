import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRouteRequest, formatJapanTime, summarizeRouteResponse } from './request.ts';

const OSAKA = { longitude: 135.4959, latitude: 34.7025 };
const KYOTO = { longitude: 135.7588, latitude: 34.9858 };

test('向きが無いときは heading を付けない', () => {
  const request = buildRouteRequest(OSAKA, KYOTO);
  assert.deepEqual(request.locations[0], { lon: 135.4959, lat: 34.7025 });
  assert.equal(request.costing, 'motorcycle');
  assert.equal(request.costing_options.motorcycle.use_highways, 1);
  assert.equal(request.costing_options.motorcycle.top_speed, 60);
});

test('出発の時刻をいつも付ける（時間帯の規制を見てもらうため）。日本の時刻で書く', () => {
  const request = buildRouteRequest(OSAKA, KYOTO, { departAt: new Date('2026-11-28T14:50:00Z') });
  assert.deepEqual(request.date_time, { type: 1, value: '2026-11-28T23:50' });
  const now = buildRouteRequest(OSAKA, KYOTO);
  assert.equal(now.date_time.type, 1);
  assert.match(now.date_time.value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test('日本の時刻にすると日付が変わる', () => {
  assert.equal(formatJapanTime(new Date('2026-11-28T15:30:00Z')), '2026-11-29T00:30');
  assert.equal(formatJapanTime(new Date('2026-12-31T23:59:00+09:00')), '2026-12-31T23:59');
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
