"""端末の中で目的地を名前で探すための検索のデータ（SQLite）を作る（設計書 5.1・9 章）。

OSM の名前のある地物（お店・施設・駅・地名・道・川など）を全部入れ、日本語の途中の文字でも探せるように
FTS5 の trigram で索引を作る。通信なしで探せる。

使い方: python build_search.py data/area.osm.pbf data/boundaries.osm.pbf data/search/search.sqlite
  （prepare.sh の後に動かす。osmium が要る）
"""

import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import unicodedata
from collections import Counter

from shapely.geometry import shape
from shapely.strtree import STRtree

SCHEMA_VERSION = 1

# 検索の文字をそろえる（アプリの src/search/normalize.ts と同じ決まり）
KATAKANA_TO_HIRAGANA = {code: code - 0x60 for code in range(0x30A1, 0x30F7)}


def normalize(text: str) -> str:
    """全角・半角・大文字小文字・カタカナとひらがなの違いをなくし、空白を取る"""
    text = unicodedata.normalize("NFKC", text or "").lower()
    text = text.translate(KATAKANA_TO_HIRAGANA)
    return re.sub(r"\s+", "", text)


# (タグの鍵, 値（None は何でも）, 種類の名前, 優先度)。上から順に当てはめる
CATEGORIES = [
    ("place", {"city"}, "市", 100),
    ("place", {"town"}, "町", 95),
    ("place", {"village"}, "村", 95),
    ("place", {"suburb", "quarter", "neighbourhood"}, "町名", 85),
    ("place", {"hamlet", "locality", "isolated_dwelling", "island", "islet"}, "地名", 70),
    ("railway", {"station", "halt"}, "駅", 90),
    ("public_transport", {"station"}, "駅", 90),
    ("highway", {"services", "rest_area"}, "休憩所", 80),
    ("amenity", {"fuel"}, "ガソリンスタンド", 75),
    ("amenity", {"motorcycle_parking"}, "バイク駐車場", 75),
    ("shop", {"convenience"}, "コンビニ", 70),
    ("tourism", {"attraction", "viewpoint", "museum", "theme_park", "zoo", "aquarium", "gallery"}, "観光", 75),
    ("tourism", {"hotel", "motel", "guest_house", "hostel", "camp_site", "caravan_site"}, "宿・キャンプ", 65),
    ("amenity", {"place_of_worship"}, "寺社", 60),
    ("historic", None, "史跡", 60),
    ("natural", {"peak", "volcano", "saddle"}, "山・峠", 60),
    ("mountain_pass", None, "峠", 60),
    ("leisure", {"park", "garden", "nature_reserve"}, "公園", 55),
    ("amenity", {"restaurant", "cafe", "fast_food", "food_court", "bar", "pub"}, "飲食店", 50),
    ("shop", None, "お店", 45),
    ("amenity", {"hospital", "clinic"}, "病院", 50),
    ("amenity", {"school", "university", "college", "kindergarten"}, "学校", 40),
    ("amenity", {"townhall", "police", "post_office", "fire_station", "library", "community_centre"}, "公共施設", 45),
    ("amenity", {"parking"}, "駐車場", 40),
    ("amenity", None, "施設", 35),
    ("tourism", None, "観光", 50),
    ("leisure", None, "施設", 35),
    ("office", None, "会社・事務所", 30),
    ("highway", {"bus_stop"}, "バス停", 35),
    ("public_transport", None, "乗り場", 30),
    ("railway", None, "鉄道", 25),
    ("highway", None, "道路", 30),
    ("waterway", None, "川", 25),
    ("natural", None, "自然", 30),
    ("building", None, "建物", 20),
    ("landuse", None, "土地", 15),
]

# 同じ名前の線が細切れになっているもの（道・川・鉄道）は、同じ市区町村の近くのものを1件にまとめる
MERGE_CATEGORIES = {"道路", "川", "鉄道"}
MERGE_GRID_DEGREES = 0.02  # 約 2km
# 同じものが「点」と「建物の形」の両方で登録されていることが多いので、同じ名前・種類・市区町村で近い（約 500m）ものは1件にする
DUPLICATE_GRID_DEGREES = 0.005

READING_KEYS = ("name:ja-Hira", "name:ja-Kana", "name:ja_kana", "name:ja_rm", "name:ja-Latn", "name:en", "alt_name", "official_name", "old_name", "short_name", "brand", "operator")
EXTRA_KEYS = ("opening_hours", "phone", "contact:phone", "website", "contact:website")


def categorize(tags: dict):
    for key, values, label, priority in CATEGORIES:
        value = tags.get(key)
        if value is None:
            continue
        if values is None or value in values:
            return label, priority
    if "道の駅" in tags.get("name", ""):
        return "休憩所", 80
    return "その他", 10


def address(tags: dict) -> str:
    parts = [tags.get(key, "") for key in ("addr:province", "addr:city", "addr:quarter", "addr:neighbourhood", "addr:block_number", "addr:housenumber")]
    text = "".join(part for part in parts if part)
    if not text:
        text = tags.get("addr:full", "")
    return text


def export(pbf: str, out: str, extra_arguments=()) -> None:
    subprocess.run(["osmium", "export", pbf, "-f", "geojsonseq", "-a", "type,id", "-o", out, "--overwrite", *extra_arguments], check=True)


