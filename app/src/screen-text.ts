// 画面に出す文（純粋な関数）
import type {
  NavigationOutput,
  NavigationState,
  OffRouteStatus,
  Route,
} from './navigation/types.ts';

const OFF_ROUTE_LABELS: Record<OffRouteStatus, string> = {
  on: 'ルート上',
  suspect: '離れかけ',
  off: '外れている',
};

export function formatKilometers(meters: number | null): string {
  return meters === null ? '—' : `${(meters / 1000).toFixed(1)} km`;
}

type ScreenLines = {
  progress: string;
  routePosition: string;
  nextManeuver: string;
};

/** 進んだ距離・ルートとの位置・次の曲がる地点の3行 */
export function screenLines(
  route: Route,
  state: NavigationState,
  debug: NavigationOutput['debug'] | null,
): ScreenLines {
  const acquired = state.progress.acquired;
  const travelled = formatKilometers(acquired ? state.progress.distanceAlongMeters : null);

  const distanceToRoute = debug?.distanceToRouteMeters;
  const distanceText =
    distanceToRoute === null || distanceToRoute === undefined
      ? '—'
      : `${Math.round(distanceToRoute)} m`;
  const positionLabel = acquired ? OFF_ROUTE_LABELS[state.offRoute.status] : 'まだ合っていない';

  const nextManeuver = route.maneuvers.find((maneuver) => maneuver.id === debug?.nextManeuverId);
  const nextText = nextManeuver
    ? `${nextManeuver.roadName ?? ''} まで ${formatKilometers(debug?.remainingMeters ?? null)}`
    : '—';

  return {
    progress: `進んだ距離 ${travelled} / ${formatKilometers(route.totalMeters)}`,
    routePosition: `ルートとの位置 ${positionLabel}（${distanceText}）`,
    nextManeuver: `次 ${nextText}`,
  };
}
