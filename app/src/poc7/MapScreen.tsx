// PoC 7: 端末の中の地図のタイルを、通信なしで描けるか（設計書 5.4・8 章）。
// 地図・現在地・ルートの線を出す。アプリの本当の走行中の画面（設計書 5.1）は、PoC が終わってから作る
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type MapProps,
  UserLocation,
} from '@maplibre/maplibre-react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { memoryFootprintMegabytes, route } from '../../modules/cub-routing';
import { ensureTilesOpen } from '../poc5/background-probe';
import { isInsideArea, PLACES } from '../poc5/places';
import { buildMapStyle, ROUTE_COLORS } from '../map/style';
import { decodePolyline6 } from '../routing/polyline';
import { buildRouteRequest, summarizeRouteResponse } from '../routing/request';

/** 地図のタイルとフォントの置き場所（Mac から xcrun でここに写す） */
const MAP_DIRECTORY = new Directory(Paths.document, 'map');
const MAP_TILES_FILE = new File(MAP_DIRECTORY, 'kansai.pmtiles');

export function MapScreen() {
  const theme = useColorScheme() === 'dark' ? 'night' : 'day';
  const [routeLine, setRouteLine] = useState<GeoJSON.Feature<GeoJSON.LineString> | null>(null);
  const [message, setMessage] = useState('');

  // style.ts は Node でテストするため MapLibre の型を持たない。形は MapLibre のスタイルの仕様どおり
  const mapStyle = useMemo(
    () =>
      buildMapStyle({
        tilesUrl: `pmtiles://${MAP_TILES_FILE.uri}`,
        glyphsUrl: `${MAP_DIRECTORY.uri.replace(/\/?$/, '/')}fonts/{fontstack}/{range}.pbf`,
        theme,
      }) as unknown as MapProps['mapStyle'],
    [theme],
  );

  const drawRoute = useCallback(async () => {
    try {
      await ensureTilesOpen();
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const here = { longitude: position.coords.longitude, latitude: position.coords.latitude };
      const origin = isInsideArea(here) ? here : PLACES['大阪駅'];
      const result = await route(
        buildRouteRequest(origin, PLACES['京都駅'], { headingDegrees: position.coords.heading }),
      );
      const trip = (result.response as { trip: { legs: { shape: string }[] } }).trip;
      const coordinates = trip.legs.flatMap((leg) => decodePolyline6(leg.shape));
      const summary = summarizeRouteResponse(result.response);
      setRouteLine({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates },
      });
      const from = isInsideArea(here) ? '現在地' : '大阪駅';
      const memory = Math.round(memoryFootprintMegabytes());
      setMessage(
        `${from}→京都駅 ${summary.kilometers}km ${summary.minutes}分` +
          `・計算 ${Math.round(result.milliseconds)}ms・メモリ ${memory}MB`,
      );
    } catch (error) {
      setMessage(`失敗: ${String(error)}`);
    }
  }, []);

  if (!MAP_TILES_FILE.exists) {
    return (
      <View style={styles.missing}>
        <Text>地図のタイルが無い（Documents/map/kansai.pmtiles に写す）</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Map style={styles.map} mapStyle={mapStyle} logo={false} attribution compass={false}>
        <Camera
          trackUserLocation="course"
          initialViewState={{ center: [135.4959, 34.7025], zoom: 15 }}
        />
        <UserLocation />
        {routeLine && (
          <GeoJSONSource id="route" data={routeLine}>
            <Layer
              id="route-casing"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': ROUTE_COLORS.casing, 'line-width': 9 }}
            />
            <Layer
              id="route-ahead"
              type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': ROUTE_COLORS.ahead, 'line-width': 6 }}
            />
          </GeoJSONSource>
        )}
      </Map>
      <View style={styles.panel}>
        <Pressable accessibilityRole="button" onPress={drawRoute} style={styles.button}>
          <Text style={styles.buttonText}>京都駅までのルートを引く</Text>
        </Pressable>
        {message !== '' && <Text style={styles.message}>{message}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  map: { flex: 1 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  panel: { position: 'absolute', left: 16, right: 16, bottom: 32, gap: 8 },
  button: {
    backgroundColor: '#185FA5',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  message: { backgroundColor: '#ffffffee', padding: 8, borderRadius: 8, fontSize: 13 },
});
