// 走行中の画面（設計書 5.1〜5.3）。ちらっと見て、次の曲がる所とルートのどこにいるかが分かるようにする。
// 案内の主役は声で、画面は確かめるためのもの。走っている間に触るのは「全体」と「停止」だけ
import { Camera, GeoJSONSource, Layer, Map, UserLocation, type CameraRef } from '@maplibre/maplibre-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useOfflineMapStyle } from '../map/offline-map';
import { ROUTE_COLORS } from '../map/style';
import {
  DIRECTION_LABEL,
  formatArrival,
  formatDistance,
  formatDuration,
  progressView,
} from '../navigation/progress-view';
import { currentTrip, stopTrip, type Trip } from '../trip/trip-runner';

/** 画面を描き直す間隔。位置のタスクがファイルと手元の状態を更新し、画面はそれを読む */
const REFRESH_MILLISECONDS = 1000;

const BANNER_COLORS = {
  on: '#185FA5',
  offRoute: '#BA7517',
  failed: '#A32D2D',
  arrived: '#3B6D11',
} as const;

export function RideScreen({ onStopped }: { onStopped: () => void }) {
  const mapStyle = useOfflineMapStyle();
  const cameraRef = useRef<CameraRef>(null);
  const [trip, setTrip] = useState<Trip | null>(() => currentTrip());
  const [overview, setOverview] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setTrip(currentTrip());
      setNow(Date.now());
    }, REFRESH_MILLISECONDS);
    return () => clearInterval(timer);
  }, []);

  const view = useMemo(() => (trip ? progressView(trip.route, trip.state, trip.totalSeconds) : null), [trip]);

  const showOverview = useCallback(() => {
    if (!trip) return;
    const longitudes = trip.route.geometry.map(([longitude]) => longitude);
    const latitudes = trip.route.geometry.map(([, latitude]) => latitude);
    setOverview(true);
    cameraRef.current?.fitBounds(
      [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)],
      { padding: { top: 200, right: 40, bottom: 220, left: 40 }, duration: 500 },
    );
  }, [trip]);

  const confirmStop = useCallback(() => {
    Alert.alert('案内を止めますか？', '止めると、今のルートは消えます', [
      { text: '続ける', style: 'cancel' },
      {
        text: '止める',
        style: 'destructive',
        onPress: async () => {
          await stopTrip();
          onStopped();
        },
      },
    ]);
  }, [onStopped]);

  if (!trip || !view) {
    return (
      <View style={styles.center}>
        <Text>走行の記録が見つかりません</Text>
        <Pressable accessibilityRole="button" onPress={onStopped} style={styles.stopButton}>
          <Text style={styles.stopText}>戻る</Text>
        </Pressable>
      </View>
    );
  }

  const offRoute = trip.state.offRoute.status !== 'on';
  const bannerColor = trip.arrived
    ? BANNER_COLORS.arrived
    : trip.lastRerouteFailed
      ? BANNER_COLORS.failed
      : offRoute
        ? BANNER_COLORS.offRoute
        : BANNER_COLORS.on;
  const next = view.nextManeuver;
  const label = next ? DIRECTION_LABEL[next.direction] : null;

  return (
    <View style={styles.screen}>
      <Map style={styles.map} mapStyle={mapStyle} logo={false} attribution={false} compass={false}>
        <Camera
          ref={cameraRef}
          trackUserLocation={overview ? undefined : 'course'}
          initialViewState={{ center: trip.route.geometry[0], zoom: 16 }}
        />
        <GeoJSONSource id="ride-passed" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: view.passedCoordinates } }}>
          <Layer id="ride-passed-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': ROUTE_COLORS.passed, 'line-width': 7 }} />
        </GeoJSONSource>
        <GeoJSONSource id="ride-ahead" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: view.aheadCoordinates } }}>
          <Layer id="ride-ahead-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': ROUTE_COLORS.casing, 'line-width': 10 }} />
          <Layer id="ride-ahead-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': ROUTE_COLORS.ahead, 'line-width': 7 }} />
        </GeoJSONSource>
        <GeoJSONSource id="ride-destination" data={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [trip.destination.longitude, trip.destination.latitude] } }}>
          <Layer id="ride-destination-dot" type="circle" paint={{ 'circle-radius': 9, 'circle-color': '#E24B4A', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 }} />
        </GeoJSONSource>
        <UserLocation />
      </Map>

      {/* 上: 次の曲がる所。色で今の状態（ふだん・外れ・計算できない・着いた）を分ける */}
      <View style={[styles.banner, { backgroundColor: bannerColor }]}>
        {trip.arrived ? (
          <Text style={styles.bannerMain}>目的地に着きました</Text>
        ) : trip.lastRerouteFailed ? (
          <Text style={styles.bannerMain}>ルートが見つかりません</Text>
        ) : trip.state.offRoute.status === 'off' ? (
          <Text style={styles.bannerMain}>ルートを外れています</Text>
        ) : next && label ? (
          <View style={styles.bannerRow}>
            <Text style={styles.arrow}>{label.arrow}</Text>
            <View style={styles.bannerTexts}>
              <Text style={styles.bannerMain}>{formatDistance(next.distanceMeters)}</Text>
              <Text style={styles.bannerSub} numberOfLines={1}>
                {label.text}
                {next.roadName ? ` · ${next.roadName}` : ''}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={styles.bannerMain}>ルートに向かってください</Text>
        )}
        {trip.rerouteCount > 0 && !trip.arrived && <Text style={styles.bannerNote}>計算し直し {trip.rerouteCount} 回</Text>}
      </View>

      {/* 下: ルートのどこにいるか（進み具合の帯）と、残り */}
      <View style={styles.bottom}>
        <View style={styles.strip}>
          <View style={styles.stripTrack} />
          <View style={[styles.stripPassed, { width: `${view.fraction * 100}%` }]} />
          {view.maneuverFractions.map((fraction, index) => (
            <View key={index} style={[styles.stripTick, { left: `${fraction * 100}%` }]} />
          ))}
          <View style={[styles.stripDot, { left: `${view.fraction * 100}%` }]} />
        </View>
        <View style={styles.remainingRow}>
          <Text style={styles.remainingMain}>{formatDistance(view.remainingMeters)}</Text>
          <Text style={styles.remainingMain}>{formatDuration(view.remainingSeconds)}</Text>
          <Text style={styles.remainingMain}>{formatArrival(now, view.remainingSeconds)} 着</Text>
        </View>
        <View style={styles.buttons}>
          <Pressable
            accessibilityRole="button"
            onPress={overview ? () => setOverview(false) : showOverview}
            style={styles.overviewButton}
          >
            <Text style={styles.overviewText}>{overview ? '走行中の表示に戻る' : 'ルートの全体'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={confirmStop} style={styles.stopButton}>
            <Text style={styles.stopText}>停止</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  map: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  banner: { position: 'absolute', top: 52, left: 12, right: 12, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16 },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  arrow: { fontSize: 52, color: '#ffffff', fontWeight: '700', width: 56, textAlign: 'center' },
  bannerTexts: { flex: 1 },
  bannerMain: { fontSize: 34, fontWeight: '800', color: '#ffffff' },
  bannerSub: { fontSize: 20, fontWeight: '600', color: '#ffffff' },
  bannerNote: { fontSize: 13, color: '#ffffffcc', marginTop: 4 },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 28, backgroundColor: '#ffffffee', borderRadius: 16, padding: 14, gap: 10 },
  strip: { height: 22, justifyContent: 'center' },
  stripTrack: { position: 'absolute', left: 0, right: 0, height: 6, borderRadius: 3, backgroundColor: '#D3D1C7' },
  stripPassed: { position: 'absolute', left: 0, height: 6, borderRadius: 3, backgroundColor: '#378ADD' },
  stripTick: { position: 'absolute', width: 2, height: 14, marginLeft: -1, backgroundColor: '#888780' },
  stripDot: { position: 'absolute', width: 20, height: 20, marginLeft: -10, borderRadius: 10, backgroundColor: '#185FA5', borderWidth: 3, borderColor: '#ffffff' },
  remainingRow: { flexDirection: 'row', justifyContent: 'space-between' },
  remainingMain: { fontSize: 22, fontWeight: '700', color: '#2C2C2A' },
  buttons: { flexDirection: 'row', gap: 10 },
  overviewButton: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: '#E6F1FB' },
  overviewText: { fontSize: 16, fontWeight: '700', color: '#0C447C' },
  stopButton: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 22, alignItems: 'center', backgroundColor: '#FCEBEB' },
  stopText: { fontSize: 16, fontWeight: '700', color: '#A32D2D' },
});
