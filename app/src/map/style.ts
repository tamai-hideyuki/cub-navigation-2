// 走りながら見る地図の色と描き方（設計書 5 章）。タイルは OpenMapTiles の形（tiles/ で Planetiler で作る）。
// 画面・端末に依存しない。通信は使わず、タイルとフォントは端末の中のファイルを読む

export type MapTheme = 'day' | 'night';

export type MapStyleOptions = {
  /** 地図のタイル。例 "pmtiles://file:///.../kansai.pmtiles" */
  tilesUrl: string;
  /** 英数字のフォント。例 "file:///.../fonts/{fontstack}/{range}.pbf"。日本語は iOS の文字で描く */
  glyphsUrl: string;
  theme: MapTheme;
};

type Palette = {
  background: string;
  water: string;
  park: string;
  building: string;
  roadFill: string;
  majorRoadFill: string;
  roadCasing: string;
  /** 125cc では通れない道（高速道路・有料道路） */
  forbiddenRoad: string;
  rail: string;
  boundary: string;
  label: string;
  labelHalo: string;
  waterLabel: string;
};

const PALETTES: Record<MapTheme, Palette> = {
  day: {
    background: '#F2EFE9',
    water: '#AAD3DF',
    park: '#D8E8C8',
    building: '#E0DBD2',
    roadFill: '#FFFFFF',
    majorRoadFill: '#FFF4D6',
    roadCasing: '#B4B2A9',
    forbiddenRoad: '#C9C6BE',
    rail: '#9C9A93',
    boundary: '#A7A39A',
    label: '#2C2C2A',
    labelHalo: '#FFFFFF',
    waterLabel: '#185FA5',
  },
  night: {
    background: '#1F2023',
    water: '#1B2B3A',
    park: '#22302A',
    building: '#2A2B2F',
    roadFill: '#4A4B50',
    majorRoadFill: '#6A5A38',
    roadCasing: '#2E2F33',
    forbiddenRoad: '#3A3B3F',
    rail: '#55565B',
    boundary: '#55565B',
    label: '#E8E6E1',
    labelHalo: '#1F2023',
    waterLabel: '#85B7EB',
  },
};

/** 道の太さ（ピクセル）をズームで変える。[ズーム, 太さ] の並び */
function widthByZoom(stops: [number, number][]) {
  return ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flat()];
}

const MAJOR_CLASSES = ['trunk', 'primary'];
const MIDDLE_CLASSES = ['secondary', 'tertiary'];
const MINOR_CLASSES = ['minor', 'service', 'unclassified', 'residential'];

/** 125cc では通れない道。motorway と有料。通れない道は消してからルートを計算しているが、地図には薄く描く */
const FORBIDDEN_FILTER = ['any', ['==', ['get', 'class'], 'motorway'], ['==', ['get', 'toll'], 1]];
const NOT_FORBIDDEN = ['!', FORBIDDEN_FILTER];

const LABEL_NAME = ['coalesce', ['get', 'name:ja'], ['get', 'name']];
const FONT = ['NotoSans-Regular'];
const FONT_BOLD = ['NotoSans-Medium'];

