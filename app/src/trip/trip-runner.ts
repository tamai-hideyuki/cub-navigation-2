// 走行（目的地までの1回の案内）を動かす（設計書 1 章の「位置のタスク」と 3 章のリルート）。
// 位置が来るたびにナビの本体を進め、声を鳴らし、外れが確かになったら現在地から計算し直す。
// ルートと進み具合はファイルに残す（アプリが落ちても、開き直せば続きから案内する）。
// index.ts の一番上で読む（バックグラウンドで起こされたとき、画面より先にタスクが定義されている必要があるため）
import { File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { isOpen, openTiles, route as routeOnDevice } from '../../modules/cub-routing';
import { enqueueClips, prepareAudio } from '../clip-player';
import { installedOsmDate } from '../data/manifest';
import { toLocationReading } from '../location-reading';
import { writeLog } from '../log';
import { initialState, step } from '../navigation/navigator';
import { EMPTY_REROUTE_HISTORY, shouldReroute, type RerouteHistory } from '../navigation/reroute-policy';
import { isNavigationState } from '../navigation/saved-state';
import { COMMON_CLIPS, type LocationReading, type NavigationState, type Route } from '../navigation/types';
import { buildRouteRequest, summarizeRouteResponse, type Coordinate } from '../routing/request';
import { audioClipIds, routeFromValhalla } from '../routing/route-from-valhalla';

export const TRIP_TASK_NAME = 'cub-navigation-2-trip';

/** 端末の中のタイル（Mac から tools/install-data.sh で写す。設計書 9 章） */
export const TILE_EXTRACT_FILE = new File(Paths.document, 'valhalla_tiles.tar');
const ROUTE_FILE = new File(Paths.document, 'trip-route.json');
const STATE_FILE = new File(Paths.document, 'trip-state.json');

/** 着いてからこの時間たったら、位置の取得を止める（電池のため）。画面は「着きました」のまま */
const STOP_AFTER_ARRIVAL_MILLISECONDS = 120_000;

export type PlannedRoute = { route: Route; totalSeconds: number };

export type Trip = {
  destination: Coordinate;
  route: Route;
  /** Valhalla の見込みの時間（秒）。残りの時間はこれを残りの距離で割り振る */
  totalSeconds: number;
  state: NavigationState;
  reroute: RerouteHistory;
  rerouteCount: number;
  arrived: boolean;
  arrivedAtMilliseconds: number | null;
  /** 最後に計算し直せなかったとき true（画面の帯を赤にする） */
  lastRerouteFailed: boolean;
};

/** ルートが見つからない（行けない・範囲の外）。Valhalla の 442 など */
export class NoRouteError extends Error {}

let trip: Trip | null = null;
let routeCounter = 0;
let busy = false;
/** 走行の途中で地図が新しくなった（Mac から写し直した）。次の位置で計算し直す */
let mapChanged = false;

async function ensureTilesOpen(): Promise<void> {
  if (isOpen()) return;
  if (!TILE_EXTRACT_FILE.exists) throw new Error('ルート用のタイルが無い（Documents/valhalla_tiles.tar）');
  await openTiles(decodeURIComponent(TILE_EXTRACT_FILE.uri.replace('file://', '')));
}

/** origin から destination までのルートを、端末の中で計算する */
export async function planRoute(
  origin: Coordinate,
  destination: Coordinate,
  headingDegrees: number | null = null,
): Promise<PlannedRoute> {
  await ensureTilesOpen();
  let result;
  try {
    result = await routeOnDevice(buildRouteRequest(origin, destination, { headingDegrees }));
  } catch (error) {
    const message = String(error);
    if (/442|No path|No suitable edges|outside/i.test(message)) throw new NoRouteError(message);
    throw error;
  }
  routeCounter++;
  const route = routeFromValhalla(result.response, '目的地まで', {
    engine: 'valhalla',
    osmDate: installedOsmDate(),
    computedAt: `${new Date().toISOString()}#${routeCounter}`,
  });
  writeLog('route-planned', {
    kilometers: Math.round(route.totalMeters / 100) / 10,
    maneuvers: route.maneuvers.length,
    milliseconds: Math.round(result.milliseconds),
  });
  return { route, totalSeconds: summarizeRouteResponse(result.response).minutes * 60 };
}

function saveRoute(): void {
  if (!trip) return;
  try {
    if (!ROUTE_FILE.exists) ROUTE_FILE.create();
    ROUTE_FILE.write(
      JSON.stringify({ destination: trip.destination, route: trip.route, totalSeconds: trip.totalSeconds }),
    );
  } catch (error) {
    writeLog('trip-route-write-error', { message: String(error) });
  }
}

function saveState(): void {
  if (!trip) return;
  try {
    if (!STATE_FILE.exists) STATE_FILE.create();
    STATE_FILE.write(
      JSON.stringify({
        state: trip.state,
        reroute: trip.reroute,
        rerouteCount: trip.rerouteCount,
        arrived: trip.arrived,
        arrivedAtMilliseconds: trip.arrivedAtMilliseconds,
        lastRerouteFailed: trip.lastRerouteFailed,
      }),
    );
  } catch (error) {
    writeLog('trip-state-write-error', { message: String(error) });
  }
}

/** アプリが起こし直されたとき、ファイルから走行を戻す */
function loadTrip(): Trip | null {
  if (trip) return trip;
  try {
    if (!ROUTE_FILE.exists) return null;
    const saved = JSON.parse(ROUTE_FILE.textSync());
    const route: Route = saved.route;
    let state = initialState(route);
    let rest: Partial<Trip> = {};
    if (STATE_FILE.exists) {
      const savedState = JSON.parse(STATE_FILE.textSync());
      if (isNavigationState(savedState.state) && savedState.state.routeComputedAt === route.source.computedAt) {
        state = savedState.state;
        rest = savedState;
      }
    }
    trip = {
      destination: saved.destination,
      route,
      totalSeconds: saved.totalSeconds,
      state,
      reroute: rest.reroute ?? EMPTY_REROUTE_HISTORY,
      rerouteCount: rest.rerouteCount ?? 0,
      arrived: rest.arrived ?? false,
      arrivedAtMilliseconds: rest.arrivedAtMilliseconds ?? null,
      lastRerouteFailed: rest.lastRerouteFailed ?? false,
    };
    // 保存したルートが前の地図で引いたものなら、新しい地図で引き直す（設計書 9.3）
    mapChanged = !trip.arrived && route.source.engine === 'valhalla' && route.source.osmDate !== installedOsmDate();
    if (mapChanged) writeLog('trip-map-changed', { routeOsmDate: route.source.osmDate });
    return trip;
  } catch (error) {
    writeLog('trip-read-error', { message: String(error) });
    return null;
  }
}

async function reroute(reading: LocationReading, headingDegrees: number | null): Promise<void> {
  if (!trip) return;
  const started = Date.now();
  try {
    const planned = await planRoute(
      { longitude: reading.longitude, latitude: reading.latitude },
      trip.destination,
      headingDegrees,
    );
    const state = initialState(planned.route);
    // 計算し直したときは「案内を始めます」を鳴らさず、「ルートを計算し直しました」を鳴らす
    trip = {
      ...trip,
      route: planned.route,
      totalSeconds: planned.totalSeconds,
      state: { ...state, playedClipIds: [COMMON_CLIPS.start] },
      reroute: { lastAttemptMilliseconds: reading.timestampMilliseconds, lastAttemptFailed: false },
      rerouteCount: trip.rerouteCount + 1,
      lastRerouteFailed: false,
    };
    saveRoute();
    writeLog('reroute', { milliseconds: Date.now() - started, count: trip.rerouteCount, appState: AppState.currentState });
    await enqueueClips(['common-rerouted']);
  } catch (error) {
    trip = {
      ...trip,
      reroute: { lastAttemptMilliseconds: reading.timestampMilliseconds, lastAttemptFailed: true },
      lastRerouteFailed: true,
    };
    writeLog('reroute-error', { message: String(error), appState: AppState.currentState });
    await enqueueClips(['common-no-route']);
  }
}

async function handleLocations(locations: Location.LocationObject[]): Promise<void> {
  const current = loadTrip();
  if (!current || busy) return;
  busy = true;
  try {
    for (const location of locations) {
      if (!trip) break;
      const reading = toLocationReading(location);
      const output = step(trip.route, trip.state, reading);
      const audio = audioClipIds(trip.route, output.clipIds);
      const justArrived = !trip.arrived && audio.includes(COMMON_CLIPS.arrive);
      trip = {
        ...trip,
        state: output.state,
        arrived: trip.arrived || justArrived,
        arrivedAtMilliseconds: justArrived ? reading.timestampMilliseconds : trip.arrivedAtMilliseconds,
      };
      if (audio.length > 0) {
        writeLog('announce', {
          clipIds: audio,
          nextManeuverId: output.debug.nextManeuverId,
          appState: AppState.currentState,
        });
        await enqueueClips(audio);
      }
      if (
        trip.arrivedAtMilliseconds !== null &&
        reading.timestampMilliseconds - trip.arrivedAtMilliseconds >= STOP_AFTER_ARRIVAL_MILLISECONDS
      ) {
        await stopLocationUpdates();
        writeLog('trip-location-stopped-after-arrival');
        break;
      }
      if (mapChanged || shouldReroute(trip.state, trip.reroute, reading.timestampMilliseconds, trip.arrived)) {
        mapChanged = false;
        const heading = location.coords.heading;
        await reroute(reading, heading !== null && heading >= 0 ? heading : null);
      }
    }
    saveState();
  } finally {
    busy = false;
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TRIP_TASK_NAME, async ({ data, error }) => {
  if (error) {
    writeLog('trip-task-error', { message: error.message });
    return;
  }
  if (data?.locations?.length) await handleLocations(data.locations);
});

/** 案内を始める。ルートは planRoute で引いたもの */
export async function startTrip(destination: Coordinate, planned: PlannedRoute): Promise<void> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') throw new Error('位置の許可が無い');
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted' && (await Location.getBackgroundPermissionsAsync()).status !== 'granted') {
    throw new Error('位置の許可を「常に」にする（画面ロック中も案内するため）');
  }
  await prepareAudio();
  trip = {
    destination,
    route: planned.route,
    totalSeconds: planned.totalSeconds,
    state: initialState(planned.route),
    reroute: EMPTY_REROUTE_HISTORY,
    rerouteCount: 0,
    arrived: false,
    arrivedAtMilliseconds: null,
    lastRerouteFailed: false,
  };
  saveRoute();
  saveState();
  await startLocationUpdates();
  writeLog('trip-start', { kilometers: Math.round(planned.route.totalMeters / 100) / 10 });
}

