// PoC 6: 画面ロック中に、位置のタスクの中から声をつないで鳴らせるか（設計書 4 章・8 章）
// 位置が来るたびに、前に鳴らしてから PROBE_INTERVAL_MILLISECONDS 以上たっていれば1回案内を鳴らす。
// 部品をつなぐ鳴らし方と、つないで作った声を交互に鳴らし、記録から鳴り始め・鳴り終わりの時刻を比べる。
// index.ts の一番上で読む（バックグラウンドで起こされたとき、画面より先にタスクが定義されている必要があるため）
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { enqueueClips } from '../clip-player';
import { writeLog } from '../log';
import type { TurnDirection } from '../navigation/types';
import { guidanceClips, type GuidanceDistance, type JoinMode } from '../voice/phrases';

export const VOICE_PROBE_TASK_NAME = 'cub-navigation-2-voice-probe';

const PROBE_INTERVAL_MILLISECONDS = 60_000;

/** 順に鳴らす案内（向きと距離を変えながら回す） */
const ROTATION: { distance: GuidanceDistance; direction: TurnDirection }[] = [
  { distance: 'far', direction: 'left' },
  { distance: 'near', direction: 'right' },
  { distance: 'far', direction: 'slight_right' },
  { distance: 'near', direction: 'keep_left' },
  { distance: 'far', direction: 'uturn' },
];

let lastProbeMilliseconds = 0;
let probeCount = 0;

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  VOICE_PROBE_TASK_NAME,
  async ({ data, error }) => {
    if (error) {
      writeLog('voice-probe-task-error', { message: error.message });
      return;
    }
    const latest = data?.locations?.at(-1);
    if (!latest || latest.timestamp - lastProbeMilliseconds < PROBE_INTERVAL_MILLISECONDS) return;
    lastProbeMilliseconds = latest.timestamp;
    const guidance = ROTATION[Math.floor(probeCount / 2) % ROTATION.length];
    const mode: JoinMode = probeCount % 2 === 0 ? 'parts' : 'joined';
    probeCount++;
    writeLog('voice-probe', { appState: AppState.currentState, mode, ...guidance });
    await enqueueClips(guidanceClips(guidance.distance, guidance.direction, mode));
  },
);

export async function startVoiceProbe(): Promise<void> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') throw new Error('位置の許可が無い');
  if ((await Location.getBackgroundPermissionsAsync()).status !== 'granted') {
    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== 'granted')
      throw new Error('位置の許可を「常に」にする（PoC 5 の画面で一度許可するとよい）');
  }
  lastProbeMilliseconds = 0;
  probeCount = 0;
  await Location.startLocationUpdatesAsync(VOICE_PROBE_TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    distanceInterval: 0,
  });
  writeLog('voice-probe-start');
}

export async function stopVoiceProbe(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(VOICE_PROBE_TASK_NAME)) {
    await Location.stopLocationUpdatesAsync(VOICE_PROBE_TASK_NAME);
  }
  writeLog('voice-probe-stop');
}

export async function isVoiceProbing(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(VOICE_PROBE_TASK_NAME);
}
