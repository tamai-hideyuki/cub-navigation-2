#!/bin/bash
# 地図用のタイル（PMTiles、OpenMapTiles の形）を作る（設計書 5.4・8.3）
# 前提: prepare.sh で data/area.osm.pbf と data/area.bounds（対象の府県＋余白）ができている。Java 21
# 初回は Planetiler（約 93MB）と、海・湖・小縮尺の地図の材料（約 1.3GB）を data/map/ に取る
set -euo pipefail
cd "$(dirname "$0")/data"
mkdir -p map
cd map

PLANETILER_VERSION=0.10.2
if [ ! -f planetiler.jar ]; then
  curl -sSfL -o planetiler.jar "https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/planetiler.jar"
  curl -sSfL -o planetiler.jar.sha256 "https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/planetiler.jar.sha256"
  echo "$(cut -d' ' -f1 planetiler.jar.sha256)  planetiler.jar" | shasum -a 256 -c -
fi

# 範囲の箱は make_area.py の結果（対象の府県＋余白 2km）
java -Xmx6g -jar planetiler.jar \
  --osm_path=../area.osm.pbf \
  --download --download_dir=sources \
  --output=kansai.pmtiles \
  --bounds="$(cat ../area.bounds)" \
  --languages=ja,en \
  --force

ls -lh kansai.pmtiles
