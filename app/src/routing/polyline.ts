// Valhalla のルートの形（encoded polyline、精度 6 桁）を座標に戻す。画面・端末に依存しない

/** [経度, 緯度] の並びを返す（GeoJSON と同じ順） */
export function decodePolyline6(encoded: string): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    const latitudeChange = readValue();
    const longitudeChange = readValue();
    latitude += latitudeChange;
    longitude += longitudeChange;
    coordinates.push([longitude / 1e6, latitude / 1e6]);
  }
  return coordinates;

  function readValue(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new Error('polyline が途中で切れている');
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}
