// 保存したナビの状態の読み込み（純粋な関数）。ファイルの読み書きは navigation-runner.ts

import { initialState } from './navigator.ts';
import type { NavigationState, Route } from './types.ts';

const OFF_ROUTE_STATUSES = ['on', 'suspect', 'off'];

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNumberOrNull(value: unknown): boolean {
  return value === null || isNumber(value);
}

/** 今のアプリの NavigationState の形をしているか（アプリを更新して形が変わった古いファイルを弾く） */
export function isNavigationState(value: unknown): value is NavigationState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, any>;
  const progress = state.progress;
  const offRoute = state.offRoute;
  return (
    typeof state.routeComputedAt === 'string' &&
    typeof progress === 'object' &&
    progress !== null &&
    isNumber(progress.segmentIndex) &&
    isNumber(progress.distanceAlongMeters) &&
    typeof progress.acquired === 'boolean' &&
    typeof offRoute === 'object' &&
    offRoute !== null &&
    OFF_ROUTE_STATUSES.includes(offRoute.status) &&
    isNumber(offRoute.awayCount) &&
    isNumber(offRoute.backCount) &&
    isNumberOrNull(offRoute.lastWarningMilliseconds) &&
    Array.isArray(state.playedClipIds) &&
    state.playedClipIds.every((clipId: unknown) => typeof clipId === 'string') &&
    isNumberOrNull(state.lastReadingMilliseconds)
  );
}

/**
 * 保存した文字列から状態を戻す。読めない・形が違う・別のルートの状態なら、最初の状態にする
 * （ルートを作り直したら、前のルートの進み具合は意味がないため。最初の状態でも、位置が来ればルートの途中から合わせ直す）
 */
export function restoreState(savedText: string | null, route: Route): NavigationState {
  if (savedText === null) return initialState(route);
  try {
    const saved: unknown = JSON.parse(savedText);
    if (isNavigationState(saved) && saved.routeComputedAt === route.source.computedAt) return saved;
  } catch {
    // 壊れたファイルは捨てて最初から
  }
  return initialState(route);
}
