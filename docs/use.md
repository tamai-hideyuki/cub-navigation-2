# 最初の一回だけする準備

- Macに入れておくもの
    - Xcode、Node、Docker Desktop、Java 21
    - osmium（brew install osmium-tool）

- 地図を作るための Python（tiles/ で）
```
python3 -m venv .venv
```

```
.venv/bin/pip install shapely osmium
```

- アプリの準備（app/ で）
```
npm install
```

```
# XXXXXXXXXX には Apple の Team ID を入れます
APPLE_TEAM_ID=XXXXXXXXXX npx expo prebuild -p ios --clean
```

- iPhone の準備
    - 設定でデベロッパモードをオンにし、ケーブルでつないで「このコンピュータを信頼」を押します。

# 普段の準備
- iPhone をつないで、ロックを外し、app/ で動かします。
```
# 地図を最新にし、アプリをビルドして入れ、変わったデータだけを写す
npm run iphone
```

# アプリの使い方
- 上の「目的地を探す」に名前を入れます。ひらがな・カタカナ・ローマ字でも探せる
- その場でルートを計算し、地図に線を引く。下のカードに、時間・距離・到着の時刻が出る
- 「案内を始める」を押す。位置の許可は「常に」に（画面ロック中も案内するため）

### 画面の左下には「地図 2026/11/25（1日前）」のように地図の日付が出る。データが足りないときは、そこに赤で出る。

# 走行中
- 上の帯: 次に曲がる所の向きと距離が出る。色はふだん青、ルートを外れると黄、ルートが見つからないと赤。
- 下の帯: ルートの進み具合と、残りの距離・時間・到着の時刻が出る。
- 声: 曲がる所の 300m 手前と、まもなくの所で鳴る。インカムで聞ける。
- ルートを外れたとき: 自動で計算し直し、「ルートを計算し直しました」と鳴る。
- ボタン: 「ルートの全体」で全体の地図を見れる。「走行中の表示に戻る」で戻る。
- 画面をロックしても、案内とリルートは続く。
- 着いたら: 「目的地に着きました」と鳴り、2 分後に位置の取得が止まる。「停止」を押すと、目的地を決める画面に戻る。途中でアプリを閉じても、開き直せば続きから案内する。

# 走った記録も見れる
- 走った後に、iPhoneの記録をMacに取り出せる（app/ で）
```
xcrun devicectl device copy from --device <iPhone の UDID> --domain-type appDataContainer --domain-identifier dev.testmap.cubnavigation2 --source Documents/navigation-log.txt --destination navigation-log.txt
```
- iPhoneのUUIDの調べ方
```
xcrun devicectl list devices
```

