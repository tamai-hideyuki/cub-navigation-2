# カブナビ2（app）

cub-navigation-2 の iPhone アプリ。今は PoC 5（端末の中で Valhalla を動かす。設計書 8 章）の画面だけがある。

## 中身

| 場所 | 中身 |
|---|---|
| `modules/cub-routing/` | Valhalla（[valhalla-mobile](https://github.com/Rallista/valhalla-mobile) 0.6.6）を包む Expo のモジュール。Swift Package を React Native の `spm_dependency` で取り込む |
| `src/routing/` | Valhalla に渡すルートの要求を組み立てる（計算の条件は設計書 2.1） |
| `src/navigation/` | ナビの本体（前の版から引き継いだ。Node でテストできる） |
| `src/poc5/` | PoC 5 の地点の組と、画面ロック中に計算を試す位置のタスク |

## データを入れる（ふだんはこれだけ）

iPhone をケーブルでつなぎ、ここ（`app/`）で動かす。地図を最新にし（`tiles/update.sh`）、アプリを Release でビルドして入れ、変わったデータだけを写す（設計書 9 章）。

```bash
npm run iphone
```

- 地図の更新を飛ばすときは `SKIP_MAP_UPDATE=1 npm run iphone`、作り直しを強いるときは `FORCE=1 npm run iphone`
- データだけを写すときは、アプリを閉じてから `../tools/install-data.sh`（シミュレーターは `../tools/install-data.sh --simulator`）
- 初めて入れるときは、アプリを入れて一度開いてから、もう一度動かす（`Documents/` ができてから写す）
- Docker Desktop を起動しておく（Valhalla のタイルを作る）

下の「タイルを入れる」「地図を入れる」「検索のデータを入れる」は、手で1つずつ写すときの手順。

## タイルを入れる

ルート用のタイル（`tiles/data/valhalla/valhalla_tiles.tar`、`tiles/` で作る）を、アプリの `Documents/valhalla_tiles.tar` に写す。アプリには同梱しない。

シミュレーター:

```bash
cp ../tiles/data/valhalla/valhalla_tiles.tar "$(xcrun simctl get_app_container booted dev.testmap.cubnavigation2 data)/Documents/"
```

実機（iPhone をケーブルでつなぎ、アプリを一度開いてから）:

```bash
xcrun devicectl device copy to --device <iPhone の UDID> \
  --domain-type appDataContainer --domain-identifier dev.testmap.cubnavigation2 \
  --source ../tiles/data/valhalla/valhalla_tiles.tar --destination Documents/valhalla_tiles.tar
```

## 地図を入れる（PoC 7）

地図用のタイル（`tiles/data/map/kansai.pmtiles`、`tiles/build_map.sh` で作る）とフォント（`tiles/map/fonts/`）を、アプリの `Documents/map/` に写す。

シミュレーター:

```bash
C="$(xcrun simctl get_app_container booted dev.testmap.cubnavigation2 data)/Documents/map"
mkdir -p "$C" && cp ../tiles/data/map/kansai.pmtiles "$C/" && cp -R ../tiles/map/fonts "$C/"
```

実機は `devicectl device copy to` で、`kansai.pmtiles` を `Documents/map/kansai.pmtiles` に、フォントの `.pbf` を1つずつ `Documents/map/fonts/<フォント名>/<範囲>.pbf` に写す。

画面の上の「地図（PoC 7）」で地図が出る。「京都駅までのルートを引く」で、現在地（6府県の外なら大阪駅）から京都駅までのルートを地図に引く。

## 検索のデータを入れる

目的地を名前で探すための検索のデータ（`tiles/data/search/search.sqlite`、`tiles/build_search.py` で作る、約 100MB）を、アプリの `Documents/search/search.sqlite` に写す。

```bash
xcrun devicectl device copy to --device <UDID> --domain-type appDataContainer --domain-identifier dev.testmap.cubnavigation2 --source ../tiles/data/search/search.sqlite --destination Documents/search/search.sqlite
```

## 画面（PoC 5）

| ボタン | すること |
|---|---|
| 速さを測る | タイルを開き、PoC 4 と同じ 6 組のルートを2回ずつ計算する（平日 12:00 に出発）。距離をパソコンの結果と比べ、計算の時間とメモリを出す |
| 時間帯の規制を試す | 住道駅 → 生駒駅を、平日 12:00・日曜 3:00・祝日 3:00 に出発として計算する。平日は約 13.4km（阪奈道路を通る）、日曜・祝日は約 15.0km（避ける）なら正しい |
| ロック中のテストを始める | 位置の取得を始め、1分に1回ルートを計算して記録に残す。現在地が6府県の外なら、大阪駅 → 京都駅を計算する |
| 記録を更新 | 下の記録を新しくする |

## 記録

`Documents/navigation-log.txt` に1行1件の JSON で残る。`probe-route` の `appState` が `background` なら、画面ロック中に計算できている。

走行中は、走行ごとの記録 `Documents/logs/<出発の日時>.jsonl` にも、位置 1 件ごとの値やルートなど、取れるものをすべて残す（[設計書 3.1](../docs/design.md#31-走行の記録2026-11-27)）。どちらも次で `tiles/data/ride-logs/` に取り出せる（まだ取り出していない分だけ）。

```bash
npm run logs
```

シミュレーターからは `../tools/pull-logs.sh --simulator`（`tiles/data/ride-logs/simulator/` に写す）。

## ビルド

```bash
npm install
npx expo prebuild -p ios
```

実機に入れるときは、Apple の Team ID を環境変数で渡す（公開しない）。

```bash
APPLE_TEAM_ID=XXXXXXXXXX npx expo prebuild -p ios --clean
```

CocoaPods が `Unicode Normalization not appropriate for ASCII-8BIT` で落ちるときは、端末の文字コードを UTF-8 にする（`export LANG=en_US.UTF-8`）。

## 実機でロック中のテストをする（PoC 5）

Debug のアプリは JavaScript を Mac の Metro から読むので、Mac から離れて走ると動かない。実機のテストは Release で入れる（JavaScript がアプリに入る）。

1. iPhone をケーブルでつなぎ、Release で入れる

   ```bash
   APPLE_TEAM_ID=XXXXXXXXXX npx expo run:ios --device --configuration Release
   ```

2. アプリを一度開いてから、上の「タイルを入れる」の実機の手順でタイルを写す。画面に「タイル 417MB」と出ることを確かめる
3. 「速さを測る」を押し、計算の時間とメモリを見る（シミュレーターより遅いはず）
4. 「ロック中のテストを始める」を押し、位置の許可を「常に」にする
5. 画面をロックして、30 分ほど持ち歩くか走る
6. 「記録」の手順で `navigation-log.txt` を取り出し、`probe-route` の `appState` が `background` の行が1分ごとに続いているかを見る
