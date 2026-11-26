#!/bin/bash
# tiles/data/release/ のデータ（ルート用・地図用のタイル、フォント、検索のデータ）を、アプリの Documents に写す（設計書 9 章）
# 入っている manifest.json と比べ、sha256 が変わったファイルだけ写す。manifest.json は最後に写す
#
# 使い方: tools/install-data.sh             ケーブルでつないだ iPhone（IPHONE_UDID で選べる）
#         tools/install-data.sh --simulator 起動しているシミュレーター
#   アプリを一度入れて開いてから動かす（Documents ができている必要がある）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE="$ROOT/tiles/data/release"
BUNDLE_ID="dev.testmap.cubnavigation2"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "[install-data] 止めた: $*" >&2; exit 1; }
[ -f "$RELEASE/manifest.json" ] || fail "tiles/data/release/manifest.json が無い。先に tiles/update.sh を動かす"

if [ "${1:-}" = "--simulator" ]; then
  container="$(xcrun simctl get_app_container booted "$BUNDLE_ID" data 2> /dev/null)" || fail "起動しているシミュレーターにアプリが入っていない"
  get() { cp "$container/Documents/$1" "$2" 2> /dev/null; }
  put() { mkdir -p "$(dirname "$container/Documents/$2")" && cp "$1" "$container/Documents/$2"; }
  where="シミュレーター"
else
  udid="${IPHONE_UDID:-}"
  if [ -z "$udid" ]; then
    xcrun devicectl list devices --json-output "$WORK/devices.json" > /dev/null 2>&1 || fail "devicectl が使えない"
    udid="$(/usr/bin/python3 -c "
import json, sys
devices = json.load(open(sys.argv[1]))['result']['devices']
real = [d['hardwareProperties']['udid'] for d in devices if d.get('hardwareProperties', {}).get('reality') == 'physical' and d.get('connectionProperties', {}).get('pairingState') == 'paired']
print(real[0] if len(real) == 1 else '')
" "$WORK/devices.json")"
    [ -n "$udid" ] || fail "iPhone を1台に決められない。IPHONE_UDID=<UDID> を付けて動かす"
  fi
  device_copy() { xcrun devicectl device copy "$1" --device "$udid" --domain-type appDataContainer --domain-identifier "$BUNDLE_ID" --source "$2" --destination "$3" > /dev/null 2>&1; }
  get() { device_copy from "Documents/$1" "$2"; }
  put() { device_copy to "$1" "Documents/$2"; }
  where="iPhone"
fi

get manifest.json "$WORK/installed.json" || echo '{}' > "$WORK/installed.json"

# 写すものを決める（パスを1行に1つ）
/usr/bin/python3 - "$RELEASE" "$WORK/installed.json" > "$WORK/to-copy.txt" << 'EOF'
import json, os, sys
release, installed_path = sys.argv[1:3]
new = json.load(open(os.path.join(release, "manifest.json")))
try:
    old = json.load(open(installed_path))
except ValueError:
    old = {}
for key, entry in new["files"].items():
    if old.get("files", {}).get(key, {}).get("sha256") != entry["sha256"]:
        print(entry["path"])
if old.get("fonts", {}).get("sha256") != new["fonts"]["sha256"]:
    root = os.path.join(release, new["fonts"]["directory"])
    for directory, _, names in sorted(os.walk(root)):
        for name in sorted(names):
            if name.endswith(".pbf"):
                print(os.path.relpath(os.path.join(directory, name), release))
EOF

count="$(grep -c . "$WORK/to-copy.txt" || true)"
osm_date="$(/usr/bin/python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['osmDate'])" "$RELEASE/manifest.json")"
if [ "$count" = "0" ]; then
  echo "[install-data] ${where}のデータは最新（OSM ${osm_date}）"
  exit 0
fi
while read -r path; do
  size="$(du -h "$RELEASE/$path" | cut -f1)"
  echo "[install-data] ${where}へ写す: ${path}（${size}）"
  put "$RELEASE/$path" "$path" || fail "${path} を写せなかった（アプリを一度開いたか、ケーブルを確かめる）"
done < "$WORK/to-copy.txt"
put "$RELEASE/manifest.json" manifest.json || fail "manifest.json を写せなかった"
echo "[install-data] ${where}のデータを更新した（OSM ${osm_date}、${count} ファイル）"
