# app で作業するときの決まり

- Expo SDK 58 のアプリ。Expo の API は版によって変わるので、SDK 58 のドキュメント（https://docs.expo.dev/versions/v58.0.0/）で確かめてから書く。パッケージは `npx expo install` で足す
- 画面は `App.tsx` の1枚だけ。Expo Router は使っていない
- ナビの本体（`src/navigation/`）は画面・音声・位置の取得に依存させない。Node でそのままテストできるように、中の import は `.ts` まで書く
- コードの名前に略称を使わない（`distanceMeters`・`timestampMilliseconds` のように単位も書く）。コメントは日本語
- 変えたら `npm test`・`npx tsc --noEmit`・`npx eslint .` を通す。スナップショット（`*.snapshot`）が変わったときは、意図した変更かを確かめてから `npm run test:update-snapshots` で作り直す
- 設計と閾値の根拠は `../docs/design.md`
