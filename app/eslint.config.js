// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // ios/ は expo prebuild が作るもので、ios/build/ には Swift Package のソース（Valhalla）まで入る
    ignores: ['dist/*', 'ios/*'],
  },
]);
