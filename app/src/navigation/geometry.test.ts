import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cumulativeDistances,
  distanceMeters,
  METERS_PER_DEGREE_LATITUDE,
  metersPerDegreeLongitude,
  nearestPointOnSegment,
  pointAlongRoute,
} from './geometry.ts';

const METERS_PER_DEGREE_LONGITUDE_AT_35 = metersPerDegreeLongitude(35);

function close(actual: number, expected: number, tolerance: number): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} は ${expected} ±${tolerance} の外`);
}

test('distanceMeters: 東へ 1000m・北へ 1000m', () => {
  close(distanceMeters([139, 35], [139 + 1000 / METERS_PER_DEGREE_LONGITUDE_AT_35, 35]), 1000, 0.01);
  close(distanceMeters([139, 35], [139, 35 + 1000 / METERS_PER_DEGREE_LATITUDE]), 1000, 0.01);
  assert.equal(distanceMeters([139, 35], [139, 35]), 0);
});

test('nearestPointOnSegment: 線分の横・端の外・長さ 0 の線分', () => {
  const start: [number, number] = [139, 35];
  const end: [number, number] = [139 + 100 / METERS_PER_DEGREE_LONGITUDE_AT_35, 35];
  const beside = nearestPointOnSegment(
    [139 + 50 / METERS_PER_DEGREE_LONGITUDE_AT_35, 35 + 20 / METERS_PER_DEGREE_LATITUDE],
    start,
    end,
  );
  close(beside.distanceMeters, 20, 0.01);
  close(beside.fraction, 0.5, 0.0001);

  const beyondEnd = nearestPointOnSegment([139 + 130 / METERS_PER_DEGREE_LONGITUDE_AT_35, 35], start, end);
  assert.equal(beyondEnd.fraction, 1);
  close(beyondEnd.distanceMeters, 30, 0.01);

  const degenerate = nearestPointOnSegment([139, 35 + 10 / METERS_PER_DEGREE_LATITUDE], start, start);
  assert.equal(degenerate.fraction, 0);
  close(degenerate.distanceMeters, 10, 0.01);
});

test('cumulativeDistances と pointAlongRoute は互いに逆', () => {
  const geometry: [number, number][] = [
    [139, 35],
    [139 + 100 / METERS_PER_DEGREE_LONGITUDE_AT_35, 35],
    [139 + 100 / METERS_PER_DEGREE_LONGITUDE_AT_35, 35 + 200 / METERS_PER_DEGREE_LATITUDE],
  ];
  const cumulative = cumulativeDistances(geometry);
  close(cumulative[1], 100, 0.01);
  close(cumulative[2], 300, 0.01);

  const middle = pointAlongRoute(geometry, cumulative, 200);
  close(distanceMeters(middle, geometry[1]), 100, 0.01);
  assert.deepEqual(pointAlongRoute(geometry, cumulative, 0), geometry[0]);
  // 端を超えた距離は最後の線分の延長になる（今の動き）
  close(distanceMeters(pointAlongRoute(geometry, cumulative, 300), geometry[2]), 0, 0.01);
});
