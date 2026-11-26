// 目的地を名前で探す欄（設計書 5.1）。端末の中の検索のデータを使うので、通信なしで探せる
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Coordinate } from '../routing/request';
import { hasSearchData, searchPlaces } from '../search/place-search';
import { placeSubtitle, type RankedPlace } from '../search/ranking';

/** 打つのを止めてから探し始めるまで */
const DEBOUNCE_MILLISECONDS = 250;

export function SearchBar({ onSelect, onOpenDevelopment }: { onSelect: (place: RankedPlace) => void; onOpenDevelopment: () => void }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<RankedPlace[]>([]);
  const [message, setMessage] = useState('');
  const [focused, setFocused] = useState(false);
  const hereRef = useRef<Coordinate | null>(null);
  const requestRef = useRef(0);

  // 近い順に並べるための現在地（最後に分かった位置でよい）
  useEffect(() => {
    Location.getLastKnownPositionAsync()
      .then((position) => {
        if (position) hereRef.current = { longitude: position.coords.longitude, latitude: position.coords.latitude };
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const query = text.trim();
    const request = ++requestRef.current;
    const timer = setTimeout(async () => {
      if (query === '') {
        setResults([]);
        setMessage('');
        return;
      }
      if (!hasSearchData()) {
        setResults([]);
        setMessage('検索のデータが入っていません（Documents/search/search.sqlite）');
        return;
      }
      try {
        const found = await searchPlaces(query, hereRef.current);
        if (request !== requestRef.current) return; // もっと新しい入力がある
        setResults(found);
        setMessage(found.length === 0 ? '見つかりません。地図を長押しして決めることもできます' : '');
      } catch (error) {
        setMessage(`探せませんでした: ${String(error)}`);
      }
    }, DEBOUNCE_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [text, focused]); // 欄を押し直したときも、入っている文字で探し直す

  const select = useCallback(
    (place: RankedPlace) => {
      setText(place.name);
      setResults([]);
      setFocused(false);
      Keyboard.dismiss(); // 下のルートの情報が見えるように
      onSelect(place);
    },
    [onSelect],
  );

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onSubmitEditing={() => setFocused(true)}
          placeholder="目的地を探す"
          placeholderTextColor="#888780"
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
        />
        <Pressable accessibilityRole="button" onPress={onOpenDevelopment} style={styles.developmentButton}>
          <Text style={styles.developmentText}>開発用</Text>
        </Pressable>
      </View>
      {focused && (results.length > 0 || message !== '') && (
        <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
          {message !== '' && <Text style={styles.message}>{message}</Text>}
          {results.map((place) => (
            <Pressable
              key={place.id}
              accessibilityRole="button"
              onPress={() => select(place)}
              style={({ pressed }) => [styles.result, pressed && styles.pressed]}
            >
              <Text style={styles.resultName} numberOfLines={1}>
                {place.name}
              </Text>
              <Text style={styles.resultSub} numberOfLines={1}>
                {placeSubtitle(place)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {!focused && text === '' && <Text style={styles.hint}>地図を長押しして決めることもできます</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 56, left: 16, right: 16, gap: 6 },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 17,
    color: '#2C2C2A',
    borderWidth: 1,
    borderColor: '#D3D1C7',
  },
  developmentButton: { backgroundColor: '#ffffffdd', borderRadius: 12, paddingHorizontal: 12, justifyContent: 'center' },
  developmentText: { fontSize: 13, color: '#185FA5', fontWeight: '600' },
  results: { maxHeight: 360, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#D3D1C7' },
  result: { paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D3D1C7' },
  pressed: { backgroundColor: '#E6F1FB' },
  resultName: { fontSize: 16, fontWeight: '600', color: '#2C2C2A' },
  resultSub: { fontSize: 13, color: '#5F5E5A', marginTop: 2 },
  message: { padding: 12, fontSize: 14, color: '#5F5E5A' },
  hint: { alignSelf: 'flex-start', fontSize: 13, color: '#2C2C2A', backgroundColor: '#ffffffcc', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8, overflow: 'hidden' },
});
