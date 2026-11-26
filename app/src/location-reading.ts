// expo-location の位置 → ナビに渡す形（純粋な関数）
import type { LocationObject } from 'expo-location';

import type { LocationReading } from './navigation/types.ts';

/** 速さが取れないとき iOS は負の値を返すので、null に直す */
export function toLocationReading(location: Pick<LocationObject, 'coords' | 'timestamp'>): LocationReading {
  const speed = location.coords.speed;
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracyMeters: location.coords.accuracy ?? null,
    speedMetersPerSecond: speed !== null && speed >= 0 ? speed : null,
    timestampMilliseconds: location.timestamp,
  };
}

/** 記録が大きくなりすぎないように、位置は interval 件ごとに1行だけ残す。今回の束でその区切りをまたいだか */
export function crossedLogInterval(readingCountAfter: number, batchSize: number, interval: number): boolean {
  return readingCountAfter % interval < batchSize;
}

export function roundedOrNull(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Math.round(value);
}
