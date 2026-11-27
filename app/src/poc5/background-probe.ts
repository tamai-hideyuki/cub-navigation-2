// PoC 5: 画面ロック中に、位置のタスクの中からルートを計算できるか（設計書 3 章・8 章）
// 位置が来るたびに、前の計算から PROBE_INTERVAL_MILLISECONDS 以上たっていれば1回計算し、結果を記録に残す。
// index.ts の一番上で読む（バックグラウンドで起こされたとき、画面より先にタスクが定義されている必要があるため）
import { File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { isOpen, memoryFootprintMegabytes, openTiles, route } from '../../modules/cub-routing';
import { toLocationReading } from '../location-reading';
import { writeLog } from '../log';
import { buildRouteRequest, summarizeRouteResponse } from '../routing/request';
import { FALLBACK_PAIR, isInsideArea, PLACES } from './places';

export const PROBE_TASK_NAME = 'cub-navigation-2-reroute-probe';

/** リルートの間隔の想定（設計書 3 章の仮の 30 秒より長め。記録が増えすぎないように） */
const PROBE_INTERVAL_MILLISECONDS = 60_000;

/** 端末の中のタイルの置き場所（Mac から xcrun でここに写す） */
export const TILE_EXTRACT_FILE = new File(Paths.document, 'valhalla_tiles.tar');

let lastProbeMilliseconds = 0;
let probing = false;

export async function ensureTilesOpen(): Promise<number | null> {
  if (isOpen()) return null;
  return openTiles(decodeURIComponent(TILE_EXTRACT_FILE.uri.replace('file://', '')));
}

async function probe(location: Location.LocationObject): Promise<void> {
  const reading = toLocationReading(location);
  const here = { longitude: reading.longitude, latitude: reading.latitude };
  const insideArea = isInsideArea(here);
  const origin = insideArea ? here : PLACES[FALLBACK_PAIR.from];
  const destination = PLACES[insideArea ? '京都駅' : FALLBACK_PAIR.to];
  const appState = AppState.currentState;
  const started = Date.now();
  try {
    const openMilliseconds = await ensureTilesOpen();
    const result = await route(
      buildRouteRequest(origin, destination, {
        headingDegrees: insideArea ? location.coords.heading : null,
      }),
    );
    const summary = summarizeRouteResponse(result.response);
    writeLog('probe-route', {
      appState,
      insideArea,
      openMilliseconds,
      routeMilliseconds: Math.round(result.milliseconds),
      wallMilliseconds: Date.now() - started,
      ...summary,
      memoryMegabytes: Math.round(memoryFootprintMegabytes()),
    });
  } catch (error) {
    writeLog('probe-error', {
      appState,
      insideArea,
      wallMilliseconds: Date.now() - started,
      message: String(error),
    });
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  PROBE_TASK_NAME,
  async ({ data, error }) => {
    if (error) {
      writeLog('probe-task-error', { message: error.message });
      return;
    }
    const latest = data?.locations?.at(-1);
    if (!latest || probing) return;
    if (latest.timestamp - lastProbeMilliseconds < PROBE_INTERVAL_MILLISECONDS) return;
    lastProbeMilliseconds = latest.timestamp;
    probing = true;
    try {
      await probe(latest);
    } finally {
      probing = false;
    }
  },
);

/**
 * 位置の許可を「常に」にしてもらう。
 * iOS で「使用中のみ」から「常に」に上げる確認は、答えが要求の戻りより遅れて届くことがある（PoC 5 のシミュレーターで起きた）。
 * そのため、すぐに許可されなかったら、少しのあいだ許可を確かめ直す
 */
async function requestAlwaysPermission(): Promise<boolean> {
  const requested = await Location.requestBackgroundPermissionsAsync();
  if (requested.status === 'granted') return true;
  for (let attempt = 0; attempt < ALWAYS_PERMISSION_RECHECK_COUNT; attempt++) {
    await new Promise((resolve) =>
      setTimeout(resolve, ALWAYS_PERMISSION_RECHECK_INTERVAL_MILLISECONDS),
    );
    if ((await Location.getBackgroundPermissionsAsync()).status === 'granted') return true;
  }
  return false;
}

const ALWAYS_PERMISSION_RECHECK_COUNT = 20;
const ALWAYS_PERMISSION_RECHECK_INTERVAL_MILLISECONDS = 500;

export async function startProbe(): Promise<void> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') throw new Error('位置の許可が無い');
  if (!(await requestAlwaysPermission())) throw new Error('位置の許可を「常に」にする');
  lastProbeMilliseconds = 0;
  await Location.startLocationUpdatesAsync(PROBE_TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    distanceInterval: 0,
  });
  writeLog('probe-start');
}

export async function stopProbe(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(PROBE_TASK_NAME)) {
    await Location.stopLocationUpdatesAsync(PROBE_TASK_NAME);
  }
  writeLog('probe-stop');
}

export async function isProbing(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(PROBE_TASK_NAME);
}
