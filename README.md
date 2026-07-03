# SerieTime

Application personnelle de suivi de séries, animés et films — pensée pour remplacer TV Time
après la fermeture du service. Une **app mobile cross-platform React Native + Expo** (Android & iOS,
visualisable avec Expo Go), adossée à un **serveur personnel Node/Fastify/Prisma/SQLite**.

> Usage strictement personnel. Aucune fonctionnalité sociale (pas d'amis, d'abonnés, de profils
> publics ni de commentaires publics). Aucun asset propriétaire TV Time n'est réutilisé.

## Architecture

```txt
serietime/
  mobile/      App React Native + Expo (expo-router) — front unique, autonome (npm)
  apps/
    server/    Node + Fastify + Prisma + SQLite, API REST /api
  packages/
    core/      logique métier pure (parsing import, matching, stats, dates) + tests
    types/     types TypeScript partagés
  docs/        SPEC, plan, guides Android / import / API, captures de référence
```

Le **serveur est la source de vérité** (base SQLite). L'app mobile appelle l'API et met en cache les
écrans consultés (TanStack Query). Le serveur et ses packages forment un workspace pnpm ; l'app
mobile est un projet Expo autonome (npm) qui communique uniquement via HTTP.

## Prérequis

- Node.js ≥ 20
- pnpm ≥ 10 (`corepack enable`) — pour le serveur
- L'app **Expo Go** sur ton téléphone — pour visualiser l'app mobile

## Installation serveur

```bash
pnpm install
cp .env.example .env            # renseigner TMDB_API_KEY pour les métadonnées
pnpm db:migrate                 # crée la base SQLite et applique les migrations
pnpm dev:server                 # démarre l'API sur http://localhost:4000
```

Vérifier : `curl http://localhost:4000/health` → `{"ok":true,"app":"SerieTime","version":"1.0.0"}`.

L'authentification est **multi-comptes par e-mail + mot de passe** : au premier lancement l'app
propose de **créer un compte** (nom d'affichage + e-mail + mot de passe) ou de **se connecter**.
Plusieurs personnes peuvent donc utiliser le même serveur, chacune avec sa propre bibliothèque.

> Le SSO Google / Facebook est **prêt côté serveur** mais désactivé par défaut (voir
> `GOOGLE_CLIENT_IDS` / `FACEBOOK_APP_ID` dans `.env`). Il nécessite un *development build* Expo
> et n'est pas requis pour la prévisualisation Expo Go.

### Configuration TMDb (recommandé)

Les titres, synopsis, affiches, castings et « où regarder » viennent de **TMDb**. Sans clé,
l'app fonctionne mais affiche des posters vides et ne peut pas enrichir la recherche externe.
Renseignez `TMDB_API_KEY` (ou `TMDB_READ_ACCESS_TOKEN`) dans `.env`. **TVmaze** sert de fallback
séries (épisodes, calendrier) et ne nécessite pas de clé.

### Configuration optionnelle TheTVDB

Désactivé par défaut. Activez-le (`TVDB_ENABLED=true`, `TVDB_API_KEY`, `TVDB_PIN`) uniquement si
vos exports TV Time contiennent des identifiants TheTVDB et que le matching TMDb échoue.

Les clés API restent **exclusivement côté serveur** — jamais exposées au mobile.

## Installation mobile (Expo Go)

```bash
cd mobile
npm install
npx expo start
```

Scanne le QR code avec Expo Go (Android) ou l'appareil photo (iOS). Le téléphone doit être sur le
**même Wi-Fi** que l'ordinateur, et le serveur joignable via l'**IP locale** (ex.
`http://192.168.1.42:4000`, pas `localhost`). En développement l'app demande l'**URL du serveur**,
teste `GET /health`, puis propose la connexion / création de compte.

Pour un déploiement public, renseigne l'URL du serveur dans `mobile/app.json`
(`expo.extra.serverUrl`) : l'app s'y connecte alors automatiquement et l'écran « URL du serveur »
disparaît — l'utilisateur n'a plus qu'à créer son compte.

Détails et build APK : [mobile/README.md](mobile/README.md) et
[docs/README_ANDROID.md](docs/README_ANDROID.md).

## Import ZIP TV Time

Depuis **Paramètres → Compte → Importer mes données TV Time**, sélectionnez votre archive `.zip`.
L'import est robuste, tolérant et vérifiable — voir [docs/IMPORT_TVTIME.md](docs/IMPORT_TVTIME.md).

## Build APK Android

Via **EAS Build** (cloud, sans Android Studio) :

```bash
cd mobile
npm install -g eas-cli && eas login
eas build --platform android --profile preview   # → APK téléchargeable
```

Ou en local : `npx expo run:android`. Package `com.serietime.app`.

## Docker (serveur)

```bash
cp .env.example .env
docker compose up -d            # API sur le port 4000, base persistée dans apps/server/data
```

## Sauvegarde et restauration

- **Paramètres → Sauvegarde locale → Exporter** : télécharge un JSON de toutes vos données
  (séries, épisodes vus, films, listes, favoris, historique).
- **Restaurer une sauvegarde** : réimporte ce JSON. La restauration est tolérante (les lignes
  corrompues sont ignorées sans interrompre le processus).

## Tests

```bash
pnpm test                       # unitaires (core) + intégration (API serveur)
```

- `packages/core` : normalisation titres, extraction d'IDs, parsers CSV/JSON, score de matching,
  épisode suivant, progression, stats de temps, groupes par date.
- `apps/server` : import ZIP de bout en bout, résolution de mapping, marquage vu/non-vu, favoris,
  listes, affiche/bannière, export de sauvegarde.

## Limitations

- L'enrichissement des métadonnées (posters, castings, providers) nécessite une clé TMDb.
- L'app mobile met en cache les écrans consultés (TanStack Query) ; la recherche externe et
  l'import ZIP exigent le réseau et un serveur joignable.
- Multi-comptes par serveur (e-mail + mot de passe). Le catalogue (métadonnées séries/films) est
  partagé, mais la bibliothèque, la progression, les favoris et les stats sont **propres à chaque
  compte**.

## Documentation

- [docs/SPEC_SERIETIME.md](docs/SPEC_SERIETIME.md) — cahier des charges complet
- [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) — arborescence, Prisma, routes, phases
- [mobile/README.md](mobile/README.md) — app mobile Expo (lancer avec Expo Go, build APK)
- [docs/README_ANDROID.md](docs/README_ANDROID.md) — Expo Go & APK Android
- [docs/IMPORT_TVTIME.md](docs/IMPORT_TVTIME.md) — pipeline d'import
- [docs/API.md](docs/API.md) — référence de l'API REST
