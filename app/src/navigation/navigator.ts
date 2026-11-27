// 位置1件ごとに呼ぶナビの本体（設計書 4章）。状態を受け取って新しい状態と鳴らすクリップを返す。
// 中で時計を読まない（時刻は reading.timestampMilliseconds を使う）ので、GPX の再生で同じ結果になる

import { nearestPointOnSegment, type LongitudeLatitude } from './geometry.ts';
import {
  COMMON_CLIPS,
  DEFAULT_CONFIGURATION,
  type ClipId,
  type LocationReading,
  type NavigationConfiguration,
  type NavigationOutput,
  type NavigationState,
  type OffRouteState,
  type ProgressState,
  type Route,
} from './types.ts';

export function initialState(route: Route): NavigationState {
  return {
    routeComputedAt: route.source.computedAt,
    progress: { segmentIndex: 0, distanceAlongMeters: 0, acquired: false },
    offRoute: { status: 'on', awayCount: 0, backCount: 0, lastWarningMilliseconds: null },
    playedClipIds: [],
    lastReadingMilliseconds: null,
  };
}

type NearestOnRoute = { segmentIndex: number; distanceAlongMeters: number; distanceMeters: number };

/** segmentIndex から、道なりで limitMeters までの区間の中で一番近い所 */
export function findNearestOnRoute(
  route: Route,
  point: LongitudeLatitude,
  firstSegment: number,
  limitMeters: number,
): NearestOnRoute | null {
  let nearest: NearestOnRoute | null = null;
  const lastSegment = route.geometry.length - 2;
  for (let segment = firstSegment; segment <= lastSegment; segment++) {
    if (route.cumulativeMeters[segment] > limitMeters) break;
    const result = nearestPointOnSegment(
      point,
      route.geometry[segment],
      route.geometry[segment + 1],
    );
    if (nearest === null || result.distanceMeters < nearest.distanceMeters) {
      const segmentLength = route.cumulativeMeters[segment + 1] - route.cumulativeMeters[segment];
      nearest = {
        segmentIndex: segment,
        distanceAlongMeters: route.cumulativeMeters[segment] + segmentLength * result.fraction,
        distanceMeters: result.distanceMeters,
      };
    }
  }
  return nearest;
}

function progressAt(nearest: NearestOnRoute): ProgressState {
  return {
    segmentIndex: nearest.segmentIndex,
    distanceAlongMeters: nearest.distanceAlongMeters,
    acquired: true,
  };
}

type ProgressSearch = {
  /** ルートから外れている（近くで見つからなければ、ルートの先全体から探す） */
  isOffRoute: boolean;
  /** 位置が長く途切れた後（トンネル・アプリの再起動。その間に何 km 進んだかわからない） */
  afterLongGap: boolean;
};

/**
 * 4.1 進捗。前にしか進まない。ルートから離れている間は進めない（離れた所の最近点へ飛ばないため）。
 * ふだんは今の所から searchAheadMeters 先までを探す。外れている・長く途切れた後で、そこに見つからなければ、
 * ルートの先全体から探す（途切れた間にどれだけ進んでも合わせ直せるように）
 */
export function updateProgress(
  route: Route,
  progress: ProgressState,
  point: LongitudeLatitude,
  search: ProgressSearch,
  configuration: NavigationConfiguration,
): { progress: ProgressState; distanceToRouteMeters: number | null } {
  const isOnRoute = (nearest: NearestOnRoute) =>
    nearest.distanceMeters <= configuration.offRouteMeters;

  if (!progress.acquired) {
    const nearest = findNearestOnRoute(route, point, 0, Infinity);
    if (nearest === null) return { progress: progress, distanceToRouteMeters: null };
    return {
      progress: isOnRoute(nearest) ? progressAt(nearest) : progress,
      distanceToRouteMeters: nearest.distanceMeters,
    };
  }

  let nearest = findNearestOnRoute(
    route,
    point,
    progress.segmentIndex,
    progress.distanceAlongMeters + configuration.searchAheadMeters,
  );
  if ((nearest === null || !isOnRoute(nearest)) && (search.isOffRoute || search.afterLongGap)) {
    const wholeRouteAhead = findNearestOnRoute(route, point, progress.segmentIndex, Infinity);
    if (wholeRouteAhead !== null && isOnRoute(wholeRouteAhead)) nearest = wholeRouteAhead;
  }
  if (nearest === null) return { progress: progress, distanceToRouteMeters: null };

  const movesForward = nearest.distanceAlongMeters >= progress.distanceAlongMeters;
  return {
    progress: isOnRoute(nearest) && movesForward ? progressAt(nearest) : progress,
    distanceToRouteMeters: nearest.distanceMeters,
  };
}

