import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMapStyle } from './style.ts';

const OPTIONS = {
  tilesUrl: 'pmtiles://file:///map/kansai.pmtiles',
  glyphsUrl: 'file:///map/fonts/{fontstack}/{range}.pbf',
};

test('タイルとフォントは渡したファイルを読む（通信を使わない）', () => {
  const style = buildMapStyle({ ...OPTIONS, theme: 'day' });
  assert.equal(style.sources.openmaptiles.url, OPTIONS.tilesUrl);
  assert.equal(style.glyphs, OPTIONS.glyphsUrl);
  const urls = JSON.stringify(style).match(/https?:\/\//g);
  assert.equal(urls, null, 'スタイルに http の URL が入っている');
});

test('通れない道（motorway・有料）は、ふつうの道とは別の層に描く', () => {
  const style = buildMapStyle({ ...OPTIONS, theme: 'day' });
  const ids = style.layers.map((layer) => layer.id);
  assert.ok(ids.includes('road-forbidden'));
  // 通れない道の層は、ふつうの道より下に描く
  assert.ok(ids.indexOf('road-forbidden') < ids.indexOf('road-minor-casing'));
  const major = style.layers.find((layer) => layer.id === 'road-major') as { filter: unknown };
  assert.match(JSON.stringify(major.filter), /motorway/);
});

test('昼と夜で色だけが変わり、層の並びは同じ', () => {
  const day = buildMapStyle({ ...OPTIONS, theme: 'day' });
  const night = buildMapStyle({ ...OPTIONS, theme: 'night' });
  assert.deepEqual(
    day.layers.map((layer) => layer.id),
    night.layers.map((layer) => layer.id),
  );
  assert.notEqual(JSON.stringify(day.layers[0]), JSON.stringify(night.layers[0]));
});