def municipalities(boundaries_pbf: str, workdir: str):
    """市区町村（admin_level 7）と政令市の区（8）の形。場所の市区町村名を出すため"""
    filtered = os.path.join(workdir, "municipalities.osm.pbf")
    subprocess.run(["osmium", "tags-filter", boundaries_pbf, "r/admin_level=7,8", "-o", filtered, "--overwrite"], check=True)
    geojson = os.path.join(workdir, "municipalities.geojsonseq")
    export(filtered, geojson, ["--geometry-types=polygon"])
    shapes, names = [], []
    with open(geojson, encoding="utf-8") as f:
        for line in f:
            feature = json.loads(line.lstrip("\x1e"))
            properties = feature["properties"]
            if not properties.get("name"):
                continue
            shapes.append(shape(feature["geometry"]))
            names.append((properties.get("admin_level"), properties["name"]))
    return STRtree(shapes), shapes, names


def city_of(point, tree, shapes, names) -> str:
    city, ward = "", ""
    for index in tree.query(point):
        if shapes[index].contains(point):
            level, name = names[index]
            if level == "7":
                city = name
            elif level == "8":
                ward = name
    return city + ward if ward and not ward.startswith(city) else (ward or city)


def main() -> None:
    area_pbf, boundaries_pbf, out_path = sys.argv[1:4]
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with tempfile.TemporaryDirectory() as workdir:
        named = os.path.join(workdir, "named.osm.pbf")
        subprocess.run(["osmium", "tags-filter", area_pbf, "nwr/name", "-o", named, "--overwrite"], check=True)
        features_path = os.path.join(workdir, "named.geojsonseq")
        export(named, features_path)
        tree, shapes, names = municipalities(boundaries_pbf, workdir)

        rows, merged = [], {}
        counts = Counter()
        with open(features_path, encoding="utf-8") as f:
            for line in f:
                feature = json.loads(line.lstrip("\x1e"))
                tags = feature["properties"]
                name = tags.get("name")
                if not name:
                    continue
                geometry = shape(feature["geometry"])
                if geometry.is_empty:
                    continue
                if geometry.geom_type in ("LineString", "MultiLineString"):
                    point = geometry.interpolate(0.5, normalized=True)
                else:
                    point = geometry.representative_point()
                label, priority = categorize(tags)
                city = city_of(point, tree, shapes, names)
                grid = MERGE_GRID_DEGREES if label in MERGE_CATEGORIES else DUPLICATE_GRID_DEGREES
                key = (name, label, city, round(point.x / grid), round(point.y / grid))
                if key in merged:
                    counts["まとめた"] += 1
                    continue
                merged[key] = True
                readings = [tags[key] for key in READING_KEYS if tags.get(key)]
                if label == "駅" and not name.endswith("駅"):
                    readings.append(name + "駅")  # OSM の駅の名前には「駅」が付いていない（「京都駅」で京都を見つけるため）
                extra = {key.replace("contact:", ""): tags[key] for key in EXTRA_KEYS if tags.get(key)}
                rows.append(
                    (
                        f"{tags.get('@type', 'x')[0]}{tags.get('@id')}",
                        name,
                        " ".join(readings),
                        label,
                        priority,
                        city,
                        address(tags),
                        round(point.x, 6),
                        round(point.y, 6),
                        json.dumps(extra, ensure_ascii=False) if extra else None,
                        normalize(" ".join([name, *readings])),
                    )
                )
                counts[label] += 1

    if os.path.exists(out_path):
        os.remove(out_path)
    connection = sqlite3.connect(out_path)
    connection.executescript(
        """
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE places (
          id INTEGER PRIMARY KEY,
          osm TEXT NOT NULL,
          name TEXT NOT NULL,
          readings TEXT,
          category TEXT NOT NULL,
          priority INTEGER NOT NULL,
          city TEXT,
          address TEXT,
          longitude REAL NOT NULL,
          latitude REAL NOT NULL,
          extra TEXT
        );
        CREATE VIRTUAL TABLE places_search USING fts5(text, content='', contentless_delete=1, tokenize='trigram');
        """
    )
    for index, row in enumerate(rows, start=1):
        connection.execute("INSERT INTO places VALUES (?,?,?,?,?,?,?,?,?,?,?)", (index, *row[:-1]))
        connection.execute("INSERT INTO places_search (rowid, text) VALUES (?, ?)", (index, row[-1]))
    # 2文字以下の言葉は trigram で探せないので、そろえた文字の列も持たせて LIKE で探す
    connection.execute("ALTER TABLE places ADD COLUMN search_text TEXT")
    connection.executemany("UPDATE places SET search_text = ? WHERE id = ?", [(row[-1], index) for index, row in enumerate(rows, start=1)])
    connection.execute("CREATE INDEX places_priority ON places (priority DESC)")
    connection.executemany(
        "INSERT INTO meta VALUES (?, ?)",
        [("schemaVersion", str(SCHEMA_VERSION)), ("source", "© OpenStreetMap contributors (ODbL)"), ("count", str(len(rows)))],
    )
    connection.commit()
    connection.execute("INSERT INTO places_search(places_search) VALUES('optimize')")
    connection.commit()
    connection.execute("VACUUM")
    connection.close()
    print(f"検索のデータ: {len(rows)} 件、{os.path.getsize(out_path) / 1_048_576:.0f}MB")
    print(dict(counts.most_common()))


if __name__ == "__main__":
    main()