/** 4.2 外れの判定。続けて離れたら警告し、外れたままなら1分ごとに繰り返す */
export function updateOffRoute(
  offRoute: OffRouteState,
  distanceToRouteMeters: number,
  readingMilliseconds: number,
  configuration: NavigationConfiguration,
): { offRoute: OffRouteState; clipIds: ClipId[] } {
  const next = { ...offRoute };
  if (distanceToRouteMeters > configuration.offRouteMeters) {
    next.awayCount += 1;
    next.backCount = 0;
  } else if (distanceToRouteMeters < configuration.onRouteMeters) {
    next.backCount += 1;
    next.awayCount = 0;
  }

  if (next.status !== 'off' && next.awayCount >= configuration.offRouteCount) {
    next.status = 'off';
    next.lastWarningMilliseconds = readingMilliseconds;
    return { offRoute: next, clipIds: [COMMON_CLIPS.offRoute] };
  }
  if (next.status === 'off' && next.backCount >= configuration.onRouteCount) {
    next.status = 'on';
    return { offRoute: next, clipIds: [COMMON_CLIPS.onRoute] };
  }
  if (
    next.status === 'off' &&
    next.lastWarningMilliseconds !== null &&
    readingMilliseconds - next.lastWarningMilliseconds >= configuration.offRouteRepeatMilliseconds
  ) {
    next.lastWarningMilliseconds = readingMilliseconds;
    return { offRoute: next, clipIds: [COMMON_CLIPS.offRoute] };
  }
  if (next.status === 'on' && next.awayCount > 0) next.status = 'suspect';
  if (next.status === 'suspect' && next.awayCount === 0) next.status = 'on';
  return { offRoute: next, clipIds: [] };
}

/** 4.3 案内。次の曲がる地点の手前 300m（far）と 50m（near）で鳴らす */
export function updateAnnouncements(
  route: Route,
  progress: ProgressState,
  playedClipIds: Set<ClipId>,
  configuration: NavigationConfiguration,
): { clipIds: ClipId[]; nextManeuverId: string | null; remainingMeters: number | null } {
  const maneuver = route.maneuvers.find(
    (candidate) =>
      candidate.distanceAlongMeters >
        progress.distanceAlongMeters - configuration.nearAnnouncementMinimumMeters &&
      !playedClipIds.has(candidate.clips.near),
  );
  if (maneuver === undefined) return { clipIds: [], nextManeuverId: null, remainingMeters: null };

  const remainingMeters = maneuver.distanceAlongMeters - progress.distanceAlongMeters;
  const clipIds: ClipId[] = [];
  const far = maneuver.clips.far;
  if (
    far !== undefined &&
    !playedClipIds.has(far) &&
    remainingMeters <= configuration.farAnnouncementMeters &&
    remainingMeters > configuration.nearAnnouncementMeters * 2
  ) {
    clipIds.push(far);
  }
  if (remainingMeters <= configuration.nearAnnouncementMeters) {
    clipIds.push(maneuver.clips.near);
  }
  return { clipIds: clipIds, nextManeuverId: maneuver.id, remainingMeters: remainingMeters };
}

export function step(
  route: Route,
  state: NavigationState,
  reading: LocationReading,
  configurationOverrides: Partial<NavigationConfiguration> = {},
): NavigationOutput {
  const configuration = { ...DEFAULT_CONFIGURATION, ...configurationOverrides };
  const emptyDebug = { distanceToRouteMeters: null, nextManeuverId: null, remainingMeters: null };

  // 精度の悪い位置は使わない（トンネル・ビルの谷間）
  if (
    reading.accuracyMeters !== null &&
    reading.accuracyMeters > configuration.maximumAccuracyMeters
  ) {
    return { state: state, clipIds: [], debug: emptyDebug };
  }

  const point: LongitudeLatitude = [reading.longitude, reading.latitude];
  const wasAcquired = state.progress.acquired;
  const afterLongGap =
    state.lastReadingMilliseconds !== null &&
    reading.timestampMilliseconds - state.lastReadingMilliseconds >=
      configuration.readingGapMilliseconds;
  const progressResult = updateProgress(
    route,
    state.progress,
    point,
    { isOffRoute: state.offRoute.status === 'off', afterLongGap: afterLongGap },
    configuration,
  );
  const distanceToRouteMeters = progressResult.distanceToRouteMeters;

  const clipIds: ClipId[] = [];
  const playedClipIds = new Set(state.playedClipIds);
  let offRoute = state.offRoute;

  if (!wasAcquired && progressResult.progress.acquired && !playedClipIds.has(COMMON_CLIPS.start)) {
    clipIds.push(COMMON_CLIPS.start);
  }

  // まだルートに乗っていない間（出発前・再起動の直後）と、着いた後は外れの警告をしない
  const hasArrived = playedClipIds.has(COMMON_CLIPS.arrive);
  if (progressResult.progress.acquired && !hasArrived && distanceToRouteMeters !== null) {
    const offRouteResult = updateOffRoute(
      offRoute,
      distanceToRouteMeters,
      reading.timestampMilliseconds,
      configuration,
    );
    offRoute = offRouteResult.offRoute;
    clipIds.push(...offRouteResult.clipIds);
  }

  let debug: NavigationOutput['debug'] = {
    ...emptyDebug,
    distanceToRouteMeters: distanceToRouteMeters,
  };
  if (progressResult.progress.acquired && offRoute.status !== 'off') {
    const announcement = updateAnnouncements(
      route,
      progressResult.progress,
      playedClipIds,
      configuration,
    );
    clipIds.push(...announcement.clipIds);
    debug = {
      ...debug,
      nextManeuverId: announcement.nextManeuverId,
      remainingMeters: announcement.remainingMeters,
    };
  }

  // 繰り返す警告（offroute・onroute）は記録しない。曲がる案内・開始は一度だけ
  for (const clipId of clipIds) {
    if (clipId !== COMMON_CLIPS.offRoute && clipId !== COMMON_CLIPS.onRoute)
      playedClipIds.add(clipId);
  }

  return {
    state: {
      routeComputedAt: state.routeComputedAt,
      progress: progressResult.progress,
      offRoute: offRoute,
      playedClipIds: [...playedClipIds],
      lastReadingMilliseconds: reading.timestampMilliseconds,
    },
    clipIds: clipIds,
    debug: debug,
  };
}
