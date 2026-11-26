// 端末の中の検索のデータ（Documents/search/search.sqlite、tiles/build_search.py で作る）で、目的地を名前で探す。通信は使わない
import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import type { Coordinate } from '../routing/request';
import { normalizeSearchText } from './normalize';
import { rankPlaces, type Place, type RankedPlace } from './ranking';

export const SEARCH_DIRECTORY = new Directory(Paths.document, 'search');
export const SEARCH_DATABASE_FILE = new File(SEARCH_DIRECTORY, 'search.sqlite');

/** 並べ直す前に取り出す数。よく出る言葉（「駅」など）でも、優先度の高いものから取る */
const CANDIDATE_LIMIT = 400;
/** trigram は3文字から。2文字以下は LIKE で探す */
const TRIGRAM_MINIMUM_LENGTH = 3;

type PlaceRow = {
  id: number;
  name: string;
  readings: string | null;
  category: string;
  priority: number;
  city: string | null;
  address: string | null;
  longitude: number;
  latitude: number;
  extra: string | null;
  search_text: string;
};

let database: Promise<SQLiteDatabase> | null = null;

function open(): Promise<SQLiteDatabase> {
  if (!database) {
    const directory = decodeURIComponent(SEARCH_DIRECTORY.uri.replace('file://', '')).replace(/\/$/, '');
    database = openDatabaseAsync('search.sqlite', { useNewConnection: true }, directory);
  }
  return database;
}

export function hasSearchData(): boolean {
  return SEARCH_DATABASE_FILE.exists;
}

export async function searchPlaces(query: string, here: Coordinate | null, limit = 30): Promise<RankedPlace[]> {
  const normalized = normalizeSearchText(query);
  if (normalized === '') return [];
  const db = await open();
  const rows =
    normalized.length >= TRIGRAM_MINIMUM_LENGTH
      ? await db.getAllAsync<PlaceRow>(
          `SELECT p.* FROM places_search s JOIN places p ON p.id = s.rowid
           WHERE places_search MATCH ? ORDER BY p.priority DESC LIMIT ?`,
          [`"${normalized.replace(/"/g, '""')}"`, CANDIDATE_LIMIT],
        )
      : await db.getAllAsync<PlaceRow>(
          'SELECT * FROM places WHERE search_text LIKE ? ORDER BY priority DESC LIMIT ?',
          [`%${normalized.replace(/[%_]/g, '')}%`, CANDIDATE_LIMIT],
        );
  const places: Place[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    readings: row.readings,
    category: row.category,
    priority: row.priority,
    city: row.city,
    address: row.address,
    longitude: row.longitude,
    latitude: row.latitude,
    extra: row.extra,
    searchText: row.search_text,
  }));
  return rankPlaces(places, query, here, limit);
}
