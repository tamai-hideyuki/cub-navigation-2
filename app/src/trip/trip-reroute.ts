// 計算し直した結果を、走行に当てはめる（設計書 3 章のリルート）。端末に依存しない（Node でテストできる）。
// 計算は await の間に時間がかかるので、その間に「停止」が押された（走行が無くなった）り、
// 別の走行が始まったりしていたら、当てはめない。止めたはずの走行が、目的地の無い形で戻ってしまうため
import { initialState } from '../navigation/navigator.ts';
import { COMMON_CLIPS, type Route } from '../navigation/types.ts';
import type { Trip } from './trip-runner.ts';

/** 計算し直し始めたときの走行と、今の走行が同じか（途中で止められた・入れ替わったなら false） */
export function isSameTrip(startedTrip: Trip, currentTrip: Trip | null): currentTrip is Trip {
  return currentTrip !== null && currentTrip === startedTrip;
}

/** 計算し直せたときの、新しい走行。途中で止められた・入れ替わったなら null（何も書かない） */
export function tripAfterReroute(
  startedTrip: Trip,
  currentTrip: Trip | null,
  planned: { route: Route; totalSeconds: number },
  readingTimestampMilliseconds: number,
): Trip | null {
  if (!isSameTrip(startedTrip, currentTrip)) return null;
  const state = initialState(planned.route);
  // 計算し直したときは「案内を始めます」を鳴らさず、「ルートを計算し直しました」を鳴らす
  return {
    ...currentTrip,
    route: planned.route,
    totalSeconds: planned.totalSeconds,
    state: { ...state, playedClipIds: [COMMON_CLIPS.start] },
    reroute: { lastAttemptMilliseconds: readingTimestampMilliseconds, lastAttemptFailed: false },
    rerouteCount: currentTrip.rerouteCount + 1,
    lastRerouteFailed: false,
  };
}

/** 計算し直せなかったときの、新しい走行。途中で止められた・入れ替わったなら null（何も書かない） */
export function tripAfterRerouteFailure(
  startedTrip: Trip,
  currentTrip: Trip | null,
  readingTimestampMilliseconds: number,
): Trip | null {
  if (!isSameTrip(startedTrip, currentTrip)) return null;
  return {
    ...currentTrip,
    reroute: { lastAttemptMilliseconds: readingTimestampMilliseconds, lastAttemptFailed: true },
    lastRerouteFailed: true,
  };
}
