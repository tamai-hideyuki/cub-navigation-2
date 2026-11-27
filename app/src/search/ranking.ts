// 検索の結果の並べ方。画面・端末に依存しない
// 名前がぴったり合う → 名前の先頭が合う → 途中が合う、の順。同じ段の中は、種類の優先度と今いる場所からの近さで並べる
import { distanceMeters } from '../navigation/geometry.ts';
import type { Coordinate } from '../routing/request.ts';
import { normalizeSearchText } from './normalize.ts';

export type Place = {
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
  searchText: string;
};

export type RankedPlace = Place & { distanceMeters: number | null; matchLevel: 0 | 1 | 2 };

/**
 * 近さの効き方。遠くなるほど緩やかに下がる（1km で 3、10km で 10、100km で 20 くらい）。
 * 遠くの有名な場所（伊勢神宮・おかげ横丁など）が、近くの小さなお店に負けないように
 */
const DISTANCE_WEIGHT = 10;

export function rankPlaces(
  places: Place[],
  query: string,
  here: Coordinate | null,
  limit: number,
): RankedPlace[] {
  const normalizedQuery = normalizeSearchText(query);
  const ranked = places.map((place): RankedPlace => {
    const normalizedName = normalizeSearchText(place.name);
    // 読み（英語・ひらがな・別名など）の先頭が合うものも「先頭が合う」に入れる
    const readings = (place.readings ?? '').split(/\s{1}(?=\S)/).map(normalizeSearchText);
    const matchLevel: 0 | 1 | 2 =
      normalizedName === normalizedQuery || readings.includes(normalizedQuery)
        ? 0
        : normalizedName.startsWith(normalizedQuery) ||
            readings.some((reading) => reading.startsWith(normalizedQuery))
          ? 1
          : 2;
    const meters = here
      ? distanceMeters([here.longitude, here.latitude], [place.longitude, place.latitude])
      : null;
    return { ...place, distanceMeters: meters, matchLevel };
  });
  const score = (place: RankedPlace) =>
    place.priority -
    (place.distanceMeters === null
      ? 0
      : DISTANCE_WEIGHT * Math.log10(1 + place.distanceMeters / 1000));
  ranked.sort(
    (a, b) => a.matchLevel - b.matchLevel || score(b) - score(a) || a.name.length - b.name.length,
  );
  return ranked.slice(0, limit);
}

/** 結果の2行目（種類・市区町村・距離） */
export function placeSubtitle(place: RankedPlace): string {
  const parts = [place.category, place.city ?? ''];
  if (place.distanceMeters !== null) {
    parts.push(
      place.distanceMeters < 1000
        ? `${Math.round(place.distanceMeters / 10) * 10}m`
        : `${(place.distanceMeters / 1000).toFixed(place.distanceMeters < 10_000 ? 1 : 0)}km`,
    );
  }
  return parts.filter((part) => part !== '').join(' · ');
}
