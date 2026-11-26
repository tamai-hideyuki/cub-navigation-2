"""時間帯で通れない道に、Valhalla が読める規制を書き込む（設計書 2.3）。

select_removals.py が書いた out/time-rules.json（way の ID → 「no @ (Su 00:00-06:00; Nov 23 00:00-06:00)」）を、
道の motorcycle:conditional に入れる。元の :conditional のタグ（motor_vehicle:conditional など）は消す
（読めた分は書き直した規制に入っているので、残すと Valhalla が別の読み方をすることがある）。
Valhalla は motorcycle の計算で、出発の時刻（date_time）を渡したときだけこの規制を見る。

使い方: python apply_time_rules.py timed.osm.pbf out/time-rules.json timed-rewritten.osm.pbf
  timed.osm.pbf: 書き込む道だけ（osmium getid で出す）
"""

import json
import sys

import osmium

from select_removals import CONDITIONAL_KEYS


def main() -> None:
    source, rules_path, destination = sys.argv[1:4]
    rules = {int(k): v for k, v in json.load(open(rules_path)).items()}
    writer = osmium.SimpleWriter(destination, overwrite=True)
    written = set()
    for way in osmium.FileProcessor(source, osmium.osm.WAY):
        tags = {tag.k: tag.v for tag in way.tags if tag.k not in CONDITIONAL_KEYS}
        tags["motorcycle:conditional"] = rules[way.id]
        writer.add_way(way.replace(tags=tags))
        written.add(way.id)
    writer.close()
    missing = sorted(set(rules) - written)
    if missing:
        sys.exit(f"規制を書き込む道が見つからない: {missing[:10]}")
    print(f"時間帯の規制を書き込んだ道: {len(written)}")


if __name__ == "__main__":
    main()
