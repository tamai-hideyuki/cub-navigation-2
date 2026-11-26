"""県警の交通規制のオープンデータ（JARTIC）から、原付二種に関係する通行止めを取り出し、OSM の道と突き合わせる（設計書 2.3）。

出典: 公益財団法人日本道路交通情報センター「交通規制情報」
  https://www.jartic.or.jp/d/opendata/  （2026-11-01 公開、2026 年 9 月時点のデータ）を加工して作成
仕様: 拡張版標準フォーマット説明書 ver k_2.1（typeD_kisei_73_k_2.1.pdf）

原付二種（125cc 以下の普通自動二輪車）が対象に入る符号:
  カテゴリ A: 1 車両・2 自動車（自動車には自動二輪車が入る）
  カテゴリ D: 1 二輪・2 自二輪（大型・普通自動二輪車）・5 小二輪（125cc 以下）
  D の 4 原付（一般原付）だけの規制は関係ない
規制の種類: 4 通行止め・5 車両通行止め だけを見る。6 は二人乗りだけの禁止なので外す

分け方:
  twowheel   … 二輪に向けた規制（車には掛からない）。時間帯つきでも消す
  all-day    … 車全部の終日の通行止め。消す
  timed      … 車全部の時間帯つきの通行止め。数えるだけ（いつも消すと住宅地の道が大量に消える）

使い方: python jartic_bans.py data/jartic data/ways.geojsonseq data/way-index.jsonl data/jartic/bans.json
"""

import csv
import glob
import json
import math
import os
import re
import sys
from typing import Optional
from collections import Counter, defaultdict

from shapely.geometry import LineString
from shapely.strtree import STRtree

TWO_WHEEL_A = {1, 2}
TWO_WHEEL_D = {1, 2, 5}
CAR_A = {1, 2, 3, 4, 5}
ROUTABLE = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary",
    "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street",
    "service", "road", "track",
}
MATCH_BUFFER_METERS = 20
MATCH_MINIMUM_FRACTION = 0.6
LATITUDE_ORIGIN = 34.5
LONGITUDE_ORIGIN = 136.0
METERS_X = 111_320 * math.cos(math.radians(LATITUDE_ORIGIN))
METERS_Y = 110_950


def flat(coordinates):
    return [((x - LONGITUDE_ORIGIN) * METERS_X, (y - LATITUDE_ORIGIN) * METERS_Y) for x, y in coordinates]


def bits(code: str) -> "set[int]":
    """'10010' → {2, 5}（右から 1 番目が符号 1）"""
    code = (code or "").strip()
    return {index + 1 for index, character in enumerate(reversed(code)) if character == "1"}


def detect_encoding(path: str) -> str:
    """県警によって UTF-8 と Shift_JIS（cp932）が混ざっている"""
    with open(path, "rb") as f:
        head = f.read(4096)
    try:
        head.decode("utf-8")
        return "utf-8-sig"
    except UnicodeDecodeError:
        return "cp932"


def parse_points(text: str) -> "list[tuple[float, float]]":
    """「経度 緯度;経度 緯度」も「緯度/経度;…」もある。日本では経度が 120〜150、緯度が 20〜46 なので、大きさで見分ける"""
    points = []
    for part in re.split(r"[;\n]", text or ""):
        values = [float(v) for v in re.split(r"[\s/,]+", part.strip()) if v]
        if len(values) != 2:
            continue
        a, b = values
        points.append((a, b) if a > b else (b, a))
    return points


def mentions_two_wheel(text: str) -> bool:
    """文章に、原付二種が入る書き方があるか（「一般原動機付自転車」だけは入らない）"""
    text = text or ""
    if re.search(r"(自動二輪車|二輪の自動車|小型二輪|125|０．１２５|0\.125|第２種原動機|第2種原動機)", text):
        return True
    return False


def excludes_two_wheel(text: str) -> bool:
    """文章で、原付二種が除外されているか（「…自動二輪車を除く」「除外車両：…125cc以下の二輪」）"""
    text = text or ""
    if re.search(r"除外車両[^\]]*(二輪|125)", text):
        return True
    return bool(re.search(r"(自動二輪車|二輪)[^。]{0,20}を除く", text))


