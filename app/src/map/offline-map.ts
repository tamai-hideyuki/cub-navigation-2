// 端末の中の地図（タイルとフォント）を読むスタイル（設計書 5.4）。計画の画面と走行中の画面で使う
import type { MapProps } from '@maplibre/maplibre-react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { buildMapStyle } from './style';

/** 地図のタイルとフォントの置き場所（Mac から写す。設計書 9 章でビルドのときに入れるようにする） */
export const MAP_DIRECTORY = new Directory(Paths.document, 'map');
export const MAP_TILES_FILE = new File(MAP_DIRECTORY, 'kansai.pmtiles');

/** 昼と夜（iOS のダークモード）で色を変えたスタイル。style.ts は Node でテストするため MapLibre の型を持たない */
export function useOfflineMapStyle(): MapProps['mapStyle'] {
  const theme = useColorScheme() === 'dark' ? 'night' : 'day';
  return useMemo(
    () =>
      buildMapStyle({
        tilesUrl: `pmtiles://${MAP_TILES_FILE.uri}`,
        glyphsUrl: `${MAP_DIRECTORY.uri.replace(/\/?$/, '/')}fonts/{fontstack}/{range}.pbf`,
        theme,
      }) as unknown as MapProps['mapStyle'],
    [theme],
  );
}
