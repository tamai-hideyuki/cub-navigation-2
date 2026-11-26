#!/bin/bash
# 関西の pbf を対象の府県（make_area.py の PREFECTURES）で切り、通れない道を消した route.osm.pbf を作る（設計書 2.2・2.3）
# 前提: data/kansai-latest.osm.pbf がある。.venv に shapely が入っている
set -euo pipefail
cd "$(dirname "$0")"
PY=.venv/bin/python
cd data

# 1. 府県の境界をつなぎ、余白を付けて切る
osmium tags-filter kansai-latest.osm.pbf r/boundary=administrative -o boundaries.osm.pbf --overwrite
osmium tags-filter boundaries.osm.pbf "r/ISO3166-2=$(../$PY ../make_area.py --codes)" -o prefectures.osm.pbf --overwrite
osmium export prefectures.osm.pbf --geometry-types=polygon -a type,id -o prefectures.geojson --overwrite
../$PY ../make_area.py prefectures.geojson area.geojson
osmium extract -p area.geojson --strategy smart kansai-latest.osm.pbf -o area.osm.pbf --overwrite

# 2. 道を出し、消す道を決める（理由ごとの数・決まりに無い値・怪しい道は out/removals.json）
osmium tags-filter area.osm.pbf w/highway w/route=ferry -o ways.osm.pbf --overwrite
osmium cat ways.osm.pbf -t way -f opl -o ways.opl --overwrite
../$PY ../select_removals.py ways.opl ../blocklist.json ../allowlist.json out

# 3. 消す。時間帯で通れないだけの道は消さずに、規制を書き込む（out/time-rules.json）
osmium removeid -i out/removed-ids.txt area.osm.pbf -o kept.osm.pbf --overwrite
osmium getid kept.osm.pbf -i out/timed-ids.txt -o timed.osm.pbf --overwrite
../$PY ../apply_time_rules.py timed.osm.pbf out/time-rules.json timed-rewritten.osm.pbf
osmium removeid -i out/timed-ids.txt kept.osm.pbf -o kept-untimed.osm.pbf --overwrite
osmium merge kept-untimed.osm.pbf timed-rewritten.osm.pbf -o route.osm.pbf --overwrite

# 4. 確かめ: 1段目のタグを持つ道が残っていない
osmium tags-filter route.osm.pbf w/highway=motorway,motorway_link w/toll=yes w/motorroad=yes w/route=ferry -o left.osm.pbf --overwrite
left=$(osmium cat -t way -f opl left.osm.pbf | wc -l | tr -d ' ')
if [ "$left" != "0" ]; then
  echo "消すはずの道が ${left} 本残っている" >&2
  exit 1
fi
# 5. 確かめ: 規制を書き込んだ道が、全部残っている
timed=$(osmium tags-filter route.osm.pbf "w/motorcycle:conditional" -o - -f opl | grep -c '^w' || true)
if [ "$timed" -lt "$(wc -l < out/timed-ids.txt | tr -d ' ')" ]; then
  echo "時間帯の規制を書き込んだ道が足りない（${timed} 本）" >&2
  exit 1
fi
ls -lh route.osm.pbf
