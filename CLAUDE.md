# Notes pour Claude — SerieTime

> Nouveau sur le projet ? Suivre **`docs/ONBOARDING.md`** (installation complète).

## Environnements locaux (Windows / PowerShell)

- **Étienne : `C:\Users\etien\SerieTime`** — toujours préfixer les commandes
  PowerShell par `cd C:\Users\etien\SerieTime` (oubli fréquent → commandes
  lancées depuis `C:\WINDOWS\system32`).
- **<collègue : ajoute ici le chemin de ton clone>**
- Gestionnaires : **pnpm** pour le serveur/monorepo, **npm** pour `mobile/`.
- Node ≥ 20 requis. `corepack enable` une fois pour pnpm.

## Lancer le projet (deux fenêtres PowerShell)

Serveur :
```powershell
cd C:\Users\etien\SerieTime
pnpm install
pnpm --filter @serietime/server db:deploy   # applique les migrations
pnpm dev:server                              # http://0.0.0.0:4000
```

Mobile (QR code Expo Go) :
```powershell
cd C:\Users\etien\SerieTime\mobile
npm install
npx expo start -c
```
Dans l'app, URL serveur = `http://<IP-locale-du-PC>:4000` (jamais `localhost`).
IP : `ipconfig | Select-String "IPv4"`.

## Architecture (rappel)

- `mobile/` : app React Native + Expo (npm, autonome).
- `apps/server/` : Fastify + Prisma + SQLite (source de vérité).
- `packages/core` + `packages/types` : logique métier et types partagés.
- Auth multi-comptes e-mail/mot de passe ; SSO Google/Facebook prêt mais désactivé.
- Contenu via TheTVDB (clé dans `apps/server/.env`, `TVDB_ENABLED=true`) ; TMDb optionnel.
- Dimension sociale : abonnements, fil, commentaires/réponses, réactions, notifications.

## Branches (organisation d'équipe)

- **`main` est la branche de référence** : toujours à jour, c'est elle que le
  collègue clone et pull.
- Claude développe sur `claude/seriestime-repo-setup-3wyz3c` (repartie de
  `main` après chaque fusion) et fusionne via pull request.
- Le collègue travaille sur des branches courtes par fonctionnalité, fusionnées
  dans `main` via PR.

## Suivi d'avancement (règle d'équipe)

**Après chaque modification ou ajout de fonctionnalité, mettre à jour
`docs/AVANCEMENT.md`** : tableau « État par domaine » + nouvelle entrée datée
dans le « Journal des modifications » (inclure ce fichier dans le même commit
que la fonctionnalité). Un collègue travaille aussi sur le repo et s'appuie
sur ce fichier.
