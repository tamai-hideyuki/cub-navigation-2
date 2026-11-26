import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeSearchText } from './normalize.ts';
import { placeSubtitle, rankPlaces, type Place } from './ranking.ts';

test('文字をそろえる（build_search.py と同じ）: 全角・半角・カタカナ・大文字・空白', () => {
  assert.equal(normalizeSearchText('ｷｮｳﾄ'), 'きょうと');
  assert.equal(normalizeSearchText('道の駅 針'), '道の駅針');
  assert.equal(normalizeSearchText('ＥＮＥＯＳ'), 'eneos');
  assert.equal(normalizeSearchText('オカゲ横丁'), 'おかげ横丁');
});

function place(id: number, name: string, priority: number, longitude: number, latitude: number): Place {
  return {
    id,
    name,
    readings: null,
    category: '観光',
    priority,
    city: '伊勢市',
    address: null,
    longitude,
    latitude,
    extra: null,
    searchText: normalizeSearchText(name),
  };
}

test('名前がぴったり合うものを先に、同じ段では近いものを先に並べる', () => {
  const here = { longitude: 136.7253, latitude: 34.4625 }; // おかげ横丁
  const places = [
    place(1, 'おかげ横丁 若松屋', 50, 136.7253, 34.4626),
    place(2, '天三おかげ館', 50, 135.51, 34.71),
    place(3, 'おかげ横丁', 75, 136.7253, 34.4625),
    place(4, 'おかげ横丁 豚捨', 50, 136.73, 34.47),
  ];
  const ranked = rankPlaces(places, 'おかげ横丁', here, 10);
  // ぴったり（3）→ 先頭が合うもの（1・4、近い順）→ 途中が合うだけで遠いもの（2）
  assert.deepEqual(
    ranked.map((p) => p.id),
    [3, 1, 4, 2],
  );
});

test('結果の2行目: 種類・市区町村・距離', () => {
  const [ranked] = rankPlaces([place(1, 'おかげ横丁', 75, 136.7253, 34.4625)], 'おかげ', { longitude: 136.7253, latitude: 34.47 }, 1);
  assert.equal(placeSubtitle(ranked), '観光 · 伊勢市 · 830m');
});

test('読み（英語の名前など）の先頭が合うものも先に出す。遠くの有名な場所が、近くの小さなお店に負けない', () => {
  const osaka = { longitude: 135.4959, latitude: 34.7025 };
  const okageYokocho = { ...place(1, 'おかげ横丁', 75, 136.7253, 34.4625), readings: 'Okage Yokocho Ancien', searchText: 'おかげ横丁okageyokochoancien' };
  const smallShop = { ...place(2, 'OKAGEN', 20, 135.52, 34.62), category: '建物' };
  const ranked = rankPlaces([smallShop, okageYokocho], 'okage', osaka, 10);
  assert.deepEqual(ranked.map((p) => p.id), [1, 2]);
});
