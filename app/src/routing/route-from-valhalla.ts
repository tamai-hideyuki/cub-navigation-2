// Valhalla の答え（/route）を、ナビの本体が使う Route に直す（設計書 3 章・4 章）。画面・端末に依存しない。
// 曲がる所の選び方は前の版（tools/route-builder.ts）と同じ:
// - 直進・合流などは案内しない
// - 前の曲がる所から 30m 未満なら案内しない（交差点の中の小さな折れ）。到着は必ず残す
// - 前の曲がる所から 400m 未満なら far（300m 手前）を鳴らさない
import { cumulativeDistances } from '../navigation/geometry.ts';
import {
  COMMON_CLIPS,
  DEFAULT_CONFIGURATION,
  type ClipId,
  type Maneuver,
  type Route,
  type TurnDirection,
} from '../navigation/types.ts';
import { decodePolyline6 } from './polyline.ts';

const MERGE_DISTANCE_METERS = 30;
const FAR_ANNOUNCEMENT_MINIMUM_GAP_METERS =
  DEFAULT_CONFIGURATION.farAnnouncementMeters + DEFAULT_CONFIGURATION.nearAnnouncementMeters * 2;

/**
 * Valhalla の案内の種類（maneuver.type）→ 向き。入っていない種類は案内しない
 * https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/ の maneuver types
 */
export const DIRECTION_BY_VALHALLA_TYPE: Record<number, TurnDirection> = {
  4: 'arrive', // destination
  5: 'arrive', // destination right
  6: 'arrive', // destination left
  9: 'slight_right',
  10: 'right',
  11: 'sharp_right',
  12: 'uturn', // uturn right
  13: 'uturn', // uturn left
  14: 'sharp_left',
  15: 'left',
  16: 'slight_left',
  18: 'keep_right', // ramp right
  19: 'keep_left', // ramp left
  20: 'keep_right', // exit right
  21: 'keep_left', // exit left
  23: 'keep_right', // stay right
  24: 'keep_left', // stay left
  26: 'roundabout', // roundabout enter
};

type ValhallaManeuver = { type: number; begin_shape_index: number; street_names?: string[] };
type ValhallaLeg = { shape: string; maneuvers: ValhallaManeuver[] };
type ValhallaResponse = {
  trip: { legs: ValhallaLeg[]; summary: { length: number; time: number } };
};

export type RouteSource = { engine: string; osmDate: string; computedAt: string };

/** 曲がる所の ID（前の版と同じ形）。案内の ID は「曲がる所ごと」に別にする（同じ声を何度でも鳴らせるように） */
function maneuverId(order: number): string {
  return `turn-${String(order).padStart(4, '0')}`;
}

export function routeFromValhalla(response: unknown, name: string, source: RouteSource): Route {
  const trip = (response as ValhallaResponse).trip;
  if (!trip?.legs?.length) throw new Error('Valhalla の答えに trip.legs が無い');
  // 経由地を使わないので脚（leg）は1本。2本以上なら形をつなぎ、曲がる所の番号をずらす
  const geometry: [number, number][] = [];
  const turnPoints: { pointIndex: number; direction: TurnDirection; roadName: string | null }[] =
    [];
  for (const leg of trip.legs) {
    const offset = geometry.length === 0 ? 0 : geometry.length - 1;
    const shape = decodePolyline6(leg.shape);
    geometry.push(...(geometry.length === 0 ? shape : shape.slice(1)));
    for (const maneuver of leg.maneuvers) {
      const direction = DIRECTION_BY_VALHALLA_TYPE[maneuver.type];
      if (direction === undefined) continue;
      turnPoints.push({
        pointIndex: offset + maneuver.begin_shape_index,
        direction,
        roadName: maneuver.street_names?.find((name) => !/^\d+$/.test(name)) ?? null,
      });
    }
  }
  const cumulativeMeters = cumulativeDistances(geometry);

  const selected: typeof turnPoints = [];
  for (const turnPoint of turnPoints) {
    const previous = selected.at(-1);
    const tooClose =
      previous !== undefined &&
      cumulativeMeters[turnPoint.pointIndex] - cumulativeMeters[previous.pointIndex] <
        MERGE_DISTANCE_METERS;
    if (tooClose && turnPoint.direction !== 'arrive') continue;
    selected.push(turnPoint);
  }

  const clipAudio: Record<ClipId, ClipId> = {};
  const maneuvers = selected.map((turnPoint, order): Maneuver => {
    const id = maneuverId(order);
    const distanceAlongMeters = cumulativeMeters[turnPoint.pointIndex];
    const previousDistance = order === 0 ? 0 : cumulativeMeters[selected[order - 1].pointIndex];
    const hasFar = distanceAlongMeters - previousDistance >= FAR_ANNOUNCEMENT_MINIMUM_GAP_METERS;
    const clips: Maneuver['clips'] = { near: `${id}-near` };
    if (turnPoint.direction === 'arrive') {
      // 着く 50m 手前で「目的地に着きました」（前の版と同じ）
      clipAudio[clips.near] = COMMON_CLIPS.arrive;
    } else {
      clipAudio[clips.near] = `joined-near-${turnPoint.direction}`;
    }
    if (hasFar) {
      clips.far = `${id}-far`;
      clipAudio[clips.far] = `joined-far-${turnPoint.direction}`;
    }
    return {
      id,
      distanceAlongMeters,
      pointIndex: turnPoint.pointIndex,
      direction: turnPoint.direction,
      roadName: turnPoint.roadName,
      clips,
    };
  });

  return {
    schemaVersion: 1,
    name,
    totalMeters: cumulativeMeters.at(-1) ?? 0,
    geometry,
    cumulativeMeters,
    maneuvers,
    source,
    clipAudio,
  };
}

/** 案内の ID（turn-0003-far など）を、鳴らす声のファイルの ID（joined-far-left など）に直す。共通の声はそのまま */
export function audioClipIds(route: Route, clipIds: ClipId[]): ClipId[] {
  return clipIds.map((clipId) => route.clipAudio?.[clipId] ?? clipId);
}
