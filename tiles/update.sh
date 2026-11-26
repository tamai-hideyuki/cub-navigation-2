#!/bin/bash
# 地図の更新（設計書 9 章）。最新の OSM から、ルート用・地図用のタイルと検索のデータを作り直し、
# 確かめが通ったものだけを data/release/ に置く（iPhone へは tools/install-data.sh が写す）
#
# 使い方: tiles/update.sh
#   FORCE=1            変わっていなくても作り直す
#   SKIP_MAP_UPDATE=1  何もしない（急いでいるとき。data/update.log に残す）
#
# 1. 祝日の一覧を取り直す（取れなければ今のまま）
# 2. Geofabrik の .md5 を前回と比べ、変わっていれば pbf を取る（取れなければ前回のデータのまま終わる）
# 3. 材料（pbf・blocklist・allowlist・祝日・スクリプト）が前回の release と同じなら、作り直さない
# 4. 切って消す（prepare.sh）。怪しい道が前回より増えたら止める
# 5. Valhalla のタイルを作り、ルートを確かめる（verify_routes.py）。落ちたら止める
# 6. 地図用のタイル（build_map.sh）と検索のデータ（build_search.py）を作る
# 7. data/release/ を入れ替え、manifest.json を書く。前の版は data/release.prev/ に残す
#
# 止まったときは、data/release/ は前のまま（iPhone に古いデータが入ったままになるだけ）
set -euo pipefail
cd "$(dirname "$0")"
TILES="$(pwd)"
DATA="$TILES/data"
PY="$TILES/.venv/bin/python"
RELEASE="$DATA/release"
LOG="$DATA/update.log"

PBF_URL="https://download.geofabrik.de/asia/japan/kansai/kansai-latest.osm.pbf"
HOLIDAYS_URL="https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv"
VALHALLA_IMAGE="ghcr.io/valhalla/valhalla-scripted@sha256:89f33b5fb6304cdf9d919c21ee9164e5be16e46e5c4522cc2552e4ede7f9e311"
VALHALLA_CONTAINER="valhalla"
VALHALLA_URL="http://localhost:8002"

say() { echo "[update] $*"; }
record() { echo "$(date '+%Y-%m-%dT%H:%M:%S%z') $*" >> "$LOG"; }
fail() {
  say "止めた: $*" >&2
  record "止めた: $*"
  exit 1
}
mkdir -p "$DATA"
trap 'record "止めた: $(basename "$0") の ${LINENO} 行目で失敗"' ERR

manifest_value() { # manifest_value <キー>（前回の release の manifest.json から読む。無ければ空）
  [ -f "$RELEASE/manifest.json" ] || return 0
  "$PY" -c "import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], ''))" "$RELEASE/manifest.json" "$1"
}

days_old() { # days_old <OSM の日付>
  "$PY" -c "import sys; from datetime import datetime, timezone; d = datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00')); print((datetime.now(timezone.utc) - d).days)" "$1"
}

if [ "${SKIP_MAP_UPDATE:-0}" = "1" ]; then
  say "地図の更新を飛ばした（SKIP_MAP_UPDATE=1）"
  record "飛ばした（SKIP_MAP_UPDATE=1）"
  exit 0
fi

# 1. 祝日の一覧
if curl -sSfL --max-time 30 -o "$DATA/syukujitsu.csv" "$HOLIDAYS_URL"; then
  "$PY" update_holidays.py "$DATA/syukujitsu.csv" holidays-jp.csv
else
  say "祝日の一覧を取れなかった。今の holidays-jp.csv（$(tail -1 holidays-jp.csv | cut -d, -f1) まで）を使う"
fi

# 2. pbf
remote_md5="$(curl -sSfL --max-time 30 "$PBF_URL.md5" | cut -d' ' -f1 || true)"
local_md5="$(cut -d' ' -f1 "$DATA/kansai-latest.osm.pbf.md5" 2>/dev/null || true)"
if [ -z "$remote_md5" ]; then
  previous="$(manifest_value osmDate)"
  [ -n "$previous" ] || fail "Geofabrik に届かず、前回のデータも無い"
  say "Geofabrik に届かない。前回のデータ（OSM ${previous}、$(days_old "$previous") 日前）のまま"
  record "通信できず、前回のデータのまま（OSM ${previous}）"
  exit 0
fi
if [ "$remote_md5" != "$local_md5" ] || [ ! -f "$DATA/kansai-latest.osm.pbf" ]; then
  say "新しい pbf を取る（${remote_md5}）"
  curl -sSfL --max-time 1800 -o "$DATA/kansai-latest.osm.pbf.part" "$PBF_URL"
  got_md5="$(md5 -q "$DATA/kansai-latest.osm.pbf.part")"
  [ "$got_md5" = "$remote_md5" ] || fail "取った pbf の md5 が合わない（${got_md5}）"
  mv "$DATA/kansai-latest.osm.pbf.part" "$DATA/kansai-latest.osm.pbf"
  echo "$remote_md5  kansai-latest.osm.pbf" > "$DATA/kansai-latest.osm.pbf.md5"
