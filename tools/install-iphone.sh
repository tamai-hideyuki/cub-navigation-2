#!/bin/bash
# 地図を最新にしてから、アプリを Release でビルドし、ケーブルでつないだ iPhone に入れる（設計書 9 章）
#
# 使い方: tools/install-iphone.sh
#   IPHONE_UDID=<UDID>  iPhone を選ぶ（1台だけつないでいれば要らない）
#   SKIP_MAP_UPDATE=1   地図の更新を飛ばす（data/release/ にあるものを写す）
#   前提: app/ios がある（無ければ APPLE_TEAM_ID=<Team ID> npx expo prebuild -p ios を app/ で動かす）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

fail() { echo "[install-iphone] 止めた: $*" >&2; exit 1; }
[ -d "$ROOT/app/ios/CubNavigation2.xcworkspace" ] || fail "app/ios が無い。app/ で APPLE_TEAM_ID=<Team ID> npx expo prebuild -p ios を動かす"

# 1. 地図を最新にする（止まったら、アプリも入れない）
"$ROOT/tiles/update.sh"

# 2. iPhone を決める
if [ -z "${IPHONE_UDID:-}" ]; then
  devices="$(mktemp)"
  xcrun devicectl list devices --json-output "$devices" > /dev/null 2>&1 || fail "devicectl が使えない"
  IPHONE_UDID="$(/usr/bin/python3 -c "
import json, sys
devices = json.load(open(sys.argv[1]))['result']['devices']
real = [d['hardwareProperties']['udid'] for d in devices if d.get('hardwareProperties', {}).get('reality') == 'physical' and d.get('connectionProperties', {}).get('pairingState') == 'paired']
print(real[0] if len(real) == 1 else '')
" "$devices")"
  rm -f "$devices"
  [ -n "$IPHONE_UDID" ] || fail "iPhone を1台に決められない。IPHONE_UDID=<UDID> を付けて動かす"
fi
export IPHONE_UDID

# 3. アプリをビルドして入れる
cd "$ROOT/app/ios"
echo "[install-iphone] アプリをビルドしている（記録: app/ios/build-device.log）"
xcodebuild -workspace CubNavigation2.xcworkspace -scheme CubNavigation2 -configuration Release \
  -destination "id=$IPHONE_UDID" -derivedDataPath build/dd-device -allowProvisioningUpdates build > build-device.log 2>&1 \
  || { grep -E 'error:' build-device.log | sort -u | head >&2; fail "ビルドに失敗した"; }
xcrun devicectl device install app --device "$IPHONE_UDID" build/dd-device/Build/Products/Release-iphoneos/CubNavigation2.app > /dev/null \
  || fail "アプリを入れられなかった（iPhone のロックを外す）"
echo "[install-iphone] アプリを入れた"

# 4. データを写す（変わったファイルだけ）
"$ROOT/tools/install-data.sh"
