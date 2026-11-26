// PoC 5 で計算を測る地点の組。PoC 4（tiles/verify_routes.py）と同じ組で、パソコンの結果と比べる
import type { Coordinate } from '../routing/request.ts';

export const PLACES: Record<string, Coordinate> = {
  大阪駅: { longitude: 135.4959, latitude: 34.7025 },
  京都駅: { longitude: 135.7588, latitude: 34.9858 },
  三宮: { longitude: 135.1955, latitude: 34.6946 },
  奈良駅: { longitude: 135.8195, latitude: 34.6809 },
  姫路駅: { longitude: 134.6908, latitude: 34.8268 },
  和歌山駅: { longitude: 135.191, latitude: 34.2321 },
  舞鶴: { longitude: 135.334, latitude: 35.4672 },
  新宮: { longitude: 135.9909, latitude: 33.7244 },
  豊岡: { longitude: 134.82, latitude: 35.544 },
  彦根: { longitude: 136.2615, latitude: 35.2744 },
  草津駅: { longitude: 135.96, latitude: 35.022 },
  甲西駅: { longitude: 136.058, latitude: 35.014 },
};

/** パソコン（Docker の Valhalla、motorcycle・平日 12:00 に出発）で出た距離（km）。端末の答えと合うかを見る */
export const PAIRS: { from: string; to: string; desktopKilometers: number }[] = [
  { from: '大阪駅', to: '京都駅', desktopKilometers: 47.1 },
  { from: '三宮', to: '奈良駅', desktopKilometers: 72.2 },
  { from: '姫路駅', to: '和歌山駅', desktopKilometers: 166.5 },
  { from: '舞鶴', to: '新宮', desktopKilometers: 298.4 },
  { from: '豊岡', to: '彦根', desktopKilometers: 245.5 },
  { from: '草津駅', to: '甲西駅', desktopKilometers: 10.9 },
];

/** ロック中のテストで、現在地が関西の外のときに代わりに使う組 */
export const FALLBACK_PAIR = { from: '大阪駅', to: '京都駅' };

/** 7府県（三重を含む）の範囲の箱（tiles/data/area.bounds、make_area.py の結果） */
export const AREA_BOX = { west: 134.232, south: 33.215, east: 137.347, north: 36.168 };

export function isInsideArea(point: Coordinate): boolean {
  return (
    point.longitude >= AREA_BOX.west &&
    point.longitude <= AREA_BOX.east &&
    point.latitude >= AREA_BOX.south &&
    point.latitude <= AREA_BOX.north
  );
}
