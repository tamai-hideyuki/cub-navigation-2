// リルートするかどうかを決める（設計書 3 章）。画面・端末に依存しない
import type { NavigationState } from './types.ts';

export type RerouteConfiguration = {
  /** 前のリルートから、これより短い間はしない（寄り道・駐車場の中で何度も計算しないため） */
  minimumIntervalMilliseconds: number;
  /** 続けて失敗した（ルートが見つからない）ときは、これより短い間はやり直さない */
  retryAfterFailureMilliseconds: number;
};

export const DEFAULT_REROUTE_CONFIGURATION: RerouteConfiguration = {
  minimumIntervalMilliseconds: 30_000,
  retryAfterFailureMilliseconds: 60_000,
};

export type RerouteHistory = {
  lastAttemptMilliseconds: number | null;
  lastAttemptFailed: boolean;
};

export const EMPTY_REROUTE_HISTORY: RerouteHistory = {
  lastAttemptMilliseconds: null,
  lastAttemptFailed: false,
};

/** 外れが確かになって（navigator の offRoute が 'off'）、前の計算から間が空いていればリルートする。着いた後はしない */
export function shouldReroute(
  state: NavigationState,
  history: RerouteHistory,
  nowMilliseconds: number,
  hasArrived: boolean,
  configuration: RerouteConfiguration = DEFAULT_REROUTE_CONFIGURATION,
): boolean {
  if (hasArrived || state.offRoute.status !== 'off') return false;
  if (history.lastAttemptMilliseconds === null) return true;
  const waitMilliseconds = history.lastAttemptFailed
    ? configuration.retryAfterFailureMilliseconds
    : configuration.minimumIntervalMilliseconds;
  return nowMilliseconds - history.lastAttemptMilliseconds >= waitMilliseconds;
}