def classify(row: dict) -> "tuple[Optional[str], str]":
    """(分け方, 時間の文)。分け方は twowheel（二輪に向けた規制）・all-day・timed。関係ない規制は (None, '')

    県警ごとに書き方が違う（設計書 2.3）:
      大阪は規制の名前（通禁（二輪）など）と文章、兵庫は規制の名前、京都・滋賀は「その他」の符号（15）、
      奈良・兵庫は二輪の符号、和歌山は対象の車両をほとんど書かない
    「その他」（D の 15）は中身が分からないので、文章が無ければ安全側で二輪に入れる
    """
    if row["共通規制種別コード"] not in ("4", "5"):
        return None, ""
    name = row.get("県別規制種別名称", "") or ""
    text = (row.get("規制条件", "") or "") + " " + (row.get("規制内容", "") or "")
    targets_two_wheel = False
    targets_cars = False
    times = []
    for n in range(1, 6):
        a = bits(row.get(f"対象車両コード{n}_A", ""))
        b = bits(row.get(f"対象車両コード{n}_B", ""))
        c = bits(row.get(f"対象車両コード{n}_C", ""))
        d = bits(row.get(f"対象車両コード{n}_D", ""))
        start, end = row.get(f"規制時間{n}_開始", ""), row.get(f"規制時間{n}_終了", "")
        days, period = row.get(f"規制曜日コード{n}", ""), row.get(f"対象期間{n}_開始", "")
        if not (a or b or c or d or start or days or period):
            continue
        two = bool(a & TWO_WHEEL_A) or bool(d & TWO_WHEEL_D)
        if 15 in d and not re.search(r"特定原付|特定小型", text):
            two = True  # 「その他」: 中身が分からないので安全側
        cars = bool(a & CAR_A)
        if two:
            targets_two_wheel = True
            targets_cars = targets_cars or cars
            if start and not (start.lstrip("0") in ("", "0") and end in ("2400",)):
                times.append(f"{start}-{end}" + (f" 曜日{days}" if days else ""))
            elif days or period:
                times.append(f"{start}-{end} 曜日{days} 期間{period}")
    if not targets_two_wheel and not any(row.get(f"対象車両コード{n}_{k}", "").strip("0") for n in range(1, 6) for k in "ABCD"):
        # 対象の車両が書かれていない（和歌山など）。名前と文章で決める
        if "二輪" in name or mentions_two_wheel(text):
            targets_two_wheel = mentions_two_wheel(text) or "二輪" in name
        elif re.search(r"車両|通行止め|通禁$", name) or row["共通規制種別コード"] == "4":
            targets_two_wheel, targets_cars = True, True
    if "二輪" in name and not targets_two_wheel and mentions_two_wheel(text):
        targets_two_wheel = True
    if "二輪" in name and re.fullmatch(r"\s*一般原動機付自転車[^、]*", text.strip()):
        return None, ""  # 一般原付だけ（大阪の「通禁（二輪）」の一部）
    if not targets_two_wheel:
        return None, ""
    for n in range(1, 6):
        excluded_a = bits(row.get(f"除外車両コード{n}_A", ""))
        excluded_d = bits(row.get(f"除外車両コード{n}_D", ""))
        timed_exclusion = row.get(f"除外時間{n}_開始", "") or row.get(f"除外曜日コード{n}", "")
        if (excluded_d & TWO_WHEEL_D or excluded_a & TWO_WHEEL_A) and not timed_exclusion:
            return None, ""
    if excludes_two_wheel(text):
        return None, ""
    all_day = not times and "時" not in re.sub(r"終日", "", text)
    time_text = "終日" if all_day else (" / ".join(times) or text.strip()[:80])
    if not targets_cars:
        return "twowheel", time_text
    return ("all-day" if all_day else "timed"), time_text


def main() -> None:
    jartic_dir, ways_path, index_path, out_path = sys.argv[1:5]
    index = {}
    with open(index_path, encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            if row["highway"] in ROUTABLE:
                index[row["id"]] = row
    geometries, way_ids = [], []
    with open(ways_path, encoding="utf-8") as f:
        for line in f:
            feature = json.loads(line.lstrip("\x1e"))
            way_id = int(str(feature["properties"]["@id"]).lstrip("w"))
            if way_id not in index or feature["geometry"]["type"] != "LineString":
                continue
            coordinates = feature["geometry"]["coordinates"]
            if len(coordinates) < 2:
                continue
            geometries.append(LineString(flat(coordinates)))
            way_ids.append(way_id)
    tree = STRtree(geometries)

    results, counts = [], defaultdict(Counter)
    for csv_path in sorted(glob.glob(os.path.join(jartic_dir, "**", "*.csv"), recursive=True)):
        prefecture = os.path.basename(csv_path).split("_")[0]
        with open(csv_path, encoding=detect_encoding(csv_path), newline="") as f:
            for row in csv.DictReader(f):
                category, time_text = classify(row)
                if category is None:
                    continue
                if row["点・線・面コード"] != "2":
                    counts[prefecture][f"{category}（点・面で突き合わせない）"] += 1
                    continue
                points = parse_points(row["規制場所の経度緯度"])
                if len(points) < 2:
                    continue
                area = LineString(flat(points)).buffer(MATCH_BUFFER_METERS)
                kept, removed = [], []
                for position in tree.query(area):
                    geometry = geometries[position]
                    if geometry.length < 5:
                        continue
                    if geometry.intersection(area).length / geometry.length < MATCH_MINIMUM_FRACTION:
                        continue
                    way = index[way_ids[position]]
                    (removed if way["removed"] else kept).append(way["id"])
                counts[prefecture][category] += 1
                if kept:
                    counts[prefecture][f"{category}（残っている道あり）"] += 1
                results.append(
                    {
                        "prefecture": prefecture,
                        "key": row["ユニークキー"],
                        "category": category,
                        "time": time_text,
                        "name": row.get("路線名(代表)") or row.get("県別規制種別名称"),
                        "from": row.get("規制場所始点", ""),
                        "to": row.get("規制場所終点", ""),
                        "lengthMeters": row.get("距離・延長", ""),
                        "keptWayIds": sorted(kept),
                        "removedWayIds": sorted(removed),
                    }
                )
    json.dump(results, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for prefecture, counter in counts.items():
        print(prefecture, dict(sorted(counter.items())))


if __name__ == "__main__":
    main()
