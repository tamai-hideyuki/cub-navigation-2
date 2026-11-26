// テスト用の L 字のルート: 東へまっすぐ 1km → 北へ 1km（緯度 35 度付近）。角で左折、北の端で到着
import { cumulativeDistances, METERS_PER_DEGREE_LATITUDE, metersPerDegreeLongitude } from './geometry.ts';
import type { LocationReading, Route } from './types.ts';

const ORIGIN: [number, number] = [139.0, 35.0];
const METERS_PER_DEGREE_LONGITUDE = metersPerDegreeLongitude(ORIGIN[1]);

/** 原点から東へ・北へ何 m の所か → [経度, 緯度] */
export function offsetFromOrigin(eastMeters: number, northMeters: number): [number, number] {
  return [
    ORIGIN[0] + eastMeters / METERS_PER_DEGREE_LONGITUDE,
    ORIGIN[1] + northMeters / METERS_PER_DEGREE_LATITUDE,
  ];
}

function buildTestRoute(): Route {
  const geometry: [number, number][] = [];
  for (let east = 0; east <= 1000; east += 100) geometry.push(offsetFromOrigin(east, 0));
  for (let north = 100; north <= 1000; north += 100) geometry.push(offsetFromOrigin(1000, north));
  const cumulativeMeters = cumulativeDistances(geometry);
  return {
    schemaVersion: 1,
    name: 'テスト',
    totalMeters: cumulativeMeters[cumulativeMeters.length - 1],
    geometry: geometry,
    cumulativeMeters: cumulativeMeters,
    maneuvers: [
      {
        id: 'turn-000',
        distanceAlongMeters: cumulativeMeters[10],
        pointIndex: 10,
        direction: 'left',
        roadName: null,
        clips: { far: 'turn-000-far', near: 'turn-000-near' },
      },
      {
        id: 'turn-001',
        distanceAlongMeters: cumulativeMeters[20],
        pointIndex: 20,
        direction: 'arrive',
        roadName: null,
        clips: { near: 'common-arrive' },
      },
    ],
    source: { graphhopperVersion: 'test', osmDate: 'test', computedAt: 'test' },
  };
}

export const TEST_ROUTE = buildTestRoute();

/** 原点から東へ・北へ何 m の所の、second 秒目の位置（精度 5m） */
export function readingAt(eastMeters: number, northMeters: number, second: number): LocationReading {
  const [longitude, latitude] = offsetFromOrigin(eastMeters, northMeters);
  return {
    latitude: latitude,
    longitude: longitude,
    accuracyMeters: 5,
    speedMetersPerSecond: 10,
    timestampMilliseconds: second * 1000,
  };
}

/** L 字のルートの上を stepMeters ごとに進む点の列（道の中心から 3m ずれる） */
export function pathAlongTestRoute(stepMeters: number): [number, number][] {
  const points: [number, number][] = [];
  for (let east = 0; east <= 1000; east += stepMeters) points.push([east, 3]);
  for (let north = stepMeters; north <= 1000; north += stepMeters) points.push([997, north]);
  return points;
}

/**
 * 東へまっすぐ lengthMeters のルート（点は 100m ごと）。maneuverEveryMeters ごとに右折の印を置き、終わりで到着。
 * 長い途切れ・長い回り道のテスト用（形はまっすぐでも、曲がる地点の案内は道なりの距離で決まる）
 */
export function straightTestRoute(lengthMeters: number, maneuverEveryMeters: number): Route {
  const geometry: [number, number][] = [];
  for (let east = 0; east <= lengthMeters; east += 100) geometry.push(offsetFromOrigin(east, 0));
  const cumulativeMeters = cumulativeDistances(geometry);
  const maneuvers: Route['maneuvers'] = [];
  for (let along = maneuverEveryMeters; along < lengthMeters; along += maneuverEveryMeters) {
    const pointIndex = along / 100;
    const id = `turn-${String(maneuvers.length).padStart(3, '0')}`;
    maneuvers.push({
      id: id,
      distanceAlongMeters: cumulativeMeters[pointIndex],
      pointIndex: pointIndex,
      direction: 'right',
      roadName: null,
      clips: { far: `${id}-far`, near: `${id}-near` },
    });
  }
  const lastIndex = geometry.length - 1;
  maneuvers.push({
    id: 'turn-arrive',
    distanceAlongMeters: cumulativeMeters[lastIndex],
    pointIndex: lastIndex,
    direction: 'arrive',
    roadName: null,
    clips: { near: 'common-arrive' },
  });
  return {
    schemaVersion: 1,
    name: 'まっすぐのテスト',
    totalMeters: cumulativeMeters[lastIndex],
    geometry: geometry,
    cumulativeMeters: cumulativeMeters,
    maneuvers: maneuvers,
    source: { graphhopperVersion: 'test', osmDate: 'test', computedAt: 'straight' },
  };
}
