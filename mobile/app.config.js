// Config dynamique Expo : identique à app.json, mais permet de « baker » l'URL
// du serveur au moment d'un build/export via la variable d'environnement
// SERIETIME_SERVER_URL, sans toucher app.json (le dev local garde l'écran
// « URL du serveur » tant que la variable n'est pas définie).
//
//   SERIETIME_SERVER_URL=https://serietime.studio-vives.fr npx expo export -p web
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    serverUrl: process.env.SERIETIME_SERVER_URL ?? config.extra?.serverUrl ?? '',
  },
});
