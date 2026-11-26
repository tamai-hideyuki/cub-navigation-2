"""6府県の境界をつなぎ、外側に余白を付けた範囲を GeoJSON で書く（設計書 2.2）。

使い方: python make_area.py pref6.geojson area.geojson [余白のメートル]
"""

import json
import math
import sys

from shapely.geometry import mapping, shape
from shapely.ops import transform, unary_union

PREFECTURES = {"JP-25", "JP-26", "JP-27", "JP-28", "JP-29", "JP-30"}
DEFAULT_MARGIN_METERS = 2000
METERS_PER_DEGREE_LATITUDE = 111_320


def main() -> None:
    source, target = sys.argv[1], sys.argv[2]
    margin = float(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_MARGIN_METERS

    features = json.load(open(source, encoding="utf-8"))["features"]
    shapes = [shape(f["geometry"]) for f in features if f["properties"].get("ISO3166-2") in PREFECTURES]
    found = {f["properties"]["ISO3166-2"] for f in features if f["properties"].get("ISO3166-2") in PREFECTURES}
    if found != PREFECTURES:
        sys.exit(f"府県の境界が足りない: {sorted(PREFECTURES - found)}")

    area = unary_union(shapes)

    # 経度の1度の長さは緯度で変わるので、範囲の真ん中の緯度で横を縮めてから余白を付ける
    scale = math.cos(math.radians(area.centroid.y))
    to_flat = lambda x, y, z=None: (x * scale, y)
    from_flat = lambda x, y, z=None: (x / scale, y)
    margin_degrees = margin / METERS_PER_DEGREE_LATITUDE
    padded = transform(from_flat, transform(to_flat, area).buffer(margin_degrees))
    padded = padded.simplify(margin_degrees / 10)

    json.dump(
        {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": mapping(padded)}]},
        open(target, "w", encoding="utf-8"),
    )
    print(f"範囲: 6府県 + 余白 {margin:.0f}m, 外形 {padded.geom_type}, 範囲の箱 {[round(v, 3) for v in padded.bounds]}")


if __name__ == "__main__":
    main()
