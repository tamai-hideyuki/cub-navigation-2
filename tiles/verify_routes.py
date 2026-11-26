"""PoC 4: 関西の地点の組でルートを引き、消した道を通っていないかを確かめる（設計書 2.4）。

Valhalla の /route でルートを引き、その形を /trace_attributes（edge_walk）に通して、
通った道の OSM の way の ID・道の種類・有料かを取る。way の ID を消した道の一覧と突き合わせる。

使い方: python verify_routes.py data/out/removed-ids.txt data/out/removals.json [http://localhost:8002]
"""

import json
import sys
import time
import urllib.request
from collections import defaultdict

PLACES = {
    "大阪駅": (135.4959, 34.7025),
    "京都駅": (135.7588, 34.9858),
    "三宮": (135.1955, 34.6946),
    "奈良駅": (135.8195, 34.6809),
    "姫路駅": (134.6908, 34.8268),
    "和歌山駅": (135.1910, 34.2321),
    "大津駅": (135.8586, 35.0035),
    "関西空港": (135.2442, 34.4325),
    "舞鶴": (135.3340, 35.4672),
    "新宮": (135.9909, 33.7244),
    "豊岡": (134.8200, 35.5440),
    "彦根": (136.2615, 35.2744),
    "相生": (134.4680, 34.8040),
    "明石": (134.9908, 34.6491),
    "今津": (136.0270, 35.4140),
    "亀岡駅": (135.5730, 35.0160),
    "堺駅": (135.4610, 34.5810),
    "和泉府中": (135.4230, 34.4870),
    "草津駅": (135.9600, 35.0220),
    "甲西駅": (136.0580, 35.0140),
    "住道駅": (135.6260, 34.6950),
    "生駒駅": (135.7000, 34.6930),
}

PAIRS = [
    ("大阪駅", "京都駅"),
    ("三宮", "奈良駅"),
    ("姫路駅", "和歌山駅"),
    ("大津駅", "関西空港"),
    ("舞鶴", "新宮"),
    ("豊岡", "彦根"),
    ("姫路駅", "相生"),
    ("明石", "姫路駅"),
    # blocklist の区間の近く: 志賀バイパス・小松拡幅、千代原口地下トンネル、堺泉北道路
    ("大津駅", "今津"),
    ("京都駅", "亀岡駅"),
    ("堺駅", "和泉府中"),
    # 二輪車協会の一覧の区間の近く: 栗東水口道路の高架部、阪奈道路（時間帯つき）
    ("草津駅", "甲西駅"),
    ("住道駅", "生駒駅"),
]

COSTINGS = {
    "auto": {"auto": {"top_speed": 60, "use_ferry": 0, "use_tolls": 0, "use_highways": 1.0}},
    "motorcycle": {"motorcycle": {"top_speed": 60, "use_ferry": 0, "use_tolls": 0, "use_highways": 1.0}},
}


def post(base: str, path: str, body: dict) -> tuple[dict, float]:
    request = urllib.request.Request(
        base + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response), time.perf_counter() - started
    except urllib.error.HTTPError as error:
        return {"error": json.load(error)}, time.perf_counter() - started


def main() -> None:
    removed_path, removals_path = sys.argv[1], sys.argv[2]
    base = sys.argv[3] if len(sys.argv) > 3 else "http://localhost:8002"
    removed = {int(line[1:]) for line in open(removed_path) if line.startswith("w")}
    suspicious = {s["id"]: s["name"] for s in json.load(open(removals_path, encoding="utf-8"))["suspiciousWays"]}

    results = []
    for costing_name, costing in COSTINGS.items():
        for origin, destination in PAIRS:
            name, options = next(iter(costing.items()))
            body = {
                "locations": [
                    {"lon": PLACES[origin][0], "lat": PLACES[origin][1]},
                    {"lon": PLACES[destination][0], "lat": PLACES[destination][1]},
                ],
                "costing": name,
                "costing_options": {name: options},
                "units": "kilometers",
                "language": "ja-JP",
            }
            route, seconds = post(base, "/route", body)
            row = {"costing": costing_name, "from": origin, "to": destination, "seconds": round(seconds, 2)}
            if "error" in route:
                row["error"] = route["error"].get("error", str(route["error"]))
                results.append(row)
                continue
            trip = route["trip"]
            row["km"] = round(trip["summary"]["length"], 1)
            row["minutes"] = round(trip["summary"]["time"] / 60)
            row["maneuvers"] = sum(len(leg["maneuvers"]) for leg in trip["legs"])

            attributes, _ = post(
                base,
                "/trace_attributes",
                {
                    "encoded_polyline": trip["legs"][0]["shape"],
                    "shape_match": "edge_walk",
                    "costing": name,
                    "costing_options": {name: options},
                    "filters": {
                        "attributes": ["edge.way_id", "edge.road_class", "edge.toll", "edge.length", "edge.names"],
                        "action": "include",
                    },
                },
            )
            km_by_class = defaultdict(float)
            hit_removed, hit_suspicious = set(), defaultdict(float)
            toll_km = 0.0
            for edge in attributes.get("edges", []):
                length = edge.get("length", 0)
                km_by_class[edge.get("road_class", "?")] += length
                if edge.get("toll"):
                    toll_km += length
                way_id = edge.get("way_id")
                if way_id in removed:
                    hit_removed.add(way_id)
                if way_id in suspicious:
                    hit_suspicious[suspicious[way_id]] += length
            row["matchedEdges"] = len(attributes.get("edges", []))
            row["kmByClass"] = {k: round(v, 1) for k, v in sorted(km_by_class.items(), key=lambda x: -x[1])}
            row["motorwayKm"] = round(km_by_class.get("motorway", 0.0), 2)
            row["tollKm"] = round(toll_km, 2)
            row["removedWaysHit"] = sorted(hit_removed)
            row["suspiciousKm"] = {k: round(v, 2) for k, v in hit_suspicious.items()}
            results.append(row)

    json.dump(results, open("data/out/routes.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("条件 | 出発 → 到着 | 距離 | 時間 | 計算 | motorway | 有料 | 消した道 | 怪しい道")
    for r in results:
        if "error" in r:
            print(f"{r['costing']} | {r['from']} → {r['to']} | ルートなし: {r['error']} | {r['seconds']}s")
            continue
        print(
            f"{r['costing']} | {r['from']} → {r['to']} | {r['km']}km | {r['minutes']}分 | {r['seconds']}s"
            f" | {r['motorwayKm']}km | {r['tollKm']}km | {len(r['removedWaysHit'])}本"
            f" | {', '.join(f'{k} {v}km' for k, v in r['suspiciousKm'].items()) or '-'}"
        )


if __name__ == "__main__":
    main()
