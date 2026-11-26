"""対象の府県の境界をつなぎ、外側に余白を付けた範囲を GeoJSON で書く（設計書 2.2）。
範囲の箱（西,南,東,北）も area.bounds に書く（build_map.sh とアプリが使う）。

使い方: python make_area.py prefectures.geojson area.geojson [余白のメートル]
  python make_area.py --codes  … 対象の府県のコードを , でつないで出す（prepare.sh が使う）
"""

import json
import math
import sys

from shapely.geometry import mapping, shape
from shapely.ops import transform, unary_union

# 対象の府県（ISO 3166-2）。三重・滋賀・京都・大阪・兵庫・奈良・和歌山
# 三重県は 2026-11-26 に足した（伊勢へ行くため）
PREFECTURES = {"JP-24", "JP-25", "JP-26", "JP-27", "JP-28", "JP-29", "JP-30"}
DEFAULT_MARGIN_METERS = 2000
METERS_PER_DEGREE_LATITUDE = 111_320


def main() -> None:
    if sys.argv[1] == "--codes":
        print(",".join(sorted(PREFECTURES)))
        return
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
    bounds = ",".join(f"{v:.3f}" for v in padded.bounds)
    with open(target.replace(".geojson", ".bounds"), "w") as f:
        f.write(bounds + "\n")
    print(f"範囲: {len(PREFECTURES)}府県 + 余白 {margin:.0f}m, 外形 {padded.geom_type}, 範囲の箱 {bounds}")


if __name__ == "__main__":
    main()
