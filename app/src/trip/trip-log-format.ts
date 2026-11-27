// 走行ごとの記録（Documents/logs/<出発の日時>.jsonl）の書式（設計書 3.1）。端末に依存しない（Node でテストできる）。
// 後で何を調べたくなっても困らないように、届いたものは加工せずに残す。ファイルに書くのは trip-log.ts
import { distanceMeters } from '../navigation/geometry.ts';
import type { NavigationOutput, NavigationState, Route } from '../navigation/types.ts';

/** 記録の形の版。項目の意味を変えたら上げる（足すだけなら上げない） */
export const TRIP_LOG_SCHEMA_VERSION = 1;

/** 出発の日時（日本の時刻）から、記録のファイル名を作る。例 2026-11-27-130301.jsonl */
export function tripLogFileName(startedAt: Date): string {
  const japan = new Date(startedAt.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${japan.slice(0, 10)}-${japan.slice(11, 19).replaceAll(':', '')}.jsonl`;
}

/** ルートの始まり（Valhalla が道に合わせた出発点）が、頼んだ出発点から何 m 離れているか */
export function routeStartOffsetMeters(
  origin: { longitude: number; latitude: number },
  route: Route,
): number | null {
  const start = route.geometry[0];
  if (start === undefined) return null;
  return Math.round(distanceMeters([origin.longitude, origin.latitude], start) * 10) / 10;
}

/** ルートの中身（曲がる所はすべて）。形は Valhalla の答え（shape）にあるので、ここでは持たない */
export function routeRecord(route: Route) {
  return {
    computedAt: route.source.computedAt,
    osmDate: route.source.osmDate,
    totalMeters: route.totalMeters,
    points: route.geometry.length,
    maneuvers: route.maneuvers.map((maneuver) => ({
      id: maneuver.id,
      distanceAlongMeters: maneuver.distanceAlongMeters,
      direction: maneuver.direction,
      roadName: maneuver.roadName,
    })),
  };
}

/** 位置1件ごとの、ナビの判断の中身（前の状態 → 次の状態） */
export function navigationRecord(before: NavigationState, output: NavigationOutput) {
  const after = output.state;
  return {
    routeComputedAt: after.routeComputedAt,
    used: after.lastReadingMilliseconds !== before.lastReadingMilliseconds,
    progress: after.progress,
    offRoute: after.offRoute,
    playedClipCount: after.playedClipIds.length,
    clipIds: output.clipIds,
    ...output.debug,
  };
}
