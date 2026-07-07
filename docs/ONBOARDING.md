# Bienvenue sur SerieTime — guide de démarrage

Guide pas à pas pour installer le projet et commencer à contribuer.
Temps estimé : ~15 minutes.

## 1. Prérequis

- **Node.js ≥ 20** — https://nodejs.org
- **Git**
- **pnpm** (gestionnaire du serveur/monorepo) : une seule commande après Node :
  ```powershell
  corepack enable
  ```
- L'app **Expo Go** sur ton téléphone (Play Store / App Store) — c'est elle qui
  affiche l'app mobile pendant le développement, sans rien installer d'autre.
- Téléphone et PC sur le **même réseau Wi-Fi**.

## 2. Cloner et installer

```powershell
git clone https://github.com/Yggdrazzil/SerieTime.git
cd SerieTime
pnpm install
```

## 3. Configurer le serveur (`.env`)

Deux fichiers d'environnement à créer depuis leurs modèles :

```powershell
Copy-Item .env.example .env
Copy-Item apps\server\.env.example apps\server\.env
```

Puis ouvre `apps\server\.env` (ex. `notepad apps\server\.env`) et renseigne
la source de contenu **TheTVDB** :

```
TVDB_ENABLED=true
TVDB_API_KEY="<clé transmise en privé par Étienne>"
```

> 🔑 La clé API n'est **jamais** commitée (les `.env` sont dans `.gitignore`).
> Demande-la à Étienne en privé. Optionnel : `TMDB_API_KEY` (clé TMDb gratuite)
> active en plus le flux « Explorer » (tendances) et les images de films.

## 4. Lancer le serveur

```powershell
pnpm --filter @serietime/server db:deploy   # crée la base SQLite (1re fois + après nouvelles migrations)
pnpm dev:server                              # API sur http://localhost:4000
```

Vérification : ouvre **http://localhost:4000/health** dans un navigateur →
tu dois voir `"ok":true` **et** `"sources":{"tvdb":true,...}`. Si `tvdb:false`,
relis l'étape 3 puis redémarre le serveur.

Chaque développeur fait tourner **son propre serveur local avec sa propre
base** (fichier `apps/server/data/serietime.sqlite`, non versionné).

## 5. Lancer l'app mobile (2e terminal)

```powershell
cd mobile
npm install          # oui, npm ici — l'app Expo est un projet autonome
npx expo start -c
```

Scanne le **QR code** avec Expo Go (Android) ou l'appareil photo (iPhone).

Au premier lancement, l'app demande l'**URL du serveur** : saisis
`http://<IP-locale-de-ton-PC>:4000` (jamais `localhost`, le téléphone ne le
résout pas). Pour trouver l'IP :

```powershell
ipconfig | Select-String "IPv4"
```

Si le téléphone ne joint pas le serveur : ouvre le port 4000 dans le pare-feu
(PowerShell **administrateur**, une fois) :

```powershell
New-NetFirewallRule -DisplayName "SerieTime 4000" -Direction Inbound -LocalPort 4000 -Protocol TCP -Action Allow
```

Crée ensuite ton compte dans l'app (e-mail + mot de passe) et ajoute une série
via l'onglet **Explorer** pour vérifier que tout marche.

## 6. Conventions de travail en équipe

- **`main` est la branche de référence** : toujours stable, c'est elle qu'on
  clone/pull. On ne pousse **jamais** directement dessus.
- Développement sur des **branches courtes par fonctionnalité**
  (`feat/nom-court`, `fix/nom-court`), fusionnées dans `main` via **pull
  request**.
- **`docs/AVANCEMENT.md` est le tableau de bord commun** : à mettre à jour
  dans le même commit que chaque fonctionnalité (tableau « État par domaine »
  + entrée datée dans le journal).
- Avant de pousser : `pnpm test` (tests core + serveur) et
  `pnpm -r typecheck` doivent être verts ; pour le mobile,
  `cd mobile && npm run typecheck`.

## 7. Tu utilises Claude Code ? (recommandé ici)

Le repo contient un **`CLAUDE.md`** à la racine : Claude Code le lit
automatiquement et y trouve l'architecture, les commandes et les règles
d'équipe (dont la mise à jour d'`AVANCEMENT.md`). Ajoute simplement le chemin
de **ton** clone local à la section « Environnements locaux » de `CLAUDE.md`
pour que Claude te donne toujours les bonnes commandes.

## 8. Pour aller plus loin

- `README.md` — vue d'ensemble, Docker, sauvegardes, EAS Build
- `docs/AVANCEMENT.md` — état du projet et prochaines étapes
- `docs/SPEC_SERIETIME.md` — cahier des charges complet
- `docs/API.md` — référence de l'API REST
- `docs/screenshots/reference/` — captures TV Time servant de référence design
