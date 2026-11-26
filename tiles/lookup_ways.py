"""索引（build_way_index.py）から道を探す。

使い方:
  python lookup_ways.py --name '伏見柳谷高槻線'               名前・ref・alt_name に含む道
  python lookup_ways.py --near 135.62,34.88 --radius 0.5      ある点から 0.5km 以内
  python lookup_ways.py --name '国道29号' --bbox 134.6,34.85,134.7,34.95
  --kept だけ付けると、消していない道だけ出す。--summary で名前ごとにまとめる
"""

import argparse
import json
import math
from collections import defaultdict

INDEX = "data/way-index.jsonl"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name")
    parser.add_argument("--near")
    parser.add_argument("--radius", type=float, default=0.5)
    parser.add_argument("--bbox")
    parser.add_argument("--kept", action="store_true")
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("--index", default=INDEX)
    args = parser.parse_args()

    near = tuple(map(float, args.near.split(","))) if args.near else None
    bbox = tuple(map(float, args.bbox.split(","))) if args.bbox else None
    hits = []
    with open(args.index, encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            if args.name:
                text = " ".join(str(v) for v in (row.get("name"), row.get("ref"), *(row.get("tags") or {}).values()) if v)
                if args.name not in text:
                    continue
            if bbox and not (bbox[0] <= row["lon"] <= bbox[2] and bbox[1] <= row["lat"] <= bbox[3]):
                continue
            if near:
                dx = (row["lon"] - near[0]) * math.cos(math.radians(near[1])) * 111.32
                dy = (row["lat"] - near[1]) * 111.32
                if math.hypot(dx, dy) > args.radius:
                    continue
            if args.kept and row["removed"]:
                continue
            hits.append(row)

    if args.summary:
        groups = defaultdict(lambda: {"ways": 0, "km": 0.0, "kept_km": 0.0, "reasons": defaultdict(float)})
        for row in hits:
            g = groups[(row.get("name"), row.get("highway"))]
            g["ways"] += 1
            g["km"] += row["km"]
            if row["removed"]:
                for r in row["removed"]:
                    g["reasons"][r] += row["km"]
            else:
                g["kept_km"] += row["km"]
        for (name, highway), g in sorted(groups.items(), key=lambda x: -x[1]["km"]):
            reasons = ", ".join(f"{r} {km:.1f}km" for r, km in g["reasons"].items()) or "-"
            print(f"{name} [{highway}] {g['ways']}本 {g['km']:.1f}km 残り {g['kept_km']:.1f}km 消した理由: {reasons}")
        return
    for row in hits:
        print(json.dumps(row, ensure_ascii=False))


if __name__ == "__main__":
    main()
