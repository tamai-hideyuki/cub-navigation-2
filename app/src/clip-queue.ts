// 案内を順に鳴らすための順番待ち。再生の仕方・時計・タイマーは外から渡す（テストでは本物の音や時計を使わない）

type StartPlayback = (clipId: string) => 'started' | 'skipped';

export type ClipQueueTimer = {
  now: () => number;
  setTimeout: (callback: () => void, milliseconds: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

type ClipQueueOptions = {
  /** 鳴らし始めてからこの時間たっても「鳴り終わった」が来なければ、次へ進む（電話・Siri で音を取られたとき等） */
  playbackTimeoutMilliseconds: number;
  /** 並んでからこの時間たった案内は鳴らさずに捨てる（交差点を過ぎてから「まもなく左」を鳴らさない） */
  staleAfterMilliseconds: number;
  /** 捨てた・飛ばしたことを記録する */
  onDropped?: (clipId: string, reason: 'stale' | 'timeout') => void;
};

export const DEFAULT_CLIP_QUEUE_OPTIONS: ClipQueueOptions = {
  playbackTimeoutMilliseconds: 10000, // 案内の音声は長くて5秒ほど
  staleAfterMilliseconds: 20000,
};

type WaitingClip = { clipId: string; enqueuedMilliseconds: number };

export class ClipQueue {
  private readonly waitingClips: WaitingClip[] = [];
  private readonly startPlayback: StartPlayback;
  private readonly timer: ClipQueueTimer;
  private readonly options: ClipQueueOptions;
  private currentClipId: string | null = null;
  private currentStartedMilliseconds = 0;
  private playbackTimeoutHandle: unknown = null;

  constructor(startPlayback: StartPlayback, timer: ClipQueueTimer, options: ClipQueueOptions) {
    this.startPlayback = startPlayback;
    this.timer = timer;
    this.options = options;
  }

  get isPlaying(): boolean {
    return this.currentClipId !== null;
  }

  get waitingCount(): number {
    return this.waitingClips.length;
  }

  /** 後ろに並べる。何も鳴っていなければすぐ鳴らす */
  enqueue(clipIds: string[]): void {
    const enqueuedMilliseconds = this.timer.now();
    for (const clipId of clipIds) {
      this.waitingClips.push({ clipId: clipId, enqueuedMilliseconds: enqueuedMilliseconds });
    }
    // バックグラウンドではタイマーが遅れることがあるので、並べるときにも打ち切りの時間を過ぎていないかを見る
    if (this.currentClipId !== null && this.hasPlaybackTimedOut(enqueuedMilliseconds)) {
      this.timeOutCurrentPlayback();
      return;
    }
    if (!this.isPlaying) this.playNext();
  }

  /** 1つ鳴り終わったときに呼ぶ */
  finished(): void {
    this.stopPlaybackTimeout();
    this.currentClipId = null;
    this.playNext();
  }

  /** 次を鳴らす。古くなった案内と、鳴らせないもの（音声ファイルがない等）は飛ばす */
  private playNext(): void {
    for (
      let waiting = this.waitingClips.shift();
      waiting !== undefined;
      waiting = this.waitingClips.shift()
    ) {
      const waitedMilliseconds = this.timer.now() - waiting.enqueuedMilliseconds;
      if (waitedMilliseconds > this.options.staleAfterMilliseconds) {
        this.options.onDropped?.(waiting.clipId, 'stale');
        continue;
      }
      if (this.startPlayback(waiting.clipId) === 'started') {
        this.currentClipId = waiting.clipId;
        this.currentStartedMilliseconds = this.timer.now();
        this.startPlaybackTimeout(waiting.clipId);
        return;
      }
    }
    this.currentClipId = null;
  }

  private hasPlaybackTimedOut(nowMilliseconds: number): boolean {
    return (
      nowMilliseconds - this.currentStartedMilliseconds >= this.options.playbackTimeoutMilliseconds
    );
  }

  private timeOutCurrentPlayback(): void {
    if (this.currentClipId !== null) this.options.onDropped?.(this.currentClipId, 'timeout');
    this.finished();
  }

  private startPlaybackTimeout(clipId: string): void {
    this.playbackTimeoutHandle = this.timer.setTimeout(() => {
      this.playbackTimeoutHandle = null;
      if (this.currentClipId === clipId) this.timeOutCurrentPlayback();
    }, this.options.playbackTimeoutMilliseconds);
  }

  private stopPlaybackTimeout(): void {
    if (this.playbackTimeoutHandle !== null) this.timer.clearTimeout(this.playbackTimeoutHandle);
    this.playbackTimeoutHandle = null;
  }
}
