// PoC 6 の画面（設計書 4 章・8 章）。声の部品をつなぐ鳴らし方と、つないで作った声を聞き比べる。
// インカムで聞いて、つなぎ目の間と抑揚が気にならないかを確かめる
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { enqueueClips } from '../clip-player';
import { readRecentLogLines } from '../log';
import { COMMON_CLIPS, type TurnDirection } from '../navigation/types';
import { guidanceClips, type GuidanceDistance, type JoinMode } from '../voice/phrases';
import { clipGaps } from './gaps';
import { isVoiceProbing, startVoiceProbe, stopVoiceProbe } from './voice-probe';

const SAMPLES: { distance: GuidanceDistance; direction: TurnDirection; label: string }[] = [
  { distance: 'far', direction: 'left', label: '300m先・左' },
  { distance: 'near', direction: 'slight_right', label: 'まもなく・斜め右' },
  { distance: 'far', direction: 'keep_left', label: '300m先・左側' },
];

const COMMON_SAMPLES = [
  COMMON_CLIPS.start,
  'common-rerouted',
  COMMON_CLIPS.offRoute,
  'common-unreachable',
];

export function VoiceScreen() {
  const [gapText, setGapText] = useState('');
  const [probing, setProbing] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    isVoiceProbing().then(setProbing);
  }, []);

  const refreshGaps = useCallback(() => {
    const gaps = clipGaps(readRecentLogLines(400));
    if (gaps.length === 0) {
      setGapText('まだつなぎ目の記録が無い');
      return;
    }
    const recent = gaps.slice(-5);
    const sorted = gaps.map((gap) => gap.gapMilliseconds).sort((a, b) => a - b);
    const middle = sorted[Math.floor(sorted.length / 2)];
    setGapText(
      `つなぎ目 ${gaps.length} 回・真ん中 ${middle}ms・最大 ${sorted.at(-1)}ms\n` +
        recent
          .map((gap) => `${gap.fromClipId} → ${gap.toClipId}: ${gap.gapMilliseconds}ms`)
          .join('\n'),
    );
  }, []);

  const play = useCallback(
    async (distance: GuidanceDistance, direction: TurnDirection, mode: JoinMode) => {
      await enqueueClips(guidanceClips(distance, direction, mode));
      // 鳴り終わってからつなぎ目を測る（案内は長くて 3 秒ほど）
      setTimeout(refreshGaps, 4000);
    },
    [refreshGaps],
  );

  const toggleProbe = useCallback(async () => {
    try {
      if (await isVoiceProbing()) await stopVoiceProbe();
      else await startVoiceProbe();
      setMessage('');
    } catch (error) {
      setMessage(String(error));
    }
    setProbing(await isVoiceProbing());
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>PoC 6: 声をつなぐ</Text>
      <Text style={styles.note}>同じ案内を2通りで鳴らす。インカムで聞き比べる</Text>
      {SAMPLES.map((sample) => (
        <View key={sample.label} style={styles.row}>
          <Text style={styles.rowLabel}>{sample.label}</Text>
          <Button
            label="部品をつなぐ"
            onPress={() => play(sample.distance, sample.direction, 'parts')}
          />
          <Button
            label="つないで作った"
            onPress={() => play(sample.distance, sample.direction, 'joined')}
          />
        </View>
      ))}
      <Text style={styles.section}>共通の声</Text>
      <View style={styles.wrap}>
        {COMMON_SAMPLES.map((clipId) => (
          <Button
            key={clipId}
            label={clipId.replace('common-', '')}
            onPress={() => enqueueClips([clipId])}
          />
        ))}
      </View>
      <Text style={styles.section}>画面ロック中</Text>
      <Button
        label={probing ? 'ロック中の声のテストを止める' : 'ロック中の声のテストを始める（1分ごと）'}
        onPress={toggleProbe}
      />
      {message !== '' && <Text style={styles.error}>{message}</Text>}
      <Text style={styles.section}>つなぎ目の間</Text>
      <Button label="記録から測る" onPress={refreshGaps} />
      <Text style={styles.gaps}>{gapText}</Text>
    </ScrollView>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#ffffff' },
  content: { paddingTop: 104, paddingHorizontal: 16, paddingBottom: 48, gap: 10 },
  title: { fontSize: 20, fontWeight: '600' },
  note: { fontSize: 14, color: '#555555' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { width: 112, fontSize: 14 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  section: { fontSize: 15, fontWeight: '600', marginTop: 12 },
  button: {
    backgroundColor: '#185FA5',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  pressed: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  error: { color: '#A32D2D', fontSize: 13 },
  gaps: { fontSize: 12, fontFamily: 'Menlo' },
});