async function startLocationUpdates(): Promise<void> {
  await Location.startLocationUpdatesAsync(TRIP_TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    distanceInterval: 0,
  });
}

/**
 * アプリを開き直したとき、走行の途中なら位置の取得を始め直す。
 * アプリを上に払って終わらせると、iOS が位置の取得を止めることがあるため
 */
export async function resumeTripIfNeeded(): Promise<void> {
  const current = loadTrip();
  if (!current || current.arrived) return;
  if (await Location.hasStartedLocationUpdatesAsync(TRIP_TASK_NAME)) return;
  await prepareAudio();
  await startLocationUpdates();
  writeLog('trip-resume');
}

async function stopLocationUpdates(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(TRIP_TASK_NAME)) {
    await Location.stopLocationUpdatesAsync(TRIP_TASK_NAME);
  }
}

export async function stopTrip(): Promise<void> {
  await stopLocationUpdates();
  trip = null;
  for (const file of [ROUTE_FILE, STATE_FILE]) {
    try {
      if (file.exists) file.delete();
    } catch {
      // 消せなくても次の startTrip で上書きする
    }
  }
  writeLog('trip-stop');
}

/** 画面に出すための、今の走行（無ければ null） */
export function currentTrip(): Trip | null {
  return loadTrip();
}

/** 走行の記録があるか（アプリを開き直したときに、走行中の画面に戻すため。着いた後も「停止」を押すまでは戻す） */
export async function isTripRunning(): Promise<boolean> {
  return loadTrip() !== null;
}
