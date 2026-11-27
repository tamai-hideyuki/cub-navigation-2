// 距離の計算。数百km までの距離と、点と線分の最近点（その場の平面近似）

export const METERS_PER_DEGREE_LATITUDE = 110540;
const METERS_PER_DEGREE_LONGITUDE_AT_EQUATOR = 111320;

/** 経度1度の長さ（m）。緯度が高いほど短い */
export function metersPerDegreeLongitude(latitudeDegrees: number): number {
  return Math.cos((latitudeDegrees * Math.PI) / 180) * METERS_PER_DEGREE_LONGITUDE_AT_EQUATOR;
}

export type LongitudeLatitude = [number, number];

export function distanceMeters(pointA: LongitudeLatitude, pointB: LongitudeLatitude): number {
  const middleLatitudeRadians = (((pointA[1] + pointB[1]) / 2) * Math.PI) / 180;
  const eastMeters =
    (pointB[0] - pointA[0]) *
    Math.cos(middleLatitudeRadians) *
    METERS_PER_DEGREE_LONGITUDE_AT_EQUATOR;
  const northMeters = (pointB[1] - pointA[1]) * METERS_PER_DEGREE_LATITUDE;
  return Math.hypot(eastMeters, northMeters);
}

type NearestPointOnSegment = {
  distanceMeters: number;
  fraction: number; // 線分の始まりから終わりまでのどこか（0〜1）
};

export function nearestPointOnSegment(
  point: LongitudeLatitude,
  segmentStart: LongitudeLatitude,
  segmentEnd: LongitudeLatitude,
): NearestPointOnSegment {
  const metersPerLongitude = metersPerDegreeLongitude(point[1]);
  const toMeters = (coordinate: LongitudeLatitude): [number, number] => [
    coordinate[0] * metersPerLongitude,
    coordinate[1] * METERS_PER_DEGREE_LATITUDE,
  ];
  const [pointX, pointY] = toMeters(point);
  const [startX, startY] = toMeters(segmentStart);
  const [endX, endY] = toMeters(segmentEnd);
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const squaredLength = segmentX * segmentX + segmentY * segmentY;
  let fraction = 0;
  if (squaredLength > 0) {
    fraction = ((pointX - startX) * segmentX + (pointY - startY) * segmentY) / squaredLength;
    fraction = Math.max(0, Math.min(1, fraction));
  }
  return {
    distanceMeters: Math.hypot(
      pointX - startX - fraction * segmentX,
      pointY - startY - fraction * segmentY,
    ),
    fraction: fraction,
  };
}

/** 道なりの累積距離（geometry[i] までの距離）。最初は 0 */
export function cumulativeDistances(geometry: LongitudeLatitude[]): number[] {
  const distances = [0];
  for (let index = 1; index < geometry.length; index++) {
    distances.push(distances[index - 1] + distanceMeters(geometry[index - 1], geometry[index]));
  }
  return distances;
}

/** 道なりの距離 → その地点の座標（線分の中は直線で補う）。机上の走行テストで使う */
export function pointAlongRoute(
  geometry: LongitudeLatitude[],
  cumulativeMeters: number[],
  distanceAlongMeters: number,
): LongitudeLatitude {
  let segment = 0;
  while (
    segment < cumulativeMeters.length - 2 &&
    cumulativeMeters[segment + 1] < distanceAlongMeters
  )
    segment++;
  const segmentLength = cumulativeMeters[segment + 1] - cumulativeMeters[segment];
  const fraction =
    segmentLength === 0 ? 0 : (distanceAlongMeters - cumulativeMeters[segment]) / segmentLength;
  const [startLongitude, startLatitude] = geometry[segment];
  const [endLongitude, endLatitude] = geometry[segment + 1];
  return [
    startLongitude + (endLongitude - startLongitude) * fraction,
    startLatitude + (endLatitude - startLatitude) * fraction,
  ];
}
