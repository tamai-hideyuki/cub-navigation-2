#!/bin/bash
# 走行の記録を、アプリの Documents から Mac の tiles/data/ride-logs/ に写す（設計書 3.1）
# シミュレーターからは tiles/data/ride-logs/simulator/ に写す（iPhone の記録と混ぜない）
# - logs/<出発の日時>.jsonl（走行ごとの記録）は、まだ無いものと、大きさが変わったもの（走っている途中で写したもの）だけ写す
# - navigation-log.txt（出来事だけの記録）は毎回写し直す
# tiles/data/ は git に入らない（記録には家の場所なども入るので、公開しない）
#
# 使い方: tools/pull-logs.sh             ケーブルでつないだ iPhone（IPHONE_UDID で選べる）
#         tools/pull-logs.sh --simulator 起動しているシミュレーター
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/tiles/data/ride-logs"
BUNDLE_ID="dev.testmap.cubnavigation2"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "[pull-logs] 止めた: $*" >&2; exit 1; }
if [ "${1:-}" = "--simulator" ]; then
  OUT="$OUT/simulator"
  container="$(xcrun simctl get_app_container booted "$BUNDLE_ID" data 2> /dev/null)" || fail "起動しているシミュレーターにアプリが入っていない"
  # 名前と大きさを1行に1つ
  list_logs() { [ -d "$container/Documents/logs" ] && (cd "$container/Documents/logs" && stat -f '%N %z' -- *.jsonl 2> /dev/null) || true; }
  get() { cp "$container/Documents/$1" "$2"; }
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
  list_logs() {
    # logs/ がまだ無い（一度も走っていない）ときは何も出さない
    xcrun devicectl device info files --device "$udid" --domain-type appDataContainer --domain-identifier "$BUNDLE_ID" \
      --subdirectory Documents/logs --no-recurse --json-output "$WORK/files.json" > /dev/null 2>&1 || return 0
    /usr/bin/python3 -c "
import json, sys
for f in json.load(open(sys.argv[1]))['result']['files']:
    if f['name'].endswith('.jsonl') and not f['resources']['isDirectory']:
        print(f['name'], f['metadata']['size'])
" "$WORK/files.json"
  }
  get() { xcrun devicectl device copy from --device "$udid" --domain-type appDataContainer --domain-identifier "$BUNDLE_ID" --source "Documents/$1" --destination "$2" > /dev/null 2>&1; }
  where="iPhone"
fi

mkdir -p "$OUT"
copied=0
while read -r name size; do
  [ -n "$name" ] || continue
  if [ -f "$OUT/$name" ] && [ "$(stat -f '%z' "$OUT/$name")" = "$size" ]; then continue; fi
  get "logs/$name" "$WORK/$name" || fail "logs/$name を写せなかった（ケーブルを確かめる）"
  mv "$WORK/$name" "$OUT/$name"
  echo "[pull-logs] 写した: $name（$(du -h "$OUT/$name" | cut -f1)）"
  copied=$((copied + 1))
done < <(list_logs)

if get navigation-log.txt "$WORK/navigation-log.txt"; then
  mv "$WORK/navigation-log.txt" "$OUT/navigation-log.txt"
fi
echo "[pull-logs] ${where}から ${copied} 件の走行の記録を写した → ${OUT#"$ROOT/"}/"
