// アプリの画面（設計書 5 章）。目的地を決める画面 → 走行中の画面。PoC の画面は「開発用」から開く
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { closeTiles, isOpen, memoryFootprintMegabytes, route } from './modules/cub-routing';
import { readLogTail, writeLog } from './src/log';
import { ensureTilesOpen, isProbing, startProbe, stopProbe, TILE_EXTRACT_FILE } from './src/poc5/background-probe';
import { PAIRS, PLACES } from './src/poc5/places';
import { VoiceScreen } from './src/poc6/VoiceScreen';
import { MapScreen } from './src/poc7/MapScreen';
import { buildRouteRequest, summarizeRouteResponse } from './src/routing/request';
import { PlanScreen } from './src/screens/PlanScreen';
import { RideScreen } from './src/screens/RideScreen';
import { isTripRunning, resumeTripIfNeeded } from './src/trip/trip-runner';

type Line = { text: string; failed?: boolean };

type Mode = 'loading' | 'plan' | 'ride' | 'development';

export default function App() {
  const [mode, setMode] = useState<Mode>('loading');

  // 走行中にアプリを開き直したら、走行中の画面に戻す
  useEffect(() => {
    isTripRunning().then(async (running) => {
      if (running) await resumeTripIfNeeded().catch((error) => writeLog('trip-resume-error', { message: String(error) }));
      setMode(running ? 'ride' : 'plan');
    });
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {mode === 'plan' && <PlanScreen onStarted={() => setMode('ride')} onOpenDevelopment={() => setMode('development')} />}
      {mode === 'ride' && <RideScreen onStopped={() => setMode('plan')} />}
      {mode === 'development' && <DevelopmentScreen onClose={() => setMode('plan')} />}
    </View>
  );
}

type Tab = 'map' | 'voice' | 'poc5';

/** PoC 5〜7 の画面（設計書 8 章）。確かめ直すときのために残す */
function DevelopmentScreen({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('map');
  return (
    <View style={styles.root}>
      {tab === 'map' ? <MapScreen /> : tab === 'voice' ? <VoiceScreen /> : <Poc5Screen />}
      <View style={styles.tabs}>
        <TabButton label="戻る" selected={false} onPress={onClose} />
        <TabButton label="地図" selected={tab === 'map'} onPress={() => setTab('map')} />
        <TabButton label="声" selected={tab === 'voice'} onPress={() => setTab('voice')} />
        <TabButton label="計算" selected={tab === 'poc5'} onPress={() => setTab('poc5')} />
      </View>
    </View>
  );
}

function TabButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tab, selected && styles.tabSelected]}
    >
      <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function Poc5Screen() {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState(false);
  const [logTail, setLogTail] = useState(() => readLogTail(12));

  const add = useCallback((text: string, failed = false) => {
    setLines((previous) => [...previous, { text, failed }]);
  }, []);

  const refresh = useCallback(async () => {
    setProbing(await isProbing());
    setLogTail(readLogTail(12));
  }, []);

  useEffect(() => {
    isProbing().then(setProbing);
  }, []);

  const tileStatus = TILE_EXTRACT_FILE.exists
    ? `タイル ${Math.round((TILE_EXTRACT_FILE.size ?? 0) / 1_048_576)}MB`
    : 'タイルが無い（Documents/valhalla_tiles.tar に写す）';

  const runBenchmark = useCallback(async () => {
    setBusy(true);
    setLines([]);
    try {
      add(`開く前のメモリ ${Math.round(memoryFootprintMegabytes())}MB`);
      if (isOpen()) closeTiles();
      const openMilliseconds = await ensureTilesOpen();
      add(`タイルを開いた ${Math.round(openMilliseconds ?? 0)}ms・メモリ ${Math.round(memoryFootprintMegabytes())}MB`);
      // 1回目はタイルを読み込むので遅い。同じ組を2回計算して、2回目の速さも見る
      for (const round of [1, 2]) {
        for (const pair of PAIRS) {
          const request = buildRouteRequest(PLACES[pair.from], PLACES[pair.to]);
          try {
            const result = await route(request);
            const summary = summarizeRouteResponse(result.response);
            const differenceKilometers = Math.abs(summary.kilometers - pair.desktopKilometers);
            add(
              `${round}回目 ${pair.from}→${pair.to} ${summary.kilometers}km（PC ${pair.desktopKilometers}）` +
                ` ${summary.minutes}分 計算 ${Math.round(result.milliseconds)}ms`,
              differenceKilometers > 0.5,
            );
            writeLog('benchmark-route', { round, ...pair, ...summary, milliseconds: Math.round(result.milliseconds) });
          } catch (error) {
            add(`${round}回目 ${pair.from}→${pair.to} 失敗: ${String(error)}`, true);
          }
        }
      }
      add(`終わった後のメモリ ${Math.round(memoryFootprintMegabytes())}MB`);
    } catch (error) {
      add(`失敗: ${String(error)}`, true);
    } finally {
      setBusy(false);
      refresh();
    }
  }, [add, refresh]);

  const toggleProbe = useCallback(async () => {
    try {
      if (await isProbing()) await stopProbe();
      else await startProbe();
    } catch (error) {
      add(`ロック中のテスト: ${String(error)}`, true);
    }
    refresh();
  }, [add, refresh]);

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <Text style={styles.title}>PoC 5: 端末の中の Valhalla</Text>
      <Text style={styles.status}>{tileStatus}</Text>
      <View style={styles.buttons}>
        <Button label={busy ? '計算中…' : '速さを測る'} onPress={runBenchmark} disabled={busy} />
        <Button label={probing ? 'ロック中のテストを止める' : 'ロック中のテストを始める'} onPress={toggleProbe} />
        <Button label="記録を更新" onPress={refresh} />
      </View>
      <ScrollView style={styles.output}>
        {lines.map((line, index) => (
          <Text key={index} style={[styles.line, line.failed && styles.failed]}>
            {line.text}
          </Text>
        ))}
        <Text style={styles.logTitle}>記録（新しい順）</Text>
        <Text style={styles.log}>{logTail}</Text>
      </ScrollView>
    </View>
  );
}

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, (pressed || disabled) && styles.buttonPressed]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff' },
  tabs: { position: 'absolute', top: 56, left: 16, right: 16, flexDirection: 'row', gap: 8 },
  tab: { flex: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center', backgroundColor: '#ffffffdd' },
  tabSelected: { backgroundColor: '#185FA5' },
  tabText: { fontSize: 14, color: '#185FA5', fontWeight: '600' },
  tabTextSelected: { color: '#ffffff' },
  screen: { flex: 1, paddingTop: 104, paddingHorizontal: 16, backgroundColor: '#ffffff' },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 4 },
  status: { fontSize: 14, color: '#555555', marginBottom: 12 },
  buttons: { gap: 8, marginBottom: 12 },
  button: { backgroundColor: '#185FA5', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  buttonPressed: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  output: { flex: 1 },
  line: { fontSize: 13, fontFamily: 'Menlo', marginBottom: 4 },
  failed: { color: '#A32D2D' },
  logTitle: { fontSize: 13, color: '#555555', marginTop: 12 },
  log: { fontSize: 11, fontFamily: 'Menlo' },
});
