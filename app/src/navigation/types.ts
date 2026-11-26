// ナビの型（設計書 2.1）。画面・音声・位置の取得には依存しない

export type LocationReading = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null; // 水平の精度。iOS の horizontalAccuracy
  speedMetersPerSecond: number | null;
  timestampMilliseconds: number;
};

export type ClipId = string; // 例 "turn-042-far", "common-offroute"

export type TurnDirection =
  | 'left'
  | 'right'
  | 'slight_left'
  | 'slight_right'
  | 'sharp_left'
  | 'sharp_right'
  | 'keep_left'
  | 'keep_right'
  | 'uturn'
  | 'roundabout'
  | 'arrive';

export type Maneuver = {
  id: string; // "turn-042"
  distanceAlongMeters: number; // 出発からこの地点までの道なりの距離
  pointIndex: number; // geometry の何番目の点か
  direction: TurnDirection;
  roadName: string | null;
  clips: { far?: ClipId; near: ClipId };
};

export type Route = {
  schemaVersion: 1;
  name: string;
  totalMeters: number;
  geometry: [number, number][]; // [経度, 緯度]
  cumulativeMeters: number[]; // geometry[i] までの道なりの距離
  maneuvers: Maneuver[];
  /** どこで作ったルートか。computedAt はルートごとに違う値にする（保存した進み具合がどのルートのものかを見分ける） */
  source: { engine: string; osmDate: string; computedAt: string };
  /** 案内の ID（turn-0003-far など）→ 鳴らす声のファイルの ID（joined-far-left など）。無い ID はそのまま鳴らす */
  clipAudio?: Record<ClipId, ClipId>;
};

export type ProgressState = {
  segmentIndex: number; // 今いる区間（geometry[segmentIndex] → [segmentIndex + 1]）
  distanceAlongMeters: number; // 出発からの進み。減らない
  acquired: boolean; // 最初の位置合わせが済んだか
};

export type OffRouteStatus = 'on' | 'suspect' | 'off';

export type OffRouteState = {
  status: OffRouteStatus;
  awayCount: number; // 続けて離れていた回数
  backCount: number; // 続けて近かった回数
  lastWarningMilliseconds: number | null;
};

export type NavigationState = {
  routeComputedAt: string; // どのルートの状態か。同梱し直したら保存した状態を捨てる
  progress: ProgressState;
  offRoute: OffRouteState;
  playedClipIds: ClipId[]; // 鳴らしたクリップ（同じものを二度鳴らさない）
  lastReadingMilliseconds: number | null;
};

export type NavigationOutput = {
  state: NavigationState;
  clipIds: ClipId[]; // 今鳴らすもの。前から順に再生する
  debug: {
    distanceToRouteMeters: number | null;
    nextManeuverId: string | null;
    remainingMeters: number | null;
  };
};

export type NavigationConfiguration = {
  maximumAccuracyMeters: number;
  searchAheadMeters: number;
  readingGapMilliseconds: number;
  offRouteMeters: number;
  onRouteMeters: number;
  offRouteCount: number;
  onRouteCount: number;
  offRouteRepeatMilliseconds: number;
  farAnnouncementMeters: number;
  nearAnnouncementMeters: number;
  nearAnnouncementMinimumMeters: number;
};

// 閾値の根拠は設計書 4章
export const DEFAULT_CONFIGURATION: NavigationConfiguration = {
  maximumAccuracyMeters: 50,
  searchAheadMeters: 2000,
  readingGapMilliseconds: 30000,
  offRouteMeters: 50,
  onRouteMeters: 30,
  offRouteCount: 3,
  onRouteCount: 2,
  offRouteRepeatMilliseconds: 60000,
  farAnnouncementMeters: 300,
  nearAnnouncementMeters: 50,
  nearAnnouncementMinimumMeters: 10,
};

export const COMMON_CLIPS = {
  start: 'common-start',
  offRoute: 'common-offroute',
  onRoute: 'common-onroute',
  arrive: 'common-arrive',
  test: 'common-test',
} as const;
