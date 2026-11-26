// 走行中の画面に出すもの（設計書 5.1・5.2）を、ルートと進み具合から計算する。画面・端末に依存しない
import { pointAlongRoute } from './geometry.ts';
import type { Maneuver, NavigationState, Route, TurnDirection } from './types.ts';

export type ProgressView = {
  /** 通った所（灰色で描く） */
  passedCoordinates: [number, number][];
  /** この先（青で描く） */
  aheadCoordinates: [number, number][];
  /** 出発からの割合（0〜1）。進み具合の帯の丸 */
  fraction: number;
  remainingMeters: number;
  /** 残りの時間（Valhalla の見込みの時間を、残りの距離の割合で割り振る） */
  remainingSeconds: number;
  nextManeuver: { direction: TurnDirection; roadName: string | null; distanceMeters: number } | null;
  /** 曲がる所の位置（0〜1）。進み具合の帯の目盛り */
  maneuverFractions: number[];
};

/** ルートを、出発からの距離で2つに分ける。分ける点は両方に入れる（線がつながって見えるように） */
export function splitRoute(route: Route, distanceAlongMeters: number): { passed: [number, number][]; ahead: [number, number][] } {
  const along = Math.max(0, Math.min(distanceAlongMeters, route.totalMeters));
  const point = pointAlongRoute(route.geometry, route.cumulativeMeters, along) as [number, number];
  const firstAheadIndex = route.cumulativeMeters.findIndex((meters) => meters > along);
  if (firstAheadIndex === -1) return { passed: [...route.geometry, point], ahead: [point, point] };
  return {
    passed: [...route.geometry.slice(0, firstAheadIndex), point],
    ahead: [point, ...route.geometry.slice(firstAheadIndex)],
  };
}

export function progressView(route: Route, state: NavigationState, totalSeconds: number): ProgressView {
  const along = state.progress.acquired ? state.progress.distanceAlongMeters : 0;
  const { passed, ahead } = splitRoute(route, along);
  const remainingMeters = Math.max(0, route.totalMeters - along);
  const next: Maneuver | undefined = route.maneuvers.find((maneuver) => maneuver.distanceAlongMeters > along);
  return {
    passedCoordinates: passed,
    aheadCoordinates: ahead,
    fraction: route.totalMeters > 0 ? along / route.totalMeters : 0,
    remainingMeters,
    remainingSeconds: route.totalMeters > 0 ? (totalSeconds * remainingMeters) / route.totalMeters : 0,
    nextManeuver: next
      ? { direction: next.direction, roadName: next.roadName, distanceMeters: next.distanceAlongMeters - along }
      : null,
    maneuverFractions:
      route.totalMeters > 0 ? route.maneuvers.map((maneuver) => maneuver.distanceAlongMeters / route.totalMeters) : [],
  };
}

/** 次の曲がる所の帯に出す向きの文と矢印 */
export const DIRECTION_LABEL: Record<TurnDirection, { text: string; arrow: string }> = {
  left: { text: '左', arrow: '←' },
  right: { text: '右', arrow: '→' },
  slight_left: { text: '斜め左', arrow: '↖' },
  slight_right: { text: '斜め右', arrow: '↗' },
  sharp_left: { text: '大きく左', arrow: '↙' },
  sharp_right: { text: '大きく右', arrow: '↘' },
  keep_left: { text: '左側', arrow: '↖' },
  keep_right: { text: '右側', arrow: '↗' },
  uturn: { text: 'Uターン', arrow: '↶' },
  roundabout: { text: 'ロータリー', arrow: '↻' },
  arrive: { text: '目的地', arrow: '◎' },
};

/** 距離の書き方。1km 未満は 10m 単位、それより上は 0.1km 単位 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(0, Math.round(meters / 10) * 10)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

/** 時間の書き方。1時間未満は「n分」、それより上は「h時間m分」 */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}分`;
  return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
}

/** 着く時刻（HH:MM） */
export function formatArrival(nowMilliseconds: number, remainingSeconds: number): string {
  const arrival = new Date(nowMilliseconds + remainingSeconds * 1000);
  return `${String(arrival.getHours()).padStart(2, '0')}:${String(arrival.getMinutes()).padStart(2, '0')}`;
}
