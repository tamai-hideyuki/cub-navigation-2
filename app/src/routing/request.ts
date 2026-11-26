// Valhalla に渡すルートの要求を組み立てる（設計書 2.1・3 章）。画面・端末に依存しない
// 通れない道はタイルからすでに消してあるので、ここでは道を避ける条件は付けない
// 時間帯で通れない道は、タイルに規制として入れてある。Valhalla は motorcycle の計算で、
// 出発の時刻（date_time）を渡したときだけその規制を見るので、時刻は必ず付ける

export type Coordinate = { longitude: number; latitude: number };

export type RouteRequestOptions = {
  /** 出発地で進んでいる向き（度、北が 0 で時計回り）。リルートで U ターンさせないため */
  headingDegrees?: number | null;
  /** 出発の時刻。無ければ今 */
  departAt?: Date;
};

/** 上限の速さ。原付二種でも一般道は 60km/h まで */
export const TOP_SPEED_KILOMETERS_PER_HOUR = 60;

/**
 * 計算の条件（PoC 4 で決めた。設計書 2.1）
 * - motorcycle で計算する。auto は二輪の時間帯の規制（motorcycle:conditional）を見ない
 * - use_highways は 1。0 にすると国道（trunk）まで避けて遠回りになる
 * - フェリーは使わない
 */
export const COSTING = 'motorcycle';

export const COSTING_OPTIONS = {
  motorcycle: {
    top_speed: TOP_SPEED_KILOMETERS_PER_HOUR,
    use_ferry: 0,
    use_tolls: 0,
    use_highways: 1,
  },
} as const;

/** 進む向きの許す幅（度）。Valhalla の既定は 60 */
const HEADING_TOLERANCE_DEGREES = 45;

export function buildRouteRequest(origin: Coordinate, destination: Coordinate, options: RouteRequestOptions = {}) {
  const heading = options.headingDegrees;
  const hasHeading = heading !== null && heading !== undefined && Number.isFinite(heading) && heading >= 0;
  return {
    locations: [
      {
        lon: origin.longitude,
        lat: origin.latitude,
        ...(hasHeading ? { heading: Math.round(heading) % 360, heading_tolerance: HEADING_TOLERANCE_DEGREES } : {}),
      },
      { lon: destination.longitude, lat: destination.latitude },
    ],
    costing: COSTING,
    costing_options: COSTING_OPTIONS,
    // type 1: 出発の時刻。値は出発地の時刻（日本の時刻）で書く
    date_time: { type: 1, value: formatJapanTime(options.departAt ?? new Date()) },
    units: 'kilometers',
    language: 'ja-JP',
  };
}

/** 日本の時刻（UTC+9）で「2026-11-29T03:00」の形にする。iPhone の時刻の設定が日本でなくても同じになる */
export function formatJapanTime(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

/** Valhalla の答えから、距離（km）・時間（分）・曲がる所の数を取り出す */
export function summarizeRouteResponse(response: unknown): { kilometers: number; minutes: number; maneuverCount: number } {
  const trip = (response as { trip?: { summary?: { length?: number; time?: number }; legs?: { maneuvers?: unknown[] }[] } }).trip;
  if (!trip?.summary) throw new Error('Valhalla の答えに trip.summary が無い');
  return {
    kilometers: Math.round((trip.summary.length ?? 0) * 10) / 10,
    minutes: Math.round((trip.summary.time ?? 0) / 60),
    maneuverCount: (trip.legs ?? []).reduce((sum, leg) => sum + (leg.maneuvers?.length ?? 0), 0),
  };
}
