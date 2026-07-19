# Notes pour Claude — SerieTime

> Nouveau sur le projet ? Suivre **`docs/ONBOARDING.md`** (installation complète).

## Méthode de travail (garde-fous)

> Garde-fous de comportement pour réduire les erreurs classiques des LLM
> (d'après Andrej Karpathy — https://github.com/multica-ai/andrej-karpathy-skills).
> Ils biaisent vers la prudence plutôt que la vitesse ; pour une tâche triviale,
> juge au cas par cas. À combiner avec les instructions projet ci-dessous.

**1. Réfléchir avant de coder.** Ne pas supposer, ne pas masquer une confusion,
exposer les compromis. Énoncer explicitement ses hypothèses ; si plusieurs
interprétations existent, les présenter au lieu d'en choisir une en silence ;
si une approche plus simple existe, le dire ; si quelque chose n'est pas clair,
s'arrêter et demander.

**2. La simplicité d'abord.** Le minimum de code qui résout le problème, rien de
spéculatif : pas de fonctionnalité non demandée, pas d'abstraction pour du code
à usage unique, pas de « flexibilité » non requise, pas de gestion d'erreurs
pour des cas impossibles. Si 200 lignes pourraient en faire 50, réécrire.

**3. Des changements chirurgicaux.** Ne toucher que le nécessaire. Ne pas
« améliorer » le code, les commentaires ou le formatage alentour ; ne pas
refactorer ce qui n'est pas cassé ; respecter le style existant. Ne supprimer
que les imports/variables/fonctions rendus inutiles **par ses propres
changements** ; le code mort préexistant, on le signale, on ne le supprime pas.
Test : chaque ligne modifiée doit se rattacher directement à la demande.

**4. Exécution guidée par un objectif.** Transformer la tâche en critère de
succès **vérifiable** et boucler jusqu'à l'atteindre (« corriger le bug » →
« écrire un test qui le reproduit, puis le faire passer »). Pour une tâche en
plusieurs étapes, énoncer un plan bref avec, pour chaque étape, sa vérification.

## Environnements locaux

- **Étienne (Windows / PowerShell) : `C:\Users\etien\SerieTime`** — toujours
  préfixer les commandes PowerShell par `cd C:\Users\etien\SerieTime` (oubli
  fréquent → commandes lancées depuis `C:\WINDOWS\system32`).
- **Benjamin (macOS / zsh) : `/Users/ben/Desktop/TVDB`** — `corepack enable`
  échoue (droits sur `/usr/local/bin`) : utiliser `corepack pnpm <cmd>` au lieu de
  `pnpm <cmd>`, ou le shim `~/.local/bin/pnpm` (déjà créé). Chemins Unix (`/`).
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
- Jeux : `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` (IGDB via Twitch, `IGDB_ENABLED=true`) ; `STEAM_API_KEY` (import Steam). Voir `docs/superpowers/specs/2026-07-15-jeux-video-design.md`.
- Dimension sociale : abonnements, fil, commentaires/réponses, réactions, notifications.

## Branches (organisation d'équipe)

- **`main` est la branche de référence** : toujours à jour, c'est elle que le
  collègue clone et pull.
- Claude développe sur `claude/seriestime-repo-setup-3wyz3c` (repartie de
  `main` après chaque fusion) et fusionne via pull request.
- Le collègue travaille sur des branches courtes par fonctionnalité, fusionnées
  dans `main` via PR.

## App native et web app : un seul code

La web app (https://serietime.studio-vives.fr) est **l'export web du même
projet Expo** (`mobile/`) : toute modification de `mobile/` vaut pour les deux.
Il n'y a JAMAIS de changement « côté app » à reporter « côté web » — en
revanche, la prod web est un build statique : **après fusion dans `main`,
redéployer** (`npx expo export -p web` sur le VPS, géré par Benjamin).
Écrire le code compatible avec les deux plateformes (tester sur web via
`npx expo start --web` quand un module natif est utilisé — le charger
dynamiquement avec garde d'erreur, cf. expo-image-picker).

## Design : identité PlotTime (règle produit, révisée 2026-07-17)

L'app a sa **propre identité** (nom PlotTime, logo, thèmes dont « Nuit » aux
couleurs du logo). Le fonctionnement s'inspire des trackers du marché, mais
l'**expression visuelle doit être originale** — ne PAS répliquer les écrans
d'une app existante (risque juridique + rejet store « copycat », cf.
`docs/STORES.md`). Étienne pilote le design/UX ; suivre ses maquettes et les
patterns déjà en place dans l'app. Police : **Mulish** (voir `FONTS` dans
`mobile/lib/theme.ts`) ; toujours `fontFamily: FONTS.x`, jamais `fontWeight`
(Android ne synthétise pas les graisses embarquées).

## Suivi d'avancement (règle d'équipe)

**Après chaque modification ou ajout de fonctionnalité, mettre à jour
`docs/AVANCEMENT.md`** : tableau « État par domaine » + nouvelle entrée datée
dans le « Journal des modifications » (inclure ce fichier dans le même commit
que la fonctionnalité). Un collègue travaille aussi sur le repo et s'appuie
sur ce fichier.
