import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clipGaps } from './gaps.ts';

const line = (time: string, event: string, clipId?: string) => JSON.stringify({ time, event, clipId });

test('鳴り終わりから次の鳴り始めまでの間を測る。離れすぎたもの・壊れた行は数えない', () => {
  const lines = [
    line('2026-11-26T00:00:00.000Z', 'clip-play', 'part-far'),
    line('2026-11-26T00:00:01.700Z', 'clip-finish', 'part-far'),
    line('2026-11-26T00:00:01.820Z', 'clip-play', 'part-left'),
    line('2026-11-26T00:00:02.700Z', 'clip-finish', 'part-left'),
    '壊れた行',
    line('2026-11-26T00:01:00.000Z', 'clip-play', 'joined-far-left'),
  ];
  assert.deepEqual(clipGaps(lines), [{ fromClipId: 'part-far', toClipId: 'part-left', gapMilliseconds: 120 }]);
});
