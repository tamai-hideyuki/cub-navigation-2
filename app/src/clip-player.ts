// 案内を順に鳴らす（設計書 2.3 の ClipPlayer）。鳴らしている間に来たものは後ろに並べる。
// 音声モードは PoC 1 で確かめたもの: バックグラウンドで鳴らし、他のアプリの音楽を小さくする（duckOthers）
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import { CLIP_ASSETS } from './clip-assets';
import { ClipQueue, DEFAULT_CLIP_QUEUE_OPTIONS } from './clip-queue';
import { writeLog } from './log';

let player: AudioPlayer | null = null;
let audioModeReady = false;
let currentClipId: string | null = null;

export async function prepareAudio(): Promise<void> {
  if (audioModeReady) return;
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'duckOthers',
  });
  audioModeReady = true;
}

function startPlayback(clipId: string): 'started' | 'skipped' {
  const asset = CLIP_ASSETS[clipId];
  if (asset === undefined) {
    writeLog('clip-missing', { clipId: clipId });
    return 'skipped';
  }
  try {
    if (player === null) {
      player = createAudioPlayer(asset);
      player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) {
          // つなぎ目の間（鳴り終わり → 次の鳴り始め）を記録から測れるように、鳴り終わりも残す（PoC 6）
          writeLog('clip-finish', { clipId: currentClipId });
          queue.finished();
        }
      });
    } else {
      player.replace(asset);
    }
    player.play();
    currentClipId = clipId;
    writeLog('clip-play', { clipId: clipId });
    return 'started';
  } catch (error) {
    writeLog('clip-error', { clipId: clipId, message: String(error) });
    return 'skipped';
  }
}

const queue = new ClipQueue(
  startPlayback,
  {
    now: () => Date.now(),
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  {
    ...DEFAULT_CLIP_QUEUE_OPTIONS,
    onDropped: (clipId, reason) => {
      writeLog('clip-dropped', { clipId: clipId, reason: reason });
      if (reason === 'timeout') player?.pause(); // 詰まった再生を止めてから次へ
    },
  },
);

export async function enqueueClips(clipIds: string[]): Promise<void> {
  if (clipIds.length === 0) return;
  await prepareAudio();
  queue.enqueue(clipIds);
}
