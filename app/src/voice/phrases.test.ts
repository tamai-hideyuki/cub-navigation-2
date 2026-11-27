import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allPhrases, guidanceClips } from './phrases.ts';

test('部品をつなぐときは距離と向きの2つ、つないで作ったときは1つを鳴らす', () => {
  assert.deepEqual(guidanceClips('far', 'left', 'parts'), ['part-far', 'part-left']);
  assert.deepEqual(guidanceClips('near', 'slight_right', 'joined'), ['joined-near-slight_right']);
});

test('鳴らす声は、どれも作る声の一覧に入っている', () => {
  const phrases = allPhrases();
  for (const distance of ['far', 'near'] as const) {
    for (const direction of ['left', 'right', 'uturn', 'arrive'] as const) {
      for (const mode of ['parts', 'joined'] as const) {
        for (const clipId of guidanceClips(distance, direction, mode))
          assert.ok(phrases[clipId], clipId);
      }
    }
  }
  assert.equal(phrases['joined-far-left'], '300メートル先、左です');
  // 共通 8・部品 2+11・つないだもの 2×11
  assert.equal(Object.keys(phrases).length, 8 + 13 + 22);
});
