// 画面・音声・位置の取得から切り出した純粋な部分のテスト
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ClipQueue, DEFAULT_CLIP_QUEUE_OPTIONS, type ClipQueueTimer } from './clip-queue.ts';
import { crossedLogInterval, roundedOrNull, toLocationReading } from './location-reading.ts';
import { formatLogLine, newestLines } from './log-format.ts';
import { initialState, step } from './navigation/navigator.ts';
import { isNavigationState, restoreState } from './navigation/saved-state.ts';
import { readingAt, TEST_ROUTE } from './navigation/test-route.ts';
import { formatKilometers, screenLines } from './screen-text.ts';

test('toLocationReading: 負の速さ（取れない）は null にする', () => {
  const location = {
    coords: {
      latitude: 35,
      longitude: 139,
      accuracy: 8,
      speed: -1,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
    },
    timestamp: 1234,
  };
  assert.deepEqual(toLocationReading(location), {
    latitude: 35,
    longitude: 139,
    accuracyMeters: 8,
    speedMetersPerSecond: null,
    timestampMilliseconds: 1234,
  });
  assert.equal(
    toLocationReading({ ...location, coords: { ...location.coords, speed: 0 } })
      .speedMetersPerSecond,
    0,
  );
  assert.equal(
    toLocationReading({ ...location, coords: { ...location.coords, accuracy: null } })
      .accuracyMeters,
    null,
  );
});

test('crossedLogInterval: 束の中で 60 件の区切りをまたいだときだけ true', () => {
  assert.equal(crossedLogInterval(60, 1, 60), true);
  assert.equal(crossedLogInterval(61, 1, 60), false);
  assert.equal(crossedLogInterval(62, 3, 60), true); // 60 を含む束
  assert.equal(crossedLogInterval(59, 1, 60), false);
});

test('roundedOrNull', () => {
  assert.equal(roundedOrNull(12.6), 13);
  assert.equal(roundedOrNull(null), null);
  assert.equal(roundedOrNull(undefined), null);
});

test('formatLogLine と newestLines', () => {
  const line = formatLogLine(new Date('2026-11-23T00:00:00Z'), 'start', { distanceAlongMeters: 0 });
  assert.equal(
    line,
    '{"time":"2026-11-23T00:00:00.000Z","event":"start","distanceAlongMeters":0}\n',
  );
  assert.equal(newestLines('a\nb\nc\n', 2), 'c\nb');
  assert.equal(newestLines('', 5), '');
});

test('restoreState: 同じルートなら続きから、別のルート・壊れたファイル・なしなら最初から', () => {
  const advanced = step(TEST_ROUTE, initialState(TEST_ROUTE), readingAt(500, 0, 1)).state;
  assert.deepEqual(restoreState(JSON.stringify(advanced), TEST_ROUTE), advanced);
  const otherRoute = { ...advanced, routeComputedAt: 'another' };
  assert.deepEqual(restoreState(JSON.stringify(otherRoute), TEST_ROUTE), initialState(TEST_ROUTE));
  assert.deepEqual(restoreState('{壊れた', TEST_ROUTE), initialState(TEST_ROUTE));
  assert.deepEqual(restoreState(null, TEST_ROUTE), initialState(TEST_ROUTE));
});

test('restoreState: 同じルートでも、形が違う（古い版のアプリの）状態は使わない', () => {
  const advanced = step(TEST_ROUTE, initialState(TEST_ROUTE), readingAt(500, 0, 1)).state;
  assert.equal(isNavigationState(advanced), true);
  const oldShape = { ...advanced, offRoute: undefined, announce: { firedClipIds: [] } };
  assert.equal(isNavigationState(oldShape), false);
  assert.deepEqual(restoreState(JSON.stringify(oldShape), TEST_ROUTE), initialState(TEST_ROUTE));
  const badStatus = { ...advanced, offRoute: { ...advanced.offRoute, status: 'lost' } };
  assert.equal(isNavigationState(badStatus), false);
  assert.equal(isNavigationState(null), false);
});

/** 手で進める時計とタイマー */
function manualTimer() {
  let nowMilliseconds = 0;
  let pending: { callback: () => void; at: number } | null = null;
  const timer: ClipQueueTimer = {
    now: () => nowMilliseconds,
    setTimeout: (callback, milliseconds) => {
      pending = { callback: callback, at: nowMilliseconds + milliseconds };
      return pending;
    },
    clearTimeout: (handle) => {
      if (pending === handle) pending = null;
    },
  };
  return {
    timer: timer,
    /** 時計を進め、時刻が来たタイマーを動かす */
    advance(milliseconds: number) {
      nowMilliseconds += milliseconds;
      const due = pending;
      if (due !== null && due.at <= nowMilliseconds) {
        pending = null;
        due.callback();
      }
    },
  };
}

