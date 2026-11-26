"""PoC 4: 関西の地点の組でルートを引き、消した道を通っていないかを確かめる（設計書 2.4）。

Valhalla の /route でルートを引き、その形を /trace_attributes（edge_walk）に通して、
通った道の OSM の way の ID・道の種類・有料かを取る。way の ID を消した道の一覧と突き合わせる。
アプリと同じ motorcycle の計算に、出発の時刻（date_time）を付けて引く。auto は比べるために引く。

時間帯の規制（TIME_CASES）: 同じ地点の組を、規制の時間と、そうでない時間に引き、
規制の時間だけ、規制のある道（data/out/time-rules.json）を通らないことを確かめる。

使い方: python verify_routes.py data/out/removed-ids.txt data/out/removals.json [http://localhost:8002]
  どれかが通らなければ、終わりのコードが 1 になる
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
    "おかげ横丁": (136.7253, 34.4625),
    "四日市駅": (136.6197, 34.9633),
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
    # 三重県（2026-11-26 に足した）
    ("大阪駅", "おかげ横丁"),
    ("奈良駅", "おかげ横丁"),
    ("京都駅", "四日市駅"),
]

# ルートが出ないのが正しい組（関西空港へは、連絡橋が motorway なので 125cc では行けない）
NO_ROUTE_PAIRS = {("大津駅", "関西空港")}

COSTINGS = {
    "motorcycle": {"motorcycle": {"top_speed": 60, "use_ferry": 0, "use_tolls": 0, "use_highways": 1.0}},
    "auto": {"auto": {"top_speed": 60, "use_ferry": 0, "use_tolls": 0, "use_highways": 1.0}},
}
# 地点の組を引く時刻（平日の昼）。auto は時刻の規制を見ないので付けない
WEEKDAY_NOON = "2026-11-30T12:00"

# 時間帯の規制の確かめ: (名前, 出発, 到着, [(時刻, 規制のある道を通るか)])。
# 通らないときは「ルートなし」でもよい（出発・到着が規制のある道の上）
TIME_CASES = [
    # 阪奈道路「Su,PH 00:00-06:00」。土曜 23:50 に出ても、着く日曜 0 時過ぎは通れない。11/23 は勤労感謝の日
    ("阪奈道路", (135.626, 34.695), (135.700, 34.693),
     [("2026-11-30T12:00", True), ("2026-11-29T03:00", False), ("2026-11-23T03:00", False), ("2026-11-28T23:50", False)]),
    # 裏六甲ドライブウェイ（二輪車協会の一覧 67・71）「土曜・日曜・休日は終日」
    ("裏六甲ドライブウェイ", (135.2310, 34.7565), (135.2100, 34.7750),
     [("2026-11-27T12:00", True), ("2026-11-28T12:00", False), ("2026-11-23T12:00", False)]),
    # 桜井明日香吉野線（一覧 91）「日曜・休日は終日」
    ("桜井明日香吉野線", (135.8249, 34.4660), (135.8236, 34.4840),
     [("2026-11-30T12:00", True), ("2026-11-29T12:00", False)]),
    # 河内長野市 滝畑～天野（一覧 33）「日曜・休日の前日 21〜24 時、日曜・休日 0〜5 時」。11/22 は祝日の前の日
    ("河内長野 滝畑～天野", (135.52692, 34.3995), (135.53179, 34.4275),
     [("2026-11-27T22:00", True), ("2026-11-28T22:00", False), ("2026-11-29T03:00", False), ("2026-11-29T06:00", True),
      ("2026-11-22T22:00", False)]),
    # 有田市道（一覧 92）「平日 7:30〜8:30」
    ("有田市道", (135.1215, 34.0820), (135.1240, 34.0800),
     [("2026-11-30T12:00", True), ("2026-11-30T07:45", False), ("2026-11-28T07:45", True)]),
]


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


def route_body(origin, destination, costing_name: str, date_time=None) -> dict:
    options = COSTINGS[costing_name][costing_name]
    body = {
        "locations": [{"lon": origin[0], "lat": origin[1]}, {"lon": destination[0], "lat": destination[1]}],
        "costing": costing_name,
        "costing_options": {costing_name: options},
        "units": "kilometers",
        "language": "ja-JP",
    }
    if date_time:
        body["date_time"] = {"type": 1, "value": date_time}  # 1: 出発の時刻（その場所の時刻）
    return body


def way_ids_of(base: str, route: dict, costing_name: str) -> list[int]:
    attributes, _ = post(
        base,
        "/trace_attributes",
        {
            "encoded_polyline": route["trip"]["legs"][0]["shape"],
            "shape_match": "edge_walk",
            "costing": costing_name,
            "costing_options": {costing_name: COSTINGS[costing_name][costing_name]},
            "filters": {"attributes": ["edge.way_id"], "action": "include"},
        },
    )
    return [edge["way_id"] for edge in attributes.get("edges", []) if "way_id" in edge]


def check_time_cases(base: str, timed: set[int]) -> bool:
    print("\n時間帯の規制 | 出発の時刻 | 規制のある道 | 結果")
    passed = True
    for name, origin, destination, checks in TIME_CASES:
        for date_time, expect_use in checks:
            route, _ = post(base, "/route", route_body(origin, destination, "motorcycle", date_time))
            if "error" in route:
                used = False
                detail = "ルートなし"
            else:
                used = any(way_id in timed for way_id in way_ids_of(base, route, "motorcycle"))
                detail = f"{route['trip']['summary']['length']:.1f}km"
            ok = used == expect_use
            passed &= ok
            print(f"{name} | {date_time} | {'通る' if used else '通らない'}（{detail}） | {'OK' if ok else 'ちがう'}")
    return passed


def main() -> None:
    removed_path, removals_path = sys.argv[1], sys.argv[2]
    base = sys.argv[3] if len(sys.argv) > 3 else "http://localhost:8002"
    removed = {int(line[1:]) for line in open(removed_path) if line.startswith("w")}
    suspicious = {s["id"]: s["name"] for s in json.load(open(removals_path, encoding="utf-8"))["suspiciousWays"]}
    timed = {int(k) for k in json.load(open("data/out/time-rules.json"))}

    results = []
    for costing_name, costing in COSTINGS.items():
        for origin, destination in PAIRS:
            name, options = next(iter(costing.items()))
            date_time = WEEKDAY_NOON if name == "motorcycle" else None
            route, seconds = post(base, "/route", route_body(PLACES[origin], PLACES[destination], name, date_time))
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
    passed = True
    print("条件 | 出発 → 到着 | 距離 | 時間 | 計算 | motorway | 有料 | 消した道 | 怪しい道")
    for r in results:
        if "error" in r:
            expected = (r["from"], r["to"]) in NO_ROUTE_PAIRS
            print(f"{r['costing']} | {r['from']} → {r['to']} | ルートなし{'（正しい）' if expected else ''}: {r['error']} | {r['seconds']}s")
            passed &= expected
            continue
        if r["removedWaysHit"] or r["motorwayKm"] or r["tollKm"]:
            passed = False
        print(
            f"{r['costing']} | {r['from']} → {r['to']} | {r['km']}km | {r['minutes']}分 | {r['seconds']}s"
            f" | {r['motorwayKm']}km | {r['tollKm']}km | {len(r['removedWaysHit'])}本"
            f" | {', '.join(f'{k} {v}km' for k, v in r['suspiciousKm'].items()) or '-'}"
        )
    passed &= check_time_cases(base, timed)
    print("\nすべて通った" if passed else "\n通らないものがある")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