export function buildMapStyle({ tilesUrl, glyphsUrl, theme }: MapStyleOptions) {
  const palette = PALETTES[theme];
  const road = (
    id: string,
    classes: string[],
    casing: boolean,
    stops: [number, number][],
    fill: string,
  ) => ({
    id,
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    filter: ['all', ['in', ['get', 'class'], ['literal', classes]], NOT_FORBIDDEN],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: casing
      ? {
          'line-color': palette.roadCasing,
          'line-width': widthByZoom(stops.map(([z, w]) => [z, w + 2])),
        }
      : { 'line-color': fill, 'line-width': widthByZoom(stops) },
  });

  const minorStops: [number, number][] = [
    [12, 0.5],
    [14, 2],
    [18, 10],
  ];
  const middleStops: [number, number][] = [
    [8, 0.5],
    [12, 2],
    [18, 16],
  ];
  const majorStops: [number, number][] = [
    [6, 0.8],
    [10, 2.5],
    [18, 22],
  ];

  return {
    version: 8,
    name: `cub-navigation-2 ${theme}`,
    glyphs: glyphsUrl,
    sources: {
      openmaptiles: {
        type: 'vector',
        url: tilesUrl,
        attribution: '© OpenMapTiles © OpenStreetMap contributors',
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': palette.background } },
      {
        id: 'park',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood', 'farmland']]],
        paint: { 'fill-color': palette.park, 'fill-opacity': 0.6 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': palette.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        paint: {
          'line-color': palette.water,
          'line-width': widthByZoom([
            [10, 0.5],
            [16, 3],
          ]),
        },
      },
      {
        id: 'building',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 15,
        paint: { 'fill-color': palette.building },
      },
      {
        id: 'boundary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['<=', ['get', 'admin_level'], 4],
        paint: { 'line-color': palette.boundary, 'line-width': 1, 'line-dasharray': [3, 2] },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'rail'],
        paint: {
          'line-color': palette.rail,
          'line-width': widthByZoom([
            [10, 0.5],
            [16, 2],
          ]),
        },
      },
      // 125cc では通れない道: 細く薄い点線にして、通れる道と見分ける
      {
        id: 'road-forbidden',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: FORBIDDEN_FILTER,
        paint: {
          'line-color': palette.forbiddenRoad,
          'line-width': widthByZoom([
            [8, 1],
            [18, 8],
          ]),
          'line-dasharray': [2, 1.5],
        },
      },
      road('road-minor-casing', MINOR_CLASSES, true, minorStops, palette.roadFill),
      road('road-middle-casing', MIDDLE_CLASSES, true, middleStops, palette.roadFill),
      road('road-major-casing', MAJOR_CLASSES, true, majorStops, palette.majorRoadFill),
      road('road-minor', MINOR_CLASSES, false, minorStops, palette.roadFill),
      road('road-middle', MIDDLE_CLASSES, false, middleStops, palette.roadFill),
      road('road-major', MAJOR_CLASSES, false, majorStops, palette.majorRoadFill),
      {
        id: 'road-name',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 13,
        // 描いている道（通れる道）の名前だけを出す。高速道路・工事中の道の名前は出さない
        filter: [
          'in',
          ['get', 'class'],
          ['literal', [...MAJOR_CLASSES, ...MIDDLE_CLASSES, ...MINOR_CLASSES]],
        ],
        layout: {
          'symbol-placement': 'line',
          'text-field': LABEL_NAME,
          'text-font': FONT,
          'text-size': 13,
        },
        paint: {
          'text-color': palette.label,
          'text-halo-color': palette.labelHalo,
          'text-halo-width': 2,
        },
      },
      {
        id: 'water-name',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'water_name',
        layout: { 'text-field': LABEL_NAME, 'text-font': FONT, 'text-size': 13 },
        paint: {
          'text-color': palette.waterLabel,
          'text-halo-color': palette.labelHalo,
          'text-halo-width': 1.5,
        },
      },
      {
        id: 'place-name',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        filter: [
          'in',
          ['get', 'class'],
          ['literal', ['city', 'town', 'village', 'suburb', 'quarter']],
        ],
        layout: {
          'text-field': LABEL_NAME,
          'text-font': FONT_BOLD,
          'text-size': ['match', ['get', 'class'], 'city', 18, 'town', 15, 13],
        },
        paint: {
          'text-color': palette.label,
          'text-halo-color': palette.labelHalo,
          'text-halo-width': 2,
        },
      },
    ],
  };
}

/** ルートの線の色（設計書 5.2）。通った所は灰色、この先は青 */
export const ROUTE_COLORS = { ahead: '#378ADD', passed: '#B4B2A9', casing: '#185FA5' } as const;