function recordingQueue(skipClipIds: string[] = []) {
  const started: string[] = [];
  const dropped: string[] = [];
  const clock = manualTimer();
  const queue = new ClipQueue(
    (clipId) => {
      if (skipClipIds.includes(clipId)) return 'skipped';
      started.push(clipId);
      return 'started';
    },
    clock.timer,
    {
      ...DEFAULT_CLIP_QUEUE_OPTIONS,
      onDropped: (clipId, reason) => dropped.push(`${clipId}:${reason}`),
    },
  );
  return { queue: queue, started: started, dropped: dropped, clock: clock };
}

test('ClipQueue: 鳴っている間に来たものは後ろに並べ、鳴り終わるたびに次を鳴らす', () => {
  const { queue, started } = recordingQueue();
  queue.enqueue(['a', 'b']);
  queue.enqueue(['c']);
  assert.deepEqual(started, ['a']);
  queue.finished();
  queue.finished();
  assert.deepEqual(started, ['a', 'b', 'c']);
  assert.equal(queue.isPlaying, true);
  queue.finished();
  assert.equal(queue.isPlaying, false);
  queue.enqueue(['d']);
  assert.deepEqual(started, ['a', 'b', 'c', 'd']);
});

test('ClipQueue: 鳴らせないものは飛ばして次を鳴らす', () => {
  const { queue, started } = recordingQueue(['missing']);
  queue.enqueue(['missing', 'b']);
  assert.deepEqual(started, ['b']);
  queue.finished();
  assert.equal(queue.isPlaying, false);
  assert.equal(queue.waitingCount, 0);
});

test('ClipQueue: 鳴り終わりの知らせが来なくても、打ち切りの時間で次へ進む', () => {
  const { queue, started, dropped, clock } = recordingQueue();
  queue.enqueue(['a', 'b']);
  clock.advance(DEFAULT_CLIP_QUEUE_OPTIONS.playbackTimeoutMilliseconds);
  assert.deepEqual(started, ['a', 'b']);
  assert.deepEqual(dropped, ['a:timeout']);
});

test('ClipQueue: タイマーが遅れても、次に並べたときに打ち切りの時間を過ぎていれば進む', () => {
  const { queue, started, dropped, clock } = recordingQueue();
  queue.enqueue(['a']);
  // タイマーを動かさずに時計だけ進める（バックグラウンドでタイマーが遅れた場合）
  const later = clock.timer.now() + DEFAULT_CLIP_QUEUE_OPTIONS.playbackTimeoutMilliseconds;
  clock.timer.now = () => later;
  queue.enqueue(['b']);
  assert.deepEqual(started, ['a', 'b']);
  assert.deepEqual(dropped, ['a:timeout']);
});

test('ClipQueue: 並んでから時間がたちすぎた案内は鳴らさずに捨てる', () => {
  const { queue, started, dropped, clock } = recordingQueue();
  queue.enqueue(['a', 'old']);
  clock.advance(DEFAULT_CLIP_QUEUE_OPTIONS.staleAfterMilliseconds + 1);
  // a の打ち切りで次へ進むが、old は並んでから時間がたちすぎている
  assert.deepEqual(started, ['a']);
  assert.deepEqual(dropped, ['a:timeout', 'old:stale']);
  assert.equal(queue.isPlaying, false);
});

test('ClipQueue: 鳴り終わった後に古いタイマーが動いても、次の案内を止めない', () => {
  const { queue, started, dropped, clock } = recordingQueue();
  queue.enqueue(['a', 'b']);
  clock.advance(3000);
  queue.finished(); // a が鳴り終わり、b が始まる
  clock.advance(DEFAULT_CLIP_QUEUE_OPTIONS.playbackTimeoutMilliseconds - 3000);
  assert.deepEqual(started, ['a', 'b']);
  assert.deepEqual(dropped, []);
});

test('formatKilometers', () => {
  assert.equal(formatKilometers(null), '—');
  assert.equal(formatKilometers(443789), '443.8 km');
});

test('リグレッション: 画面の文', (context) => {
  const before = initialState(TEST_ROUTE);
  const after = step(TEST_ROUTE, before, readingAt(500, 12, 1));
  context.assert.snapshot({
    出発前: screenLines(TEST_ROUTE, before, null),
    走行中: screenLines(TEST_ROUTE, after.state, after.debug),
  });
});