fi
osm_date="$(osmium fileinfo -g header.option.osmosis_replication_timestamp "$DATA/kansai-latest.osm.pbf")"
say "OSM のデータ: ${osm_date}（$(days_old "$osm_date") 日前）"

# 3. 材料が前回と同じなら作り直さない
inputs_hash="$(
  {
    cat "$DATA/kansai-latest.osm.pbf.md5" blocklist.json allowlist.json holidays-jp.csv ./*.py ./*.sh
    find map/fonts -type f | sort | xargs cat
  } | shasum -a 256 | cut -d' ' -f1
)"
if [ "${FORCE:-0}" != "1" ] && [ "$inputs_hash" = "$(manifest_value inputsSha256)" ]; then
  say "前回から変わっていない。data/release/ のまま"
  record "変わっていない（OSM ${osm_date}）"
  exit 0
fi
started=$(date +%s)

# 4. 切って消す
./prepare.sh
previous_suspicious="$(manifest_value suspiciousWays)"
suspicious="$("$PY" -c "import json; print(len(json.load(open('data/out/removals.json'))['suspiciousWays']))")"
if [ "$suspicious" -gt "${previous_suspicious:-0}" ]; then
  fail "怪しい道が ${previous_suspicious:-0} 本から ${suspicious} 本に増えた。data/out/removals.json の suspiciousWays を見て、blocklist.json か allowlist.json に入れてから、もう一度動かす"
fi

# 5. Valhalla のタイル（Docker。コンテナを立ち上げ直すと、/custom_files の pbf から作り直す）
docker info > /dev/null 2>&1 || fail "Docker が動いていない。Docker Desktop を起動する"
mkdir -p "$DATA/valhalla"
cp -c "$DATA/route.osm.pbf" "$DATA/valhalla/route.osm.pbf"
marker="$DATA/valhalla/.build-started"
touch "$marker"
sleep 1
if docker inspect "$VALHALLA_CONTAINER" > /dev/null 2>&1; then
  docker restart "$VALHALLA_CONTAINER" > /dev/null
else
  docker run -d --name "$VALHALLA_CONTAINER" -p 8002:8002 -v "$DATA/valhalla:/custom_files" \
    -e serve_tiles=True -e build_admins=True -e build_time_zones=True -e build_elevation=False \
    -e build_tar=True -e force_rebuild=True -e use_tiles_ignore_pbf=True -e update_existing_config=True \
    "$VALHALLA_IMAGE" > /dev/null
fi
say "Valhalla のタイルを作っている"
for _ in $(seq 1 300); do
  [ "$(docker inspect -f '{{.State.Running}}' "$VALHALLA_CONTAINER")" = "true" ] || fail "Valhalla のコンテナが止まった（docker logs ${VALHALLA_CONTAINER}）"
  if [ "$DATA/valhalla/valhalla_tiles.tar" -nt "$marker" ] && curl -sf "$VALHALLA_URL/status" > /dev/null; then
    break
  fi
  sleep 3
done
[ "$DATA/valhalla/valhalla_tiles.tar" -nt "$marker" ] || fail "Valhalla のタイルが 15 分で作り終わらなかった"
"$PY" verify_routes.py data/out/removed-ids.txt data/out/removals.json "$VALHALLA_URL" || fail "ルートの確かめが通らなかった（data/out/routes.json）"

# 6. 地図用のタイルと検索のデータ
./build_map.sh > "$DATA/map/build.log" 2>&1 || fail "地図用のタイルを作れなかった（data/map/build.log）"
"$PY" build_search.py data/area.osm.pbf data/boundaries.osm.pbf data/search/search.sqlite

# 7. release を入れ替える（cp -c は APFS の複製なので、場所をほとんど取らない）
next="$DATA/release.next"
rm -rf "$next"
mkdir -p "$next/map" "$next/search"
cp -c "$DATA/valhalla/valhalla_tiles.tar" "$next/valhalla_tiles.tar"
cp -c "$DATA/map/kansai.pmtiles" "$next/map/kansai.pmtiles"
cp -R map/fonts "$next/map/fonts"
cp -c "$DATA/search/search.sqlite" "$next/search/search.sqlite"
"$PY" write_manifest.py "$next" "$inputs_hash"
rm -rf "$DATA/release.prev"
[ -d "$RELEASE" ] && mv "$RELEASE" "$DATA/release.prev"
mv "$next" "$RELEASE"

minutes=$(( ($(date +%s) - started + 59) / 60 ))
say "作り直した（OSM ${osm_date}、約 ${minutes} 分）。iPhone へは tools/install-data.sh で写す"
record "作り直した（OSM ${osm_date}、約 ${minutes} 分）"
