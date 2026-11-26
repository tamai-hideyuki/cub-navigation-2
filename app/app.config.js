// Apple の Team ID は公開しないので、環境変数 APPLE_TEAM_ID から入れる（例: APPLE_TEAM_ID=XXXXXXXXXX npx expo prebuild）
module.exports = ({ config }) => ({
  ...config,
  ios: { ...config.ios, appleTeamId: process.env.APPLE_TEAM_ID },
});
