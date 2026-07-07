# État d'avancement — SerieTime

> **Ce fichier est la source de vérité de l'avancement du projet.**
> Merci de le mettre à jour **après chaque modification ou ajout de fonctionnalité** :
> 1. actualiser le tableau « État par domaine » si un statut change ;
> 2. ajouter une entrée datée en tête du « Journal des modifications » (date, auteur, résumé) ;
> 3. déplacer les éléments terminés de « Prochaines étapes » vers le journal.

Dernière mise à jour : **2026-07-07** (Claude)

---

## Vue d'ensemble

Application de suivi de séries / animés / films destinée à remplacer TV Time :
app mobile **React Native + Expo** (`mobile/`, npm) + serveur **Fastify + Prisma + SQLite**
(`apps/server/`, workspace pnpm). Design et parcours calqués sur TV Time
(références visuelles : `docs/screenshots/reference/`).

- **Branche de référence : `main`** (à cloner / puller). Le développement passe
  par des branches courtes fusionnées via pull request.
- Tests : `pnpm test` (73 tests au 2026-07-07 : 25 core + 48 serveur).
- Lancement local : voir `README.md` (serveur `pnpm dev:server`, mobile `npx expo start -c`).

## État par domaine

| Domaine | État | Notes |
|---|---|---|
| Authentification multi-comptes (e-mail + mot de passe) | ✅ Fait | Inscription/connexion, sessions 30 j, données isolées par compte (testé) |
| SSO Google / Facebook | ⏸ Préparé, désactivé | Prêt côté serveur (`/api/auth/oauth`) ; nécessite ids OAuth + dev build Expo |
| Contenu séries via TheTVDB | ✅ Fait | Recherche, fiche, saisons/épisodes, titres/synopsis FR, artworks ; clé dans `apps/server/.env` |
| Contenu films / tendances via TMDb | ⏳ En attente de clé | Code prêt et branché ; sans clé : pas de flux Explorer ni d'images films |
| File « À voir » / « À venir » | ✅ Fait | Groupes TV Time (pas commencé, à voir, etc.) ; « Regarder plus tard » exclu des deux |
| Fiche série/film façon TV Time | ✅ Fait | Barre « + AJOUTER » → « ✓ AJOUTÉE ! », bannière/affiche, onglets À propos / Épisodes / Discussion |
| Menu « … » de la fiche | ✅ Fait | Personnaliser (affiche + bannière, séries **et** films), Favoris, Ajouter à une liste, Regarder plus tard, Supprimer, Partager |
| Consultation ≠ suivi | ✅ Fait | Taper un résultat ouvre la fiche sans l'ajouter ; seul le `+` suit (statut « Pas commencée » ; « En cours » au 1er épisode vu) |
| Recherche (design TV Time) | ✅ Fait | Onglets SÉRIES ET FILMS / UTILISATEURS, « Annuler », `+` jaunes, debounce |
| Social : abonnements, fil d'activité | ✅ Fait | Follow/unfollow, fil des visionnages/commentaires des personnes suivies |
| Social : commentaires, réponses, réactions | ✅ Fait | Fils de discussion, réactions multi-emoji (❤️👍😂😮😢) |
| Profil public + confidentialité | ✅ Fait | Écran `/user/[id]`, profils privés masqués aux non-abonnés |
| Notifications in-app | ✅ Fait | Cloche + badge ; ami qui commente/favorise, réponse ou réaction à un commentaire |
| Notifications push (OS) | ⏸ Non commencé | Nécessite dev build Expo + tokens Expo Push (la génération d'événements existe déjà) |
| Import ZIP TV Time | ✅ Fait (v. initiale) | Analyse, matching, résolution manuelle, application |
| Sauvegarde / restauration JSON | ✅ Fait (v. initiale) | Par compte |
| Hébergement VPS | ⏳ À faire | Choix du fournisseur à trancher ; `Dockerfile.server` + `docker-compose.yml` prêts ; URL à baker dans `mobile/app.json` (`expo.extra.serverUrl`) |
| Distribution (APK / stores) | ⏳ À faire | EAS Build documenté dans le README ; comptes développeur à créer |

## Prochaines étapes (par priorité)

1. **Clé TMDb** (gratuite) → active le flux Explorer (tendances/recommandations) et les images films.
2. **VPS** : choisir le fournisseur, déployer via Docker, configurer HTTPS + `.env`, baker l'URL dans l'app.
3. Option « Ne plus suivre » / gestion fine depuis les listes du profil (l'API existe : `DELETE /api/shows/:id/tracking`).
4. Notifications push (quand on passera au dev build Expo).
5. SSO Google/Facebook (ids OAuth à créer, dev build requis).
6. Publication (EAS Build APK, puis stores).

## Journal des modifications

> Entrée type : `### AAAA-MM-JJ — Auteur` puis une liste courte de ce qui a changé.

### 2026-07-07 — Claude
- **Guide d'onboarding** `docs/ONBOARDING.md` (installation, .env/clé TheTVDB,
  Expo Go, conventions d'équipe) ; `CLAUDE.md` adapté au travail à plusieurs.
- **Fusion de la PR #1 dans `main`** : `main` devient la branche de référence
  pour la collaboration (clone / pull / PR courtes).
- Personnalisation **affiche + bannière étendue aux films** (routes `/api/movies/:id/poster|banner|images`, menu Personnaliser sur les fiches film). Testé série (24 affiches / 29 bannières TheTVDB) et film.
- Fiche façon TV Time : barre **« + AJOUTER LA SÉRIE » → « ✓ AJOUTÉE ! »** (2 s), menu `…` complet et fonctionnel (Personnaliser, Favoris, Ajouter à une liste avec création rapide, Regarder plus tard, Supprimer, Partager) avec toasts jaunes.
- « Regarder plus tard » désormais **exclu** des files « À voir » et « À venir ».
- Création de `docs/AVANCEMENT.md` (ce fichier).

### 2026-07-06 — Claude
- **Consultation ≠ suivi** : taper un résultat ouvre la fiche sans ajout (`follow:false`), le `+` suit la série (« Pas commencée » ; « En cours » au 1er épisode coché). Tests de régression `follow.test.ts`.
- **Recherche redessinée façon TV Time** : onglets SÉRIES ET FILMS / UTILISATEURS, « Annuler », `+` carrés jaunes, coche si déjà suivi.
- Passe d'optimisation UX après test complet (API chronométrée + app pilotée au navigateur) : import épisodes TheTVDB **9,9 s → ~0,5 s** (One Piece, 1231 ép.), titres/synopsis d'épisodes **localisés FR**, images affichées partout (file, vignettes, bannières, Explorer), debounce recherche, resynchronisation auto des séries existantes.
- Diagnostic : `/health` expose les sources actives (`tvdb`/`tmdb`), logs `[tvdb]` en cas d'échec, message explicite dans l'app si aucune source configurée.

### 2026-07-04 — Claude
- **Partie sociale** (façon TV Time) : abonnements, fil d'activité, commentaires + fils de réponses, réactions multi-emoji, profil public (+ profils privés), notifications in-app avec badge.
- **Connexion TheTVDB** (clé v4 côté serveur) : recherche avec affiches, ajout de séries avec saisons/épisodes ; correction du chargement du `.env` (dotenv) et du parsing des booléens.
- Client TheTVDB à l'état de l'art (pagination `links.next`, refresh du jeton sur 401).

### 2026-07-03 — Claude
- **Authentification multi-comptes e-mail/mot de passe** (remplace le compte local unique) ; SSO Google/Facebook préparé côté serveur mais désactivé ; onboarding mobile (URL serveur intégrable via `expo.extra.serverUrl`).
- Tests d'**isolation des données par compte** (watchlist, favoris, listes, sauvegarde propres à chaque compte).
- Correctif Expo : dépendance `expo-font` manquante (expo-doctor 18/18).

### 2026-07-02 — Étienne
- Version initiale : monorepo (serveur Fastify/Prisma/SQLite, packages core/types, app Expo), import ZIP TV Time, sauvegarde/restauration, écrans principaux.
