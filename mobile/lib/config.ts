import Constants from 'expo-constants';

// URL du serveur « bakée » dans l'app via app.json → expo.extra.serverUrl.
// - Renseignée (production, après déploiement du VPS) : l'app s'y connecte
//   automatiquement et l'utilisateur ne voit jamais l'écran « URL du serveur ».
// - Vide (développement / preview Expo Go) : l'app demande l'URL une fois
//   (ex. http://192.168.1.42:4000) pour pointer vers ton serveur local.
const raw = (Constants.expoConfig?.extra as { serverUrl?: string } | undefined)?.serverUrl;

export const CONFIGURED_SERVER_URL: string | null =
  typeof raw === 'string' && raw.trim().length > 0 ? raw.trim().replace(/\/+$/, '') : null;
