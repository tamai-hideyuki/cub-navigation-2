// 目的地を決める画面とルートの下見（設計書 5.1）。名前で探すか、地図を長押しして目的地を決めると、その場でルートを計算する
import { Camera, GeoJSONSource, Layer, Map, UserLocation, type CameraRef } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { enqueueClips } from '../clip-player';
import { MAP_TILES_FILE, useOfflineMapStyle } from '../map/offline-map';
import { ROUTE_COLORS } from '../map/style';
import { formatArrival, formatDistance, formatDuration } from '../navigation/progress-view';
import type { Coordinate } from '../routing/request';
import type { RankedPlace } from '../search/ranking';
import { NoRouteError, planRoute, startTrip, TILE_EXTRACT_FILE, type PlannedRoute } from '../trip/trip-runner';
import { SearchBar } from './SearchBar';

type Plan =
  | { kind: 'none' }
  | { kind: 'planning'; destination: Coordinate; destinationName: string | null }
  | { kind: 'ready'; destination: Coordinate; destinationName: string | null; planned: PlannedRoute; plannedAtMilliseconds: number }
  | { kind: 'failed'; destination: Coordinate; destinationName: string | null; message: string };

export function PlanScreen({ onStarted, onOpenDevelopment }: { onStarted: () => void; onOpenDevelopment: () => void }) {
  const mapStyle = useOfflineMapStyle();
  const cameraRef = useRef<CameraRef>(null);
  const [plan, setPlan] = useState<Plan>({ kind: 'none' });
  const [starting, setStarting] = useState(false);

  const chooseDestination = useCallback(async (destination: Coordinate, destinationName: string | null = null) => {
    setPlan({ kind: 'planning', destination, destinationName });
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const planned = await planRoute(
        { longitude: position.coords.longitude, latitude: position.coords.latitude },
        destination,
        position.coords.heading !== null && position.coords.heading >= 0 ? position.coords.heading : null,
      );
      setPlan({ kind: 'ready', destination, destinationName, planned, plannedAtMilliseconds: Date.now() });
      const longitudes = planned.route.geometry.map(([longitude]) => longitude);
      const latitudes = planned.route.geometry.map(([, latitude]) => latitude);
      cameraRef.current?.fitBounds(
        [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)],
        { padding: { top: 120, right: 48, bottom: 260, left: 48 }, duration: 600 },
      );
    } catch (error) {
      if (error instanceof NoRouteError) {
        setPlan({ kind: 'failed', destination, destinationName, message: 'この目的地へは、125cc では行けません（または範囲の外です）' });
        await enqueueClips(['common-unreachable']);
      } else {
        setPlan({ kind: 'failed', destination, destinationName, message: `ルートを計算できませんでした: ${String(error)}` });
      }
    }
  }, []);

  const selectPlace = useCallback(
    (place: RankedPlace) => {
      cameraRef.current?.flyTo({ center: [place.longitude, place.latitude], zoom: 15, duration: 600 });
      chooseDestination({ longitude: place.longitude, latitude: place.latitude }, place.name);
    },
    [chooseDestination],
  );

  const start = useCallback(async () => {
    if (plan.kind !== 'ready') return;
    setStarting(true);
    try {
      await startTrip(plan.destination, plan.planned);
      onStarted();
    } catch (error) {
      setPlan({ kind: 'failed', destination: plan.destination, destinationName: plan.destinationName, message: String(error) });
    } finally {
      setStarting(false);
    }
  }, [plan, onStarted]);

  if (!MAP_TILES_FILE.exists || !TILE_EXTRACT_FILE.exists) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingTitle}>地図のデータが入っていません</Text>
        <Text style={styles.missingText}>
          Mac から、ルート用のタイル（Documents/valhalla_tiles.tar）と地図（Documents/map/）を写してください。手順は app/README.md
        </Text>
        <Pressable accessibilityRole="button" onPress={onOpenDevelopment} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>開発用の画面</Text>
        </Pressable>
      </View>
    );
  }

  const destination = plan.kind === 'none' ? null : plan.destination;
  return (
    <View style={styles.screen}>
      <Map
        style={styles.map}
        mapStyle={mapStyle}
        logo={false}
        attribution
        compass
        onLongPress={(event) => {
          const [longitude, latitude] = event.nativeEvent.lngLat;
          chooseDestination({ longitude, latitude });
        }}
      >
        <Camera ref={cameraRef} initialViewState={{ center: [135.4959, 34.7025], zoom: 12 }} trackUserLocation={plan.kind === 'none' ? 'default' : undefined} />
        <UserLocation />
        {plan.kind === 'ready' && (
          <GeoJSONSource
            id="plan-route"
            data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: plan.planned.route.geometry } }}
          >
            <Layer id="plan-route-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': ROUTE_COLORS.casing, 'line-width': 8 }} />
            <Layer id="plan-route-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': ROUTE_COLORS.ahead, 'line-width': 5 }} />
          </GeoJSONSource>
        )}
        {destination && (
          <GeoJSONSource id="plan-destination" data={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [destination.longitude, destination.latitude] } }}>
            <Layer id="plan-destination-dot" type="circle" paint={{ 'circle-radius': 9, 'circle-color': '#E24B4A', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 }} />
          </GeoJSONSource>
        )}
      </Map>

      <SearchBar onSelect={selectPlace} onOpenDevelopment={onOpenDevelopment} />

      {plan.kind !== 'none' && (
        <View style={styles.card}>
          {plan.kind === 'planning' && (
            <View style={styles.cardRow}>
              <ActivityIndicator />
              <Text style={styles.cardText}>ルートを計算しています</Text>
            </View>
          )}
          {plan.destinationName && <Text style={styles.destinationName} numberOfLines={1}>{plan.destinationName}</Text>}
          {plan.kind === 'ready' && (
            <>
              <Text style={styles.summary}>
                {formatDuration(plan.planned.totalSeconds)} · {formatDistance(plan.planned.route.totalMeters)}
              </Text>
              <Text style={styles.cardText}>
                {formatArrival(plan.plannedAtMilliseconds, plan.planned.totalSeconds)} 着 · 曲がる所 {plan.planned.route.maneuvers.length}
              </Text>
              <Text style={styles.safe}>高速道路・自動車専用道路・125cc 以下の通行止めは通りません</Text>
            </>
          )}
          {plan.kind === 'failed' && <Text style={styles.failed}>{plan.message}</Text>}
          <View style={styles.cardButtons}>
            {plan.kind === 'ready' && (
              <Pressable accessibilityRole="button" onPress={start} disabled={starting} style={[styles.primaryButton, starting && styles.dimmed]}>
                <Text style={styles.primaryButtonText}>{starting ? '準備しています…' : '案内を始める'}</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" onPress={() => setPlan({ kind: 'none' })} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>やめる</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  map: { flex: 1 },
  card: { position: 'absolute', left: 16, right: 16, bottom: 32, backgroundColor: '#ffffff', borderRadius: 16, padding: 16, gap: 6 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  destinationName: { fontSize: 15, fontWeight: '600', color: '#185FA5' },
  summary: { fontSize: 26, fontWeight: '700', color: '#2C2C2A' },
  cardText: { fontSize: 15, color: '#5F5E5A' },
  safe: { fontSize: 13, color: '#3B6D11' },
  failed: { fontSize: 15, color: '#A32D2D' },
  cardButtons: { flexDirection: 'row', gap: 8, marginTop: 8 },
  primaryButton: { flex: 1, backgroundColor: '#185FA5', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryButtonText: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
  secondaryButton: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', borderWidth: 1, borderColor: '#B4B2A9' },
  secondaryButtonText: { color: '#2C2C2A', fontSize: 15, fontWeight: '600' },
  dimmed: { opacity: 0.6 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  missingTitle: { fontSize: 18, fontWeight: '700' },
  missingText: { fontSize: 14, color: '#5F5E5A', textAlign: 'center' },
});
