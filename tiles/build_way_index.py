"""道を探すための索引を作る（規制の一覧と OSM の道を突き合わせるため）。

1行に1本の道: id・名前・ref・道の種類・中心の座標・長さ（km）・消した理由（無ければ空）。

使い方: python build_way_index.py ways.geojsonseq ways.opl blocklist.json allowlist.json way-index.jsonl
  ways.geojsonseq: osmium export ways.osm.pbf -f geojsonseq -a id で作る
"""

import json
import math
import sys

from select_removals import load_list, parse_opl_way, reasons_for


def length_km(coords) -> float:
    total = 0.0
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        dx = (x2 - x1) * math.cos(math.radians((y1 + y2) / 2)) * 111.32
        dy = (y2 - y1) * 111.32
        total += math.hypot(dx, dy)
    return total


def main() -> None:
    geo_path, opl_path, block_path, allow_path, out_path = sys.argv[1:6]
    blocklist, allowlist = load_list(block_path), load_list(allow_path)
    geometry = {}
    with open(geo_path, encoding="utf-8") as f:
        for line in f:
            feature = json.loads(line.lstrip("\x1e"))
            if feature["geometry"]["type"] != "LineString":
                continue
            way_id = int(str(feature["properties"]["@id"]).lstrip("w"))
            coords = feature["geometry"]["coordinates"]
            middle = coords[len(coords) // 2]
            geometry[way_id] = (round(middle[0], 5), round(middle[1], 5), round(length_km(coords), 3))

    with open(opl_path, encoding="utf-8") as f, open(out_path, "w", encoding="utf-8") as out:
        for line in f:
            if not line.startswith("w"):
                continue
            way_id, tags, _ = parse_opl_way(line)
            if way_id not in geometry:
                continue
            reasons = reasons_for(tags)
            if way_id in blocklist:
                reasons.append("blocklist")
            if way_id in allowlist and not (set(reasons) & {"motorway", "motorroad", "toll", "ferry"}) and "blocklist" not in reasons:
                reasons = []
            lon, lat, km = geometry[way_id]
            row = {
                "id": way_id,
                "name": tags.get("name"),
                "ref": tags.get("ref"),
                "highway": tags.get("highway"),
                "lon": lon,
                "lat": lat,
                "km": km,
                "removed": sorted(set(reasons)),
            }
            extra = {k: v for k, v in tags.items() if k.startswith(("motorcycle", "moped", "motor_vehicle", "access", "toll", "tunnel", "bridge", "alt_name", "official_name"))}
            if extra:
                row["tags"] = extra
            out.write(json.dumps(row, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
