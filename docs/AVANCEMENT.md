# État d'avancement — PlotTime (ex-SerieTime)

> **Ce fichier est la source de vérité de l'avancement du projet.**
> Merci de le mettre à jour **après chaque modification ou ajout de fonctionnalité** :
> 1. actualiser le tableau « État par domaine » si un statut change ;
> 2. ajouter une entrée datée en tête du « Journal des modifications » (date, auteur, résumé) ;
> 3. déplacer les éléments terminés de « Prochaines étapes » vers le journal.

Dernière mise à jour : **2026-07-21** (Claude/Étienne) — Explorer : cartes du feed peaufinées (libellé « Fiche », invite de dépliage cliquable, overlay détails opaque en Glass sans trait rose, bouton « Accéder à la fiche »)

---

## Vue d'ensemble

Application de suivi de séries / animés / films / jeux vidéo : app mobile
**React Native + Expo** (`mobile/`, npm) + serveur **Fastify + Prisma + SQLite**
(`apps/server/`, workspace pnpm). L'interface historique proche de TV Time est
désormais remplacée comme direction produit par l'identité originale **Prisme** ;
la migration visuelle doit encore être exécutée sans modifier la logique métier.

- **Branche de référence : `main`** (à cloner / puller). Pour le chantier Prisme,
  chaque lot vérifié est commité puis poussé directement sur `main`, conformément
  au cadre demandé.
- Tests : `pnpm test` (336 tests au 2026-07-17 : 158 core + 178 serveur).
- Lancement local : voir `README.md` (serveur `pnpm dev:server`, mobile `npx expo start -c`).

## État par domaine

| Domaine | État | Notes |
|---|---|---|
| Refonte front Prisme | ✅ Lots 1–14 implémentés | Socle accessible, navigation cible, cartes d’épisodes, Agenda, Films, onboarding, profils personnel/public, primitives de fiches, Explorer, bibliothèques, favoris, fiches détaillées, Communauté, relations, commentaires, notifications, **statistiques/badges/trophées/classements, réglages/compte/édition profil/couverture/comptes liés/imports, et convergence Jeux/Home** (tous les écrans migrés). Matrice : [parité fonctionnelle](feature-parity-matrix.md) |
| Authentification multi-comptes (e-mail + mot de passe) | ✅ Fait | Inscription/connexion, sessions 30 j, données isolées par compte (testé) ; mot de passe oublié → réinitialisation par ré-auth SSO Google/Discord (testé) |
| SSO Google / Facebook | ⏸ Préparé, désactivé | Prêt côté serveur (`/api/auth/oauth`) ; nécessite ids OAuth + dev build Expo |
| Auth native stores (Apple / Google / Discord) | ⏸ Codé, en attente credentials | Serveur : vérif Sign in with Apple (JWT RS256, testée) + `/providers` enrichi. Mobile : `NativeSsoButtons` (bouton Apple officiel, Google expo-auth-session, Discord PKCE), config-gated — s'active dès que les vars env seront posées (voir STORES.md « A1 — état d'avancement ») |
| Migration douce e-mail → SSO (popup) | ✅ Fait | `mobile/components/LinkAccountPrompt.tsx` : popup dismissible (web uniquement, SSO web-only) proposant de lier Google/Discord aux comptes connectés qui n'ont ni l'un ni l'autre ; montée dans `(tabs)/_layout.tsx` |
| Contenu séries via TheTVDB | ✅ Fait | Recherche, fiche, saisons/épisodes, titres/synopsis FR, artworks ; clé dans `apps/server/.env` |
| Contenu films / tendances via TMDb | ✅ Fait | Clé TMDb (compte Benjamin) configurée sur le serveur de prod ; flux Explorer et images films actifs |
| File « À voir » / « À venir » | ✅ Fait | Groupes TV Time (pas commencé, à voir, etc.) ; « Regarder plus tard » exclu des deux |
| Fiche série/film façon TV Time | ✅ Fait | Bannière repliable, onglets À PROPOS / ÉPISODES, distribution (fiches acteurs), « également regardé », similaire à, notes de la communauté, page Commentaires dédiée |
| Menu « … » de la fiche | ✅ Fait | Personnaliser (affiche + bannière, séries **et** films), Favoris, Ajouter à une liste, Regarder plus tard, Supprimer, Partager |
| Consultation ≠ suivi | ✅ Fait | Taper un résultat ouvre la fiche sans l'ajouter ; seul le `+` suit (statut « Pas commencée » ; « En cours » au 1er épisode vu) |
| Recherche (design TV Time) | ✅ Fait | Onglets SÉRIES ET FILMS / JEUX / UTILISATEURS, « Annuler », `+` jaunes, debounce |
| Social : abonnements, fil d'activité | ✅ Fait | Follow/unfollow, fil des visionnages/commentaires des personnes suivies ; QG agrégé anti-spam (`/api/social/overview` + `/api/social/discussions`, serveur prêt) |
| Social : commentaires, réponses, réactions | ✅ Fait | Fils de discussion, réactions multi-emoji (❤️👍😂😮😢) |
| Profil public + confidentialité | ✅ Fait | Écran `/user/[id]` : pastille niveau + titre + streak, section Trophées (badges débloqués), compteurs Séries/Films/Épisodes/Jeux, favoris séries/films/jeux, séries récentes. Gamification (réputation) visible même sur un profil privé ; stats/récents/favoris masqués aux non-abonnés. Bibliothèque intégrale d'un ami : `GET /api/users/:id/library` paginé + écran `/user-library` (Séries/Films/Jeux, grille infinie) |
| Notifications in-app | ✅ Fait | Cloche + badge ; ami qui commente/favorise, réponse ou réaction à un commentaire |
| Notifications push (OS) | ⏸ Non commencé | Nécessite dev build Expo + tokens Expo Push (la génération d'événements existe déjà) |
| Import ZIP TV Time | ✅ Fait (v. initiale) | Analyse, matching, résolution manuelle, application |
| Sauvegarde / restauration JSON | 🛠 Export réparé | Client aligné sur le `POST` serveur ; téléchargement JSON web, partage natif et erreur visible. L’interface de restauration reste à ajouter. |
| Hébergement VPS | ✅ Fait | Prod sur le VPS Hostinger de Benjamin : `https://serietime.studio-vives.fr` (Docker isolé, HTTPS Let's Encrypt, backup DB nocturne) |
| Web app (navigateur / écran d'accueil) | ✅ Fait | Export Expo web servi par Nginx à la racine du domaine (`/api` proxifié) ; utilisable iPhone + Android sans store |
| Distribution native (APK / stores) | ⏳ Optionnel | EAS Build documenté dans le README ; la web app couvre déjà l'usage quotidien |
| Jeux vidéo — modèle de données | ✅ Fait | Table `Game` (plateformes, développeur, éditeur, modes, Steam App ID, DLC) + `Media.igdbId` + `UserMediaStatus.playtimeMinutes` (migration `add_games`) |
| Jeux vidéo — provider IGDB | ✅ Fait | `apps/server/src/services/igdb/` : auth Twitch (client credentials, cache mémoire), requêtes Apicalypse avec cache `ApiCache`, mapper `igdbToMedia` |
| Jeux vidéo — module API | ✅ Fait | `apps/server/src/modules/games/routes.ts` : `GET /api/games/search`, `POST /api/games/add-from-igdb`, `GET /api/games` (groupes par statut wishlist/playing/completed/abandoned + groupe `owned` = vue collection `isOwned`, recoupement possible), `POST /api/games/:id/status`, `POST /api/games/:id/owned` (interrupteur « Je possède », booléen `isOwned` indépendant du statut, sans XP), `GET /api/games/:id` (enrichissement paresseux), `GET /api/games/discover`, `GET /api/games/upcoming`, `POST /api/games/steam/import`, `DELETE /api/games/:id/tracking` |
| Jeux vidéo — onglet Jeux (mobile) | ✅ Fait | `mobile/app/(tabs)/games.tsx` : bibliothèque par statut (VOULUS / EN COURS / TERMINÉS / ABANDONNÉS) + section POSSÉDÉS = vue collection `isOwned` (peut recouper les autres groupes), carrousels « Populaires »/« À venir » (découverte, tap = ajoute + ouvre la fiche), « Sorties à venir » (jeux suivis, groupés par mois) ; recherche déplacée dans l'onglet Explorer |
| Jeux vidéo — connexion Steam (mobile) | ✅ Fait | Bloc « Jeux — Steam » dans `mobile/app/settings.tsx` (onglet Compte) : SteamID/URL de profil → import bibliothèque possédée |
| Jeux vidéo — fiche jeu (mobile) | ✅ Fait | `mobile/app/game/[id].tsx` : parité avec la fiche série/film — personnalisation, favoris, listes, partage, retrait, statuts, possession, bande-annonce, fiche d’identité, résumé, éditions/extensions et commentaires ; suivi optimiste avec rollback et invalidation cohérente de la fiche, bibliothèque, recherche, gamification et du Profil. |
| Jeux vidéo — notifications de sortie | ✅ Fait | Passe du worker de fond (`apps/server/src/services/sync-worker.ts`) : `Notification` de type `game_release` quand `Media.releaseDate` d'un jeu suivi (non masqué) tombe aujourd'hui, dédupliquée par `(userId, mediaId, type)` |
| Gamification — serveur (XP, badges, streaks, défis, classement) | ✅ Fait | Modèles `UserProgress`/`UserBadge`/`UserChallenge`, `modules/gamification/` (recompute idempotent débouncé + backfill au boot), `GET /api/gamification/me` + `/leaderboard`, items `badge` dans le fil social, XP rétroactif à l'import |
| Gamification — mobile (page Trophées, toasts, pastille niveau) | ✅ Fait | Page `/trophies` (niveau + XP, streak, défis du mois, grille de badges à paliers, classement hebdo), pastille niveau + rangée Trophées sur le profil, items badge dans le fil, toasts de déblocage globaux (`GamificationToastHost`) |
| Flux Explorer — variété + personnalisation (serveur) | ✅ Fait | `GET /api/explore/feed` + `GET /api/explore/games` : mémoire des impressions (`ExploreImpression`, exclusion 3 j, garde anti-famine, purge 14 j), profil de goût par genres (favoris ×3, watchlist/en cours ×2, terminés ×1, dislikés ×−2) → viviers TMDb Discover/IGDB par genre, recs tirées parmi 30 graines, pages 1..8, 2 décennies, offsets IGDB aléatoires (`modules/explore/`, testé) |
| Modération — commentaires (haine/insultes graves) | ✅ Fait | Module pur `packages/core/src/moderation/` (blocklist curée multilingue fr/en/es/de/it/pt × racisme/antisémitisme/homophobie/sexisme/injures sexuelles/violence + filtre tolérant leetspeak/répétitions/séparateurs/accents, frontière de mot pour termes courts) ; `POST /api/media/:id/comments` rejette (400 `comment_blocked`) commentaires **et** réponses ; mobile affiche le message renvoyé (testé, 0 faux positif sur la batterie légitime) |
| Modération — suggestions (contenu adulte / porno) | ✅ Fait | Détection **porno ciblée** (sans bloquer la violence 18+) : module pur `packages/core/src/moderation/adultContent.ts` (`containsAdultContent` + `ADULT_MARKERS` multilingues fr/en/es/de/it/pt + japonais romanisé, tolérant leet/répétitions/séparateurs). TMDb : `include_adult=false` + `adult === true` + `containsAdultContent(titre/résumé)` sur flux/recherche/recos, **et** `without_keywords` (ids mots-clés porno via `/search/keyword`, désormais **nom exact** — plus de sur-blocage sentai/senpai/porco) sur `/discover`ᐧ **Hentai** détecté par item via `tmdbKeywordNames` (mot-clé `erotic`, animés uniquement) + mot-clé `erotic` ajouté au `without_keywords` des viviers animés. IGDB : thème « Erotic » (id 42) + `containsAdultContent(name, summary)` dans `isSafeGame` (testé) |
| Contenu 18+ — interrupteur par utilisateur | ✅ Fait | Paramètres > Suggestions > « Contenu 18+ » (défaut **désactivé**) : `allowAdultContent` (`UserSetting`, helper caché `modules/settings/adultContent.ts`). Activé = débraye tout le filtrage adulte pour ce compte (`include_adult=true`, pas de `without_keywords`, pas de `containsAdultContent`, pas de thème IGDB 42, pas de vérif mots-clés) sur `/api/explore/feed`, `/explore/discover`, `/api/search`, `/api/explore/games` ; `include_adult`/clause IGDB font partie de la **clé de cache** → aucune contamination entre comptes (testé). Bibliothèque jamais filtrée |
| Signalement d'œuvre inappropriée | ✅ Fait | Modèle `Report` (migration `reports`) + module `apps/server/src/modules/reports/routes.ts` (`POST /api/report`, anti-doublon par œuvre/statut pending). Action « Signaler » dans les fiches série/film/jeu via `ReportModal` ; succès affiché seulement après confirmation serveur, erreur visible et nouvelle tentative possible. Tri manuel ultérieur (pas d'écran admin) |
| Signalement de commentaires + blocage d'utilisateurs (stores A4, Apple 1.2) | ✅ Fait | Migration `report_comments_and_blocks` : `Report.commentId` (cascade) + modèle `Block`. `POST /api/report` étendu (`mediaType 'comment'`, anti-doublon, 404) ; blocage bilatéral et filtrage « mute » unidirectionnel. Mobile : drapeau « Signaler » sur les contenus d’autrui ; l’état « Signalé ✓ » n’apparaît qu’après succès serveur et une erreur reste retentable. Profil public : bloquer/débloquer avec confirmation (testé). |
| Pages légales + attributions (conformité stores) | ✅ Fait | Module public `apps/server/src/modules/legal/routes.ts` (sans `requireAuth`) : `GET /legal/privacy` (politique de confidentialité RGPD), `GET /legal/terms` (CGU + règles de communauté UGC exigées par Apple), `GET /legal/delete-account` (page web de suppression exigée par Google Data Safety) — HTML statique sobre, pied « non affilié à TV Time ni à Whip Media » (testé). Mobile : section « À propos » dans Paramètres > Application (liens privacy/CGU + attributions obligatoires TMDb/TheTVDB/IGDB) |
| Langue de contenu par utilisateur | ✅ Fait | Paramètres > Langue (fr/en/es/de/it/pt) : titres/résumés des séries et films traduits partout (À voir, À venir, bibliothèque, profil, fiches, recherche, explorer, fil social, listes) via TMDb `/translations` (`Media.translationsJson`, une requête par média, backfill en fond au changement de langue) ; jeux IGDB hors périmètre (nom international) |

## Prochaines étapes (par priorité)

0. ~~**Migration front Prisme**~~ ✅ **Terminée** (lots 1–14) : tokens,
   primitives, shell/navigation et **tous les écrans** migrés en Prisme sans
   régression fonctionnelle (plan [`docs/REFONTE_FRONT_PRISME.md`](REFONTE_FRONT_PRISME.md),
   matrice [`de parité fonctionnelle`](feature-parity-matrix.md)). Reste à faire
   côté prod : redéployer l'export Web après fusion (géré par Benjamin).
1. **Retours Benjamin (08/07 aprem)** :
   - **Barre de progression** sur les séries/animés (façon TV Time : mince barre
     épisodes vus / total sous les cartes « À voir » et sur le profil). Données
     watchedCount/totalCount à exposer côté serveur.
   - **Explorer façon TikTok/Tinder** : suggestions en plein écran, image du média,
     description en surimpression au tap, scroll vertical pour changer de suggestion,
     swipe droite = « À voir » (watchlist), swipe gauche = « Pas intéressé »
     (`/api/disliked`, `isHidden` — déjà en place). Gros chantier UI (gestes en web
     app), backend prêt.
2. Option « Ne plus suivre » / gestion fine depuis les listes du profil (l'API existe : `DELETE /api/shows/:id/tracking`).
4. Notifications push (quand on passera au dev build Expo).
5. SSO Google/Facebook (ids OAuth à créer, dev build requis).
6. Publication native optionnelle (EAS Build APK, puis stores).

## Journal des modifications

### 2026-07-21 — Claude/Étienne : Explorer — cartes & overlay détails peaufinés
- **Libellé « Fiche »** sous la vignette-affiche du rail d'actions
  (`components/explore/ActionRail.tsx`) : signale que cette vignette ouvre la
  fiche de l'œuvre, à l'image des autres actions (À voir, Déjà vu…).
- **« Touchez pour déplier les détails » cliquable** (`TikTokCard.tsx`) :
  l'invite était un simple texte dans la légende `box-none` → il interceptait
  le tap sans le transmettre au fond (zone morte pile sur l'invite). Elle
  devient un vrai bouton (hitSlop généreux) ; la bascule ouvre/ferme l'overlay.
- **Overlay détails lisible en Glass** (`DescriptionOverlay.tsx`) : fond passé
  de `surface` (voile translucide, l'affiche transparaissait) à `sheet`
  (quasi opaque en Glass) — texte enfin lisible.
- **Trait rose retiré** : la barrette d'accent (`sheetAccent`, couleur
  secondaire) en haut du panneau est supprimée.
- **Bouton d'accès à la fiche** : « VOIR LA FICHE » (+ icônes lien/flèche)
  devient **« Accéder à la fiche »**, sans icône.
- Validé en Chromium (thème Glass, feed simulé) ; `tsc --noEmit` + export web OK.


### 2026-07-21 — Claude/Étienne : Explorer — barre de recherche flottante + feed pleine hauteur
- **Barre de recherche FLOTTANTE** (`mobile/app/(tabs)/explore.tsx`) : le
  bandeau opaque (fond `surface` + bordure) derrière le champ est supprimé ;
  l'en-tête passe en position absolue, fond transparent, posé au-dessus du
  feed. Le champ garde son style (pilule `surface` + ombre portée pour l'effet
  flottant) et s'agrandit toujours au focus/saisie.
- **Fond du feed pleine hauteur** : le feed (et les résultats de recherche)
  occupe désormais tout l'écran, son fond (`#0D0A14`) remonte derrière la barre
  flottante. La hauteur de la barre est mesurée (`onLayout`) et passée au
  `TikTokFeed` (`topInset`) : les chips de catégories se calent juste sous la
  barre ; les résultats de recherche reçoivent le même décalage haut.
- **Barre de progression supprimée** (`components/explore/TikTokFeed.tsx`) :
  la mince jauge « position dans le tirage » est retirée (elle suggérait une
  fin) — le flux reste infini (re-tirage sur la carte de fin). État
  `activeIndex` devenu inutile supprimé au passage.
- Validé en Chromium (thème Glass, feed simulé) : barre flottante, fond
  remontant, chips repositionnées, aucune jauge ; `tsc --noEmit` + export web OK.

### 2026-07-21 — Claude/Benjamin : bibliothèque intégrale d'un ami (séries/films/jeux)
- **Serveur** : `GET /api/users/:id/library` (module social) — liste paginée par
  curseur (`type=show|movie|game`, `take` ≤ 60, tri `lastWatchedAt` desc puis
  `updatedAt` desc, `isHidden` exclu) renvoyant `{ items: [{ media {id, title,
  posterPath, type, year}, status, rating, isFavorite }], nextCursor, total }`.
  Visibilité alignée sur `GET /api/users/:id` : privé non suivi → 403
  `restricted`, soi-même toujours autorisé ; et un cran de plus, bloqué PAR le
  profil consulté → 404 (même réponse qu'un id inconnu). Tests
  `src/__tests__/user-library.test.ts` (9 cas : tri/contenu, filtres par type,
  pagination, isHidden, privé non suivi/suivi/soi-même, blocage, 404/400).
- **Mobile** : nouvel écran `app/user-library.tsx` (route plate `?id=&name=&type=`
  car `app/user/[id].tsx` est un fichier plat) — ScreenHeader « Bibliothèque de
  {nom} », SegmentedFilter Séries/Films/Jeux, grille 3 colonnes en FlatList +
  `useInfiniteQuery` (pagination infinie), cœur sur les favoris + badge de
  statut discret, états Loading/LoadError/vide et carte « Profil privé » sur 403.
  Portes d'entrée : rangée « Voir toute sa bibliothèque » sur le profil public
  (`app/user/[id].tsx`) et lien « SA BIBLIOTHÈQUE » dans l'aperçu
  (`UserPreviewSheet`). Route déclarée dans `app/_layout.tsx`.

### 2026-07-21 — Claude/Benjamin : ligne de suivi compacte sur toutes les fiches
- **Nouveau composant partagé `mobile/components/StatusLine.tsx`** : les statuts
  de suivi tiennent sur UNE seule ligne de petites pilules (hauteur 34,
  `RADIUS.pill`, fond `surfaceMuted`, sélection `primary`/`onPrimary`,
  `FONTS.semiBold`) ; ScrollView horizontale sans indicateur si l'écran est
  étroit ; a11y `radiogroup`/`radio` + état `checked`, hitSlop vertical pour
  garder une cible ~44.
- **Fiche jeu (`app/game/[id].tsx`)** : le gros bloc « Suivi » (titre +
  sous-titre + 4 grosses pilules sur 2 lignes) est remplacé par un petit titre
  discret + StatusLine ; « Je possède » devient une seule ligne label +
  interrupteur (sans icône ni sous-titre). Comportements inchangés
  (désélection = retrait du suivi, feuille temps de jeu, verrou anti double-tap).
- **Fiches série/film/animé (`app/show/[id].tsx`)** : même ligne de suivi en
  PREMIÈRE carte du corps (haut de « À propos » côté série, haut de la fiche
  côté film). Série/animé : À voir (`POST /watchlater`) / En cours
  (`POST /status watching`) / Terminée (`POST /status completed`) / Arrêtée
  (`POST /abandon`) — pas de désélection par re-tap (le DELETE `/tracking`
  effacerait aussi l'historique d'épisodes ; « Supprimer la série » reste dans
  le menu). Film : À voir (`POST /unwatched`) / Vu (`POST /watched`),
  re-taper le statut actif retire le film (`DELETE /tracking`). Mises à jour
  optimistes + invalidations existantes (`shows`, `movies`, `profile`,
  `gamification`, `search`).
- **Doublons retirés** : rangée « Vu / Pas vu » à coche de la fiche film
  (remplacée par la ligne) ; entrées de menu « Regarder plus tard » et
  « Arrêter de regarder » (strictement identiques aux pilules À voir/Arrêtée).
  Libellé `watchlist` harmonisé : « À voir » (menu + toast).

### 2026-07-20 — Claude/Étienne : sous-onglets Accueil + équilibre Glass (menus/pilule)
- **Accueil scindé en Séries / Films / Jeux** (miroir de l'Agenda,
  `mobile/app/(tabs)/index.tsx`) : Séries = la file d'épisodes historique
  (défaut à l'ouverture) ; **Films** = les films ajoutés mais pas encore vus
  (`/api/movies` → `toWatch`, déjà sortis — les sorties futures restent dans
  Agenda > Films) ; **Jeux** = les jeux marqués « Voulu » pas encore commencés
  (`/api/games` → `wishlist`). Rangées affiche + titre + année, caches
  partagés avec l'Agenda et l'onglet Jeux.
- **Glass — menus flottants lisibles** : nouveau rôle de palette `sheet`
  (fond des menus « … », modales et feuilles) — identique à `surface` dans
  tous les thèmes SAUF Glass où il est quasi opaque
  (`rgba(252,251,255,0.94)`). Appliqué à tous les menus/modales flottants :
  menus « … » des fiches série/jeu, feuille épisode, heures de jeu,
  commentaires, filtres bibliothèques, pseudo (Paramètres), badge (Trophées),
  blocage (profil public), signalement, favoris, popups divers. Zéro
  changement visuel hors Glass (`white`/`surface` y étaient identiques).
- **Glass — pilule de navigation plus transparente** : voile abaissé à
  `rgba(255,255,255,0.36)` (au lieu de `surface` 0.55) sur web où le flou
  d'arrière-plan maintient la lisibilité ; natif et autres thèmes inchangés.
- Validation : scénario Chromium (sous-onglets, modale pseudo, pilule) sur le
  dev server + export statique compilé ; `tsc --noEmit` OK.

### 2026-07-20 — Claude/Étienne : Glass web VRAIMENT réparé (superposition + pilule opaque)
- **Cause racine identifiée** (reproduction locale Chromium/Playwright sur
  l'export web) : sur web, react-native-screens est **désactivé par défaut**
  (`ENABLE_SCREENS = plateforme native`) et, dans ce mode, le fallback de
  `@react-navigation/bottom-tabs` rend chaque onglet dans une View brute **sans
  aucun masquage** — les scènes inactives restent peintes (zIndex −1). Les
  fonds opaques des autres thèmes les recouvrent ; les voiles translucides de
  Glass les laissaient transparaître (superposition), et l'empilement des
  voiles formait un mur quasi opaque derrière la pilule (aucun effet de verre).
  Le correctif précédent (`enableScreens(false)`) était donc un no-op.
- **Correctif** (`mobile/app/_layout.tsx`, web + Glass uniquement) :
  `enableScreens(true)` — les onglets passent par `Screen.web` de
  react-native-screens qui masque réellement les scènes inactives
  (`display:none`). Une seule scène peinte → plus de superposition, et le
  `backdrop-filter` de la pilule échantillonne enfin le contenu qui défile.
- **Validation** : scénario complet (login → Profil → Paramètres → retour →
  Accueil → Agenda) joué dans Chromium sur le serveur dev **et** sur l'export
  statique (`expo export -p web`, parité prod) — une seule scène visible dans
  le DOM à chaque étape, captures à l'appui ; `tsc --noEmit` OK.
- **Édition du profil** : mention « Visible partout dans l'app » retirée sous
  « Photo de profil ».

### 2026-07-20 — Claude : refonte Communauté, côté serveur (QG agrégé anti-spam)
- **`GET /api/social/overview`** (`apps/server/src/modules/social/routes.ts`) :
  le QG de l'onglet Communauté en UNE requête HTTP — `now` (« En ce moment » :
  dernier WatchEvent 'watched' par ami, 1 entrée/ami, max 15), `recent`
  (« Récemment vus » agrégé par ami × média × jour Paris via `dayKeyParis`,
  fenêtre 7 j, max 30 groupes, `count` = épisodes du jour, `refId` = événement
  le plus récent → cible kudos) et `badges` (14 j, max 20, `refId` =
  `UserBadge.id`). Follows filtrés blocklist, requêtes bornées, réactions +
  niveaux/streaks chargés en batch (pas de N+1).
- **`GET /api/social/discussions`** : fils où mes amis sont actifs (14 j),
  groupés par média — `commentCount`, `participants` (max 3, amis uniquement),
  `lastAt` ; **anti-spoiler** : ni texte des commentaires ni numéros d'épisode.
- **Notification kudos** : `POST /api/social/feed/react` notifie le
  propriétaire à la CRÉATION d'une réaction (type `reaction`, « X a salué ton
  activité / ton badge ») — jamais au retrait, jamais soi-même, kind `comment`
  exclu (flux `comment_reaction` existant), blocages filtrés par `notifyUser`.
- **Tests** : `src/__tests__/social-overview.test.ts` (9 tests) — agrégation
  par jour, filtres bloqués/non-suivis, kudos → notification, toggle off sans
  notification, filtre blocage. `tsc --noEmit` 0 ; suite vitest 230/231 (seul
  échec préexistant : `api.test.ts` /health APP_NAME).

### 2026-07-20 — Claude/Étienne : retours UX v2 (barre flottante, Glass réparé, profil peaufiné)
- **Barre de navigation FLOTTANTE (tous thèmes)** : la pilule est posée en
  absolu au-dessus des écrans — plus de « deuxième barre » opaque derrière, le
  contenu défile dessous (et transparaît en Glass). Zones transparentes
  perméables aux touches (`box-none`) ; paddings bas des onglets rehaussés.
- **Thème Glass réparé (superposition des écrans)** : cause racine —
  react-native-screens laisse les scènes inactives visibles dans le DOM web,
  d'ordinaire masquées par des fonds opaques… que Glass rend translucides.
  Correctif ciblé : `enableScreens(false)` sur **web + Glass uniquement**
  (scènes inactives en `display:none`), cartes du Stack transparentes en Glass.
- **En-têtes Accueil/Profil** : cloche et réglages en **icônes nues 25 px**
  calées à droite (~16 dp du bord, comme Instagram) — plus de cercle gris.
- **Modifier le profil — lifting** : grands aperçus (avatar circulaire 128,
  bannière 16:9 pleine largeur), boutons Changer/Supprimer par section,
  « Photo de couverture » renommée **« Bannière »** partout, note de renvoi
  vers les Paramètres supprimée.
- **Tuiles du profil (liste arrêtée)** : épisodes vus, temps devant les
  épisodes, films vus, temps devant les films, jeux joués, temps de jeu
  (déclaré) — contenu **centré** avec pastille d'icône.
- **Sections du profil** : renommées (**Séries favorites / Films favoris /
  Jeux favoris**), ordonnées Séries → favorites → Films → favoris → Jeux →
  favoris, et présentées en **cartes** raccord avec le reste de l'onglet.
- **Temps de jeu facile à trouver** : bouton dédié « Temps de jeu — Déclarer
  mes heures / Xh ✎ » directement dans le bloc de suivi de la fiche jeu,
  visible quel que soit le statut — plus besoin de re-basculer un statut.

### 2026-07-20 — Claude/Étienne : stats refondues, temps de jeu déclaratif, médailles
- **Statistiques (`/stats`) — composition PlotTime originale** (rupture avec la
  présentation TV Time) : segments **Séries / Films / Jeux** en pilule Prisme,
  **carte héro « temps » en dégradé** avec durée décomposée mois·j·h,
  tuiles duo, **graphique hebdo à barres arrondies dégradé rose→violet**
  (semaine courante mise en avant), **genres en barres proportionnelles**
  (fini le tableau deux colonnes), chaînes en **chips comptées**, marathons
  médaillés or/argent/bronze, bouton « Comparer avec mes abonnements » en
  pilule pleine, accès Badges avec progression.
- **Nouvel univers Jeux dans les stats** : héro « temps de jeu déclaré »
  (dégradé or), tuiles en cours / terminés / abandonnés / possédés / voulus /
  suivis, **« Tes plus grosses sessions »** (top jeux par temps déclaré, tap →
  fiche pour corriger), genres. Serveur : bloc `games` ajouté à
  `/api/stats/detailed` (état vide propre tant que la prod n'est pas redéployée).
- **Temps de jeu déclaratif** : nouvel endpoint `POST /api/games/:id/playtime`
  (heures → minutes, `null` efface ; écrase la valeur Steam). Sur la fiche jeu,
  passer un jeu **En cours / Terminé / Abandonné** ouvre une **feuille non
  bloquante** « Combien d'heures as-tu passé sur … ? » (« Plus tard » possible),
  et la ligne **Temps de jeu** des Informations devient **éditable** à tout
  moment (point d'édition unique, accessible depuis le Profil → Jeux → fiche et
  Stats → Jeux → top). Test serveur `game-playtime.test.ts` (3 cas).
- **Profil — tuiles de temps** : « X mois Y j Z h devant les séries et films »
  et « X j Y h de jeu (déclaré) » en tuiles pleine largeur
  (`ProfileStatsDto.gamePlaytimeMinutes`), en plus des compteurs scindés jeux
  en cours / jeux terminés (repli inchangé si serveur non redéployé).
- **Trophées & Badges — médailles** : nouveau composant `components/medals.tsx`
  (SVG) — **jetons métalliques** avec dégradés par palier (bronze/argent/or/
  platine), arête en relief, **reflet spéculaire**, **anneau de progression
  circulaire** vers le prochain palier (dégradé Prisme), verrouillé = étain +
  cadenas ; **médaillon de niveau** avec anneau d'XP. Trophées : héro nuit
  violette avec formes Prisme, flamme streak sur dégradé chaud, défis sur
  ProgressBar, modale de badge redessinée (chip de palier). Page Badges :
  mêmes médailles (or = débloqué), synthèse avec progression.
- **Validation** : typecheck mobile + serveur verts ; tests serveur ciblés
  verts (playtime 3/3, stats) ; export Expo Web complet.

### 2026-07-20 — Claude/Étienne : retours UX (en-têtes, 18+, édition profil scindée, pseudo unique)
- **Accueil** : le raccourci Profil (avatar) disparaît de l'en-tête ; seule la
  **cloche de notifications** reste, en haut à droite de « À voir » — et elle
  n'existe que sur l'onglet Accueil.
- **Profil** : plus de cloche dans l'en-tête ; le bouton **Réglages** occupe
  seul le coin droit.
- **Paramètres** : en-tête allégé (titre « Paramètres » seul, sans eyebrow ni
  sous-titre) ; la section **Contenu 18+ est masquée sur iOS ET Android**
  (conformité stores — elle reste disponible sur la web app).
- **« Modifier le profil » réduit aux photos** : avatar + bannière uniquement.
  Le **nom d'affichage** et le **pays** s'éditent désormais dans Paramètres →
  Compte → Identification (année de naissance et sexe retirés de l'interface,
  demande produit — les champs restent en base et côté API).
- **Nom d'affichage unique** : `POST /api/profile` refuse (409
  `display_name_taken`, insensible à la casse) un pseudo déjà porté par un
  autre compte ; chiffres et caractères spéciaux autorisés (longueur 1–80,
  espaces de bord retirés). Modale dédiée dans Paramètres avec erreur claire
  « Ce nom est déjà utilisé » ; sélecteur de pays plein écran conservé.
  **Nouveau test serveur** `display-name-unique.test.ts` (3 cas : refus 409,
  caractères spéciaux acceptés, reprise de son propre pseudo).
- **Validation** : typecheck mobile + serveur verts ; tests ciblés verts
  (3 nouveaux + 25 api) ; export Expo Web complet.

### 2026-07-20 — Claude/Étienne : Accueil & Profil rapprochés des maquettes Prisme
- **Serveur** — `GET /api/shows/queue` expose désormais `progress {watched,total}`
  par série (épisodes diffusés hors spéciaux, même sémantique que la
  bibliothèque) : c'était le point n°1 des « retours Benjamin » (barres de
  progression). `GET /api/profile` expose `gamesPlaying` / `gamesCompleted`
  (détail par statut). Champs **optionnels** côté client : tant que la prod n'a
  pas redéployé le serveur, l'app masque les barres et replie sur « jeux joués ».
- **Accueil** (`(tabs)/index.tsx`) : carte **héro « À regarder maintenant »**
  (backdrop, S·E — titre, barre de progression dégradée, bouton « Marquer vu »,
  badges et +N conservés) pour le premier épisode de la file ; rangées
  restylées façon maquette (`EpisodeQueueCard` : vignette affiche arrondie,
  titre, « S2 · E4 — Titre », barre de progression, coche ronde) ; en-têtes de
  groupes « libellé + N épisodes » ; **cloche de notifications (badge non-lus)
  et avatar → Profil** dans l'en-tête. Historique masqué au-dessus, feuille
  épisode, groupes, pastille flottante, +N, badges et mutations optimistes
  inchangés. `UpcomingView` (Agenda) non touché.
- **Profil** (`(tabs)/profile.tsx`) : **bannière en carte arrondie** au-dessus
  des stats (avatar incrusté à bord blanc, nom, « Niveau X · Titre », bouton
  Modifier) au lieu de la couverture pleine page ; en-tête d'onglet compact
  avec cloche + réglages ; **tuiles de stats all-time** en grille 2 colonnes
  (épisodes vus, films vus, temps de visionnage, séries suivies, **jeux en
  cours**, **jeux terminés**) avec « Tout afficher » → `/stats` ; **encart
  streak** (série de X jours, record) → `/trophies` ; favoris remontés
  (séries/films/jeux préférés) puis Listes et bibliothèques Séries/Films/Jeux.
  Compteurs sociaux, tri des favoris, toutes les destinations et données
  conservés ; l'effet meta theme-color de l'ancienne couverture est retiré.
- **Types** : `QueueItemDto.progress?` et `ProfileStatsDto.gamesPlaying?/
  gamesCompleted?` (packages/types + miroir mobile) ; `episodeCodeCompact()`
  (« S2 · E2 ») dans `lib/format.ts`.
- **Validation** : typecheck mobile + serveur + packages verts ; **158 tests
  core** verts ; **suite serveur complète 199/199 (32 fichiers) verte** —
  première exécution intégrale depuis le début du chantier (le moteur Prisma
  la bloquait sous Windows ; elle tourne sous Linux, session cloud) ; export
  Expo Web complet (42 pages).
### 2026-07-20 (soirée) — Claude : session d'audit complète (bugs, sécurité, perf, archi) + correctifs
- **4 audits parallèles** sur tout le repo, puis correctifs appliqués et testés :
- **Sécurité** : rate limiting global (300/min, routes auth plus strictes conservées) ;
  notifications filtrées par blocage ; cible des réactions du fil contrôlée
  (plus d'oracle d'IDs) ; OAuth fail-closed (`provider_not_configured` si
  credentials absents — Google/Facebook/Discord/Apple) ; bornes zod ; blocklist
  appliquée au défi hebdo et au leaderboard stats.
- **Bugs** : toggle réaction idempotent (plus de 500 en double-tap) ; likes de
  commentaires unifiés sur CommentReaction (fil ↔ écran commentaires
  synchronisés) ; réponses exclues du fil ; parentId non-racine rejeté ;
  episodeId vérifié contre le média ; favoris masqués (`isHidden`) exclus des
  profils ; réactions orphelines purgées à la suppression d'un commentaire ;
  stats hebdo en Europe/Paris partout ; fallbacks minutes unifiés (42/115).
- **Perf** : profil public lit UserProgress/UserBadge persistés (plus de scan
  20k épisodes par visite) ; index `Rating[userId,episodeId]` +
  `ActivityReaction[userId]` (migration `audit_indexes`) ; clubs sans clause IN
  géante ; cartes du fil mémoïsées (plus de remontage à chaque ❤️) ; nginx :
  cache immutable sur les assets hashés (gzip déjà actif, 2,4 Mo → 667 Ko).
- **Archi/qualité** : CI activée (`.github/workflows/ci.yml`, existait sans
  être branchée) ; code mort supprimé (MediaTypeChip, onglet movies
  inatteignable, export styles) ; pull-to-refresh sur le Classement ;
  invalidations follow → classements. 17 nouveaux tests serveur (216 au total).
- **Corrigé en prod au passage** : URLs de dossier `/prisme/xxx/` qui
  renvoyaient 403 (fallback SPA nginx via `error_page 403`).
- **Chantiers restants notés (non faits)** : follows en attente pour les
  comptes privés (contournement du mode privé en un clic — produit à
  designer) ; pagination du fil et des commentaires ; migration des 3 écrans
  PageHeader restants ; partage des types mobile/serveur via
  `@serietime/types` ; virtualisation accueil/agenda ; tests mobile ;
  découpage de `social/routes.ts` et `show|game/[id].tsx`.

### 2026-07-20 — Claude : 5 fonctionnalités communautaires (côté mobile)
- **Réactions sur le fil** (`app/social.tsx`) : cœur ❤️ + compteur en pied de
  chaque carte (média et badge), toggle `POST /api/social/feed/react` avec
  mise à jour optimiste du cache `['social','feed']` (rollback si erreur).
- **« Tes amis ont adoré »** : `FeedTab` accepte une prop `header` ; dans
  l'onglet Communauté, carrousel horizontal de recommandations
  (`/api/social/recommendations`) avec note moyenne et « Aimé par {prénoms} ».
- **Défi de la semaine** (segment Classement) : PrismeCard au-dessus du
  classement (`/api/social/challenge/weekly`) — rangs, avatars, minutes
  depuis lundi, ProgressBar relative au leader, couronne or.
- **Streaks visibles** : « 🔥 {streak} » à côté du nom sur le fil ; onglet
  Amis : liste « Mes abonnements » (`/api/social/following`) affichée hors
  recherche, avec « 🔥 {streak} · Nv. {level} » (jamais sur les résultats de
  recherche, le serveur ne les y fournit pas).
- **Clubs** : 4e segment de l'onglet Communauté (`components/community.tsx`) —
  Mes clubs / Suggestions (`/api/clubs`, join/leave avec confirmation),
  discussion = fil de commentaires du média (`/comments/[id]`), création via
  modal listant ma bibliothèque (queries `/api/shows/library` +
  `/api/movies/profile` réutilisées).

### 2026-07-20 (nuit) — Claude : onglet Communauté remplace Bibliothèque
- **Décision équipe (Benjamin)** : Bibliothèque doublonnait le Profil (mêmes
  liens `/library/*`). L'onglet devient **Communauté** (`81670af`, icône
  users) : **Fil** (activité des abonnements — épisodes vus, notes, badges
  débloqués), **Classement** (temps séries/films entre amis, tableau partagé
  avec l'écran Stats) et **Amis** (recherche + abonnements). Réutilise
  `FeedTab`/`FriendsTab` (social.tsx) et `LeaderboardBoard` (leaderboard.tsx),
  désormais exportés. Films/Jeux (onglets masqués) se rattachent au Profil.
- **Pistes communautaires/gamifiées à discuter** (non implémentées) :
  réactions sur le fil, recommandations « tes amis ont adoré », défis
  hebdo entre amis (qui regarde le plus), streaks visibles sur le fil,
  vitrine de badges sur le profil public, clubs/watch-parties par série.

### 2026-07-20 (nuit) — Claude : agenda en 3 segments + en-têtes compacts (retours Étienne)
- **Agenda coupé en trois** (`200f793`) : segments Séries / Films / Jeux.
  Séries = épisodes à venir (existant) ; Films = sorties des films de la liste
  (`/api/movies` → `upcoming`, rangées affiche + date) ; Jeux = sorties des
  jeux suivis (`/api/games/upcoming`, groupes par période).
- **En-têtes d'onglets compacts** : nouveau `TabHeader` (titre seul, centré,
  18 px) sur Accueil, Agenda, Explorer, Bibliothèque, Jeux, Films — suppression
  des eyebrows/sous-titres (« Reprenez exactement là où vous en étiez »,
  « INSPIRATIONS », « Trouvez votre prochaine histoire »…). Les écrans poussés
  (réglages, stats…) gardent leur grand en-tête avec retour.
- **Onglet Bibliothèque : PAS refondu** — décision d'équipe en attente.
  Constat : c'est aujourd'hui un simple menu de liens + compteurs (double
  navigation). Proposition Claude à trancher : en faire la vraie bibliothèque
  (segments Séries / Films / Jeux affichant directement les collections,
  favoris épinglés en tête) et retirer les écrans intermédiaires ; sinon le
  supprimer et promouvoir Films/Jeux dans la tab bar. À valider par Étienne.

### 2026-07-20 — Claude : nouveau thème « Glass » (verre liquide)
- **Cinquième thème « Glass »** inspiré du langage Liquid Glass d'Apple
  (WWDC 2025), transposé à l'identité PlotTime (accents violet/jaune conservés,
  aucune réplique d'écran Apple) : surfaces en blancs translucides (rgba) avec
  arête spéculaire blanche, posées sur un dégradé pastel bleu/lavande/rose
  peint avant le premier rendu par `app/+html.tsx`.
- **Flou d'arrière-plan réel** via `GLASS_BLUR` (`lib/theme.ts`) :
  `backdrop-filter: blur + saturate` (web uniquement, react-native-web ≥ 0.21,
  objet vide dans les autres thèmes et sur natif) étalé sur `PrismeCard`,
  `SegmentedFilter`, la barre d'onglets flottante et les feuilles des réglages.
- Metas `theme-color` : nouvelle constante `THEME_COLOR_META` (couleur solide —
  les barres système n'acceptent pas d'alpha, or `bg` Glass est un voile rgba).
- `ui.tsx` : texte des badges « black » et coche de `CheckCircle` passés de
  `COLORS.white` à `COLORS.onPrimary` (valeurs quasi identiques dans les 4
  thèmes existants ; en Glass, `white` translucide est inutilisable en texte).
- Serveur : enum `theme` de `/api/settings` étendu à `midnight` (correction —
  la copie serveur du thème Nuit échouait silencieusement depuis son ajout) et
  `glass`. Comme Sunset/Nuit, Glass ne s'applique que sur la web app.

### 2026-07-20 (soir) — Claude : lots 12-14 → version full-Prisme (arbitrage inversé)
- À la demande d'Étienne, la **base des lots 12-14 est désormais la version
  full-Prisme** (`062de06`, ex-branche `claude/finish-prisme`) : ScreenShell/
  ScreenHeader/SegmentedFilter/PrismeCard sur réglages, stats, badges,
  leaderboard, trophées, profil (édition/couverture), import, comptes liés,
  jeux. Greffe depuis la version précédente : **bouton retour des réglages**
  (`goBack` avec fallback — c'était la cause du bug « retour » signalé).
- Parité fonctionnelle vérifiée fichier par fichier (resync bibliothèque,
  disclaimer TV Time/Whip, liaisons SSO, avatar/couverture, 18+ masqué iOS,
  attributions TMDb/TheTVDB/IGDB, suppression de compte). Typecheck 0 erreur ;
  préversion redéployée sur `/prisme/` (retour vérifié au clic, console propre).

### 2026-07-20 — Claude : arbitrage Fable/Opus des lots 12-14 + préversion web
- **Arbitrage** (commit `60f685c`) : la version `main` (Fable) des lots 12-14 est
  conservée comme base ; greffes ciblées depuis la branche Opus
  `claude/finish-prisme` : tint du pull-to-refresh en `COLORS.primary` +
  centrage `contentMax` de la file « À voir » (`(tabs)/index.tsx`), toast de
  gamification restylé Prisme (`lib/useGamificationToasts.ts`), a11y du profil
  (roles radio/état coché, label « Fermer »), gris en dur → `COLORS.textSoft`
  (trophées). Typecheck mobile : 0 erreur.
- **Bouton retour** : vérifié en préversion (clic avec historique ET arrivée
  directe pile vide → fallback `goBack`) — le bug rapporté venait de l'ancien
  build Opus déployé, le build `main` est sain.
- **Préversion web déployée** : `https://serietime.studio-vives.fr/prisme/`
  (export Expo web avec `experiments.baseUrl=/prisme`, nginx `root`+`try_files`).
  La prod (`/`) et le site photo restent inchangés. Reste : clic-tour connecté
  (Benjamin/Étienne) avant bascule de la prod.

### 2026-07-18 — Claude : convergence Jeux/Home + QA globale (lot 14 — refonte terminée)
- **Onglet Jeux** (`/(tabs)/games`) : en-tête d'écran cohérent avec l'onglet
  Séries (eyebrow BIBLIOTHÈQUE + titre + sous-titre), fond `pageMuted`, **grille
  responsive** (3/4/5 colonnes, contenu centré à `contentMax`), carrousels
  découverte/sorties en tokens Prisme. Bibliothèque par statut (VOULUS/POSSÉDÉS/
  EN COURS/TERMINÉS/ABANDONNÉS), pastille de statut flottante, pull-to-refresh,
  découverte IGDB (tap = ajoute + ouvre la fiche), sorties à venir groupées par
  mois : logique, requêtes et routes strictement inchangées.
- **Convergence** : Home (`index`) et Agenda déjà Prisme (lots précédents) ;
  Jeux aligné sur la même identité ; l'écran hub Bibliothèque et les pages
  favoris restent cohérents. Toutes les routes historiques (`movies`, `games`,
  `/library/*`, deep links média/personne/épisode/commentaires) restent
  enregistrées et ouvrent la vue équivalente.
- **QA globale** : `tsc --noEmit` mobile vert sur l'ensemble ; **export Expo Web
  réussi (42 fichiers, toutes les routes générées, aucune erreur ni avertissement)**.
- **Bilan** : la migration visuelle Prisme couvre désormais **tous les écrans**
  de l'application (lots 1–14). Aucune fonctionnalité retirée ; aucune
  modification de schéma, d'endpoint ni d'authentification.

### 2026-07-18 — Claude : réglages, compte, profil, imports Prisme (lot 13)
- **Paramètres** (`/settings`) : onglets Compte/Application sur `TopTabs` Prisme,
  sections regroupées en **cartes surface** (lignes 44px, séparateurs fins,
  pastilles d'icône), zone sensible (déconnexion/suppression) **isolée** dans sa
  propre carte, feuilles modales sur surface avec largeur bornée. Aucune
  préférence retirée : mot de passe + réinitialisation SSO, comptes liés, import
  TV Time, export, resync bibliothèque, Steam, profil privé, thème (4 thèmes),
  langue de contenu, contenu 18+ (masqué iOS), vider le cache, liens légaux et
  attributions TMDb/TheTVDB/IGDB — toutes les mutations et gardes conservées.
- **Édition du profil** (`/profile/edit`) : en-tête surface avec bouton
  Sauvegarder plein, champs regroupés en cartes, entrées et sélecteurs Prisme,
  modales Sexe/Pays sur surface. Sélection d'avatar (resize 512px), couverture,
  année/sexe/pays et sauvegarde optimiste inchangées.
- **Couverture** (`/profile/cover`) : barre de recherche pilule surface, résultats
  et bannières en tokens Prisme, apparition en cascade. Résolution TMDb/TVDb et
  choix de bannière inchangés.
- **Comptes liés** (`/linked-accounts`) : rangées liées en carte surface avec
  pastille d'état, boutons SSO Prisme. Liaison/déliaison Google/Discord/Facebook
  inchangée.
- **Import TV Time** (`/import`) : parcours Source → fichier → analyse →
  confirmation → progression → bilan en cartes surface, barre de progression
  animée, bilan de fin illustré. Upload, analyse, reprise et polling inchangés.
- **Validation** : `tsc --noEmit` mobile vert.

### 2026-07-18 — Claude : statistiques, badges, trophées Prisme (lot 12)
- **Reprise du chantier Prisme là où Codex s'était arrêté** (lots 1–11 déjà sur
  `main`). Développement sur la branche `claude/plottime-refonte-lots-12-14-vonk3r`.
- **Statistiques** (`/stats`) : canevas responsive `contentMax`, cartes surface
  élevées, en-tête d'onglets sur surface, pastilles d'icône par section, eyebrows,
  histogrammes maison recolorés (barre courante en violet Prisme), apparition en
  cascade. Données, onglets Séries/Films, comparaison et lien Badges inchangés.
- **Badges** (`/stats/badges`) : carte de synthèse « X / total » avec pastille
  jaune, sections en cartes surface, grille verrouillé/débloqué conservée.
- **Classement** (`/stats/leaderboard`) : lignes en cartes surface, médailles
  or/argent/bronze sur les trois premiers rangs, ligne « vous » en accent violet.
  Onglets Séries/Films, format de durée et état vide inchangés.
- **Trophées** (`/trophies`) : canevas responsive, cartes surface élevées, blocs
  niveau/streak/défis/badges/classement en tokens Prisme, modale de badge sur
  surface avec bouton plein, squelette recalé. Toute la gamification (XP, paliers,
  streaks, défis, badges, classement hebdo, modale) est préservée.
- **Validation** : `tsc --noEmit` mobile vert.

### 2026-07-18 — Codex : communauté et notifications Prisme
- **Communauté** : le fil, la recherche d’amis et les listes d’abonnés/abonnements
  adoptent des cartes Prisme, des listes virtualisées, le rafraîchissement et des
  mutations optimistes verrouillées avec rollback et erreur visible.
- **Parité multi-média** : activités et commentaires personnels ouvrent désormais
  correctement les fiches Série, Film ou Jeu ; les profils restent accessibles
  séparément sans boutons imbriqués sur le Web.
- **Profil public** : avatar réel, confidentialité, suivi, blocage, réputation,
  trophées, streaks, statistiques, récents et favoris des trois médias sont
  conservés dans un canevas responsive et accessible.
- **Notifications** : lecture globale, badge, états réseau et destinations média,
  acteur, statistiques ou badges sont préservés et explicités dans le centre
  Prisme chronologique.
- **Routes Expo** : les navigations dynamiques Personne, recommandations, épisode
  et commentaires ont reçu le type Href après régénération des routes, sans
  changement de destination ni de logique.
- **Validation** : typechecks mobile et monorepo validés ; 158 tests core validés ;
  export Expo Web de 41 routes validé ; smoke visuel des 5 routes du lot à
  390/1440 px sans débordement, erreur console, 404 ni erreur d’hydratation. Les
  20 tests serveur sans base passent ; les 163 tests SQLite restent bloqués avant
  exécution par le moteur Prisma (Schema engine error).

### 2026-07-18 — Codex : fiches détaillées Prisme
- **Séries et films** : la fiche complète adopte Prisme sans modifier consultation,
  suivi, vu/non-vu, saisons, casting, recommandations, listes, personnalisation,
  partage, signalement, favoris, watch later, abandon ni suppression.
- **Jeux et personnes** : statuts, possession, extensions, bande-annonce,
  filmographie, liens sociaux et résolution des médias conservent leurs routes et
  contrats, avec responsive, états réseau et retours d'erreur explicites.
- **Épisodes et commentaires** : feuilles et discussions Prisme accessibles,
  navigation latérale et longues listes virtualisées, réponses, réactions,
  modération, signalement et suppression préservés.
- **Fiabilité** : mutations concurrentes verrouillées, rollbacks visibles, succès
  affichés après confirmation, créations de listes récupérables après échec
  partiel et marquage global aligné sur les épisodes réellement diffusés.
- **Validation** : typechecks mobile, serveur et types partagés validés ; 158 tests
  core validés ; export Expo Web de 41 routes et contrôle visuel 390/1440 px
  validés. Les 20 tests serveur sans base passent ; les 163 tests SQLite restent
  bloqués localement avant exécution par le moteur Prisma (Schema engine error).

### 2026-07-18 — Codex : bibliothèques et favoris Prisme
- **Séries et films** : grilles 3/4/5 colonnes, progression, regroupements,
  filtres, tris, tirer-pour-actualiser et états réseau conservent leurs données.
- **Favoris** : séries/films héritent des nouvelles cartes ; jeux favoris et mode
  de réorganisation adoptent Prisme sans changer ordre, rollback ni sauvegarde.
- **Responsive et accessibilité** : canevas 760 px, feuilles défilables en faible
  hauteur, cibles 44 px et statuts/contrôles annoncés.
- **Drag & drop** : contrat historique trois colonnes conservé et borné à 560 px.
- **Validation** : revue croisée sans bloquant, typecheck, diff et export Expo Web
  validés avec **41 routes statiques** ; endpoints et routes inchangés.

### 2026-07-18 — Codex : Explorer complet Prisme
- **Recherche unifiée** : séries/films, jeux et utilisateurs gardent debounce,
  consultation, suivi, imports silencieux, wishlist et abonnements optimistes.
- **Flux immersif** : cartes verticales Prisme, catégories, détails, commentaires,
  partage, à voir, terminé/vu et « pas intéressé » restent disponibles.
- **États robustes** : erreurs distinguées du vide, ancien deck conservé après un
  échec d’actualisation, pagination et tirer-pour-actualiser web/natif préservés.
- **Responsive et accessible** : canevas 760 px, cibles 44 px, onglets et états
  sélectionnés annoncés ; cache Jeux inclus après les actions du flux.
- **Validation** : revue croisée sans bloquant, typecheck, diff et export Expo Web
  validés avec **41 routes statiques** ; endpoints et routes inchangés.

### 2026-07-18 — Codex : socle partagé des fiches Prisme
- **Chargement** : le squelette séries/films/jeux devient responsive, annoncé aux
  lecteurs d’écran et cohérent dans les thèmes clairs comme sombres.
- **Confirmations** : signalement et marquage des épisodes précédents adoptent des
  feuilles Prisme, des cibles de 44 px et respectent le mouvement réduit.
- **Notes** : étoiles et demi-étoiles conservent leur calcul, avec libellé vocal
  explicite « Note x sur 5 » et identité visuelle Prisme.
- **Parité** : props, callbacks, fermeture extérieure et actions Oui/Non inchangés.
- **Validation** : revue croisée sans bloquant, typecheck mobile, diff et export
  Expo Web validés avec **41 routes statiques**.

### 2026-07-18 — Codex : synchronisation Profil après mutation jeu
- **Cache cohérent** : statut, possession, favori ou retrait d’un jeu invalident
  désormais le Profil, comme le font déjà les fiches séries et films.
- **Validation** : contrôle de diff ciblé validé ; contrat API inchangé.

### 2026-07-18 — Codex : garde-fous de parité fonctionnelle
- **Saisons spéciales** : les actions « tout vu / tout non vu » transmettent
  explicitement `seasonNumber: 0` au lieu de cibler les saisons régulières.
- **Signalements fiables** : œuvres et commentaires n’affichent plus un faux
  succès après une panne ; l’erreur est visible et l’action peut être retentée.
- **Notifications de jeux** : leur métadonnée conserve désormais `mediaType: game`,
  ce qui ouvre `/game/:id` au lieu d’une fiche série erronée.
- **Authentification** : l’inscription exige 8 caractères côté client comme le
  serveur, avec aide et message de validation cohérents.
- **Validation** : 5 tests ciblés, typechecks mobile/serveur et diff validés.

### 2026-07-18 — Codex : export de sauvegarde réparé
- **Contrat API** : le client utilise désormais le `POST /api/backup/export`
  réellement exposé par le serveur, au lieu du `GET` qui produisait une 404.
- **Web et natif** : téléchargement `plottime-sauvegarde.json` sur le web et
  ouverture du partage système sur iOS/Android avec le contenu JSON.
- **Retour utilisateur** : double déclenchement bloqué, attente affichée et erreur
  réseau explicite au lieu d’un échec silencieux.
- **Validation** : typecheck mobile et contrôle de diff validés.

### 2026-07-18 — Codex : profil personnel Prisme
- **Identité et progression** : couverture, avatar, niveau, édition, notifications
  et réglages adoptent une composition Prisme originale et responsive.
- **Parité fonctionnelle** : compteurs sociaux, statistiques, trophées, listes,
  collections et favoris des séries, films et jeux gardent données et destinations.
- **Interactions accessibles** : pagination des listes synchronisée, cibles d’au
  moins 44 px et libellés vocaux enrichis pour notifications et affiches.
- **Validation** : typecheck mobile, contrôle de diff et export Expo Web validés
  avec **41 routes statiques** ; aucun endpoint, modèle ou contrat modifié.

### 2026-07-18 — Codex : onboarding et authentification Prisme
- **Accueil authentification** : l’écran `/setup` adopte la marque Prisme, une
  hiérarchie plus claire et une carte centrale adaptée du petit mobile au desktop.
- **Parité fonctionnelle** : choix du serveur en développement, contrôle de santé,
  connexion, inscription et SSO web/natif conditionnel restent inchangés.
- **Responsive et accessibilité** : cibles tactiles, états occupés, alertes,
  contrastes et bouton Google suivent la largeur réellement disponible.
- **Validation** : typecheck mobile, contrôle de diff et export Expo Web validés
  avec **41 routes statiques** ; aucun endpoint, modèle ou contrat modifié.

### 2026-07-18 — Codex : Agenda et aperçu Films Prisme
- **Agenda** : cartes chronologiques, miniatures de repli et événements passés
  adoptent la hiérarchie Prisme sans masquer les informations déjà diffusées.
- **Parité temporelle** : le défilement initial vers aujourd’hui, l’accès aux
  groupes passés, les horaires, chaînes, premières et épisodes multiples restent
  inchangés, comme l’ouverture de la fiche série.
- **Films** : l’aperçu historique conserve les deux jeux de données `/api/movies`
  et l’ouverture de la fiche film, avec filtres segmentés et vrais compteurs.
- **Responsive** : la grille Films passe automatiquement de 3 à 5 colonnes entre
  mobile et desktop dans la largeur de contenu contrôlée.
- **Accessibilité** : cartes Agenda nommées, retours d’appui visibles et filtres
  exposés comme onglets sélectionnés.
- **Validation** : typecheck mobile, contrôle de diff et export Expo Web validés
  avec **41 routes statiques** ; aucun endpoint, modèle ou contrat modifié.

### 2026-07-18 — Codex : cartes d’épisodes et états partagés Prisme
- **File de visionnage** : les cartes d’épisodes adoptent la hiérarchie Prisme,
  une miniature de repli, un état vu lisible et des libellés accessibles sans
  modifier l’ouverture de la série, de l’épisode ni la mutation vu/non-vu.
- **Interactions imbriquées** : les actions titre et coche arrêtent explicitement
  la propagation vers la carte ; la cible de la coche reste d’au moins 44 px.
- **États transverses** : chargement, vide, erreur récupérable, badges et repères
  de section utilisent désormais les tokens partagés et restent responsifs
  jusqu’à la largeur desktop.
- **Animation** : le retour visuel conserve le mode de réduction des mouvements
  et n’ajoute aucun abonnement par carte.
- **Validation** : typecheck mobile, contrôle de diff et export Expo Web validés
  avec **41 routes statiques** ; aucun endpoint, modèle ou contrat modifié.

### 2026-07-18 — Codex : navigation Prisme, Agenda et Bibliothèque
- **Navigation cible** : la barre principale expose désormais Accueil, Agenda,
  Explorer, Bibliothèque et Profil dans un shell flottant Prisme avec cibles
  tactiles de 48 px et animation compatible avec la réduction des mouvements.
- **Parité des routes** : les anciennes routes Films et Jeux restent enregistrées
  et accessibles par lien profond ; elles sont seulement masquées de la barre.
- **Accueil et Agenda** : la file À voir conserve historique, mutations
  optimistes et fiche épisode ; l'ancien onglet À venir devient un écran Agenda
  sans dupliquer son appel API ni ses comportements de défilement.
- **Bibliothèque** : nouveau hub vers Séries, Films, Jeux et leurs Favoris. Les
  seuls compteurs affichés sont les totaux fiables du profil ; les aperçus
  limités à 12 ne sont pas présentés comme des totaux.
- **Validation** : typecheck mobile et contrôle de diff validés ; aucun endpoint,
  modèle Prisma ou contrat d'authentification modifié.

### 2026-07-17 — Codex : socle visuel et accessibilité Prisme
- **Identité** : palette claire Prisme violet/rose/jaune, rôles sémantiques
  compatibles avec les quatre thèmes, espacements, rayons, ombres, tailles
  tactiles et durées de mouvement partagés.
- **Primitives** : ajout de ScreenShell, ScreenHeader, IconAction,
  SectionHeader, SegmentedFilter, PrismeCard, ProgressBar accessible et
  MediaTypeChip, sans nouvelle dépendance.
- **Accessibilité** : zoom et text scaling Web réactivés, override global
  allowFontScaling supprimé, focus clavier visible et mode couleurs forcées.
- **Performance** : l'écoute de la réduction des mouvements est mutualisée entre
  les composants au lieu de créer un abonnement par carte.
- **Parité** : aucune route, requête API, mutation ou logique métier modifiée ;
  le typecheck mobile passe.

### 2026-07-17 — Codex : audit refonte front Prisme, matrice de parité et plan de migration
- **Audit fonctionnel et technique** : cartographie d'environ **30 routes front**,
  **132 routes serveur** et **33 modèles Prisma**, avec inventaire des parcours,
  actions, stores, services, contrats API et principaux risques de régression.
- **Parité et planification** : création de
  [`docs/feature-parity-matrix.md`](feature-parity-matrix.md) et de
  [`docs/REFONTE_FRONT_PRISME.md`](REFONTE_FRONT_PRISME.md) pour piloter la
  migration écran par écran sans suppression de fonctionnalité.
- **Prototype recadré** : Prisme devient la direction visuelle de référence,
  enrichie de la densité Studio pour les longues listes ; le prototype reste une
  source esthétique partielle et ne remplace ni le comportement du dépôt ni les
  écrans absents à concevoir.
- **Baseline de vérification** : typecheck mobile validé et **158 tests purs**
  verts avant migration.
- **Environnement Windows** : la suite serveur globale échoue au démarrage du
  moteur de schéma Prisma avant les suites de migration ; ce point d'outillage
  est identifié séparément de l'audit et de la future migration visuelle.

### 2026-07-17 — Claude : auth NATIVE builds stores — Apple / Google / Discord (STORES.md A1)
- **Serveur — Sign in with Apple (`modules/auth/routes.ts`)** : `POST
  /api/auth/oauth` (et `/link`) accepte `provider: 'apple'` avec l'identityToken
  JWT d'Apple. Vérification **sans nouvelle dépendance** : JWKS
  `https://appleid.apple.com/auth/keys` (fetch, cache mémoire 24 h, re-fetch si
  `kid` inconnu → rotation), signature RS256 via `node:crypto`
  (`createPublicKey` JWK + `verify`), claims `iss`/`exp`/`aud ===
  APPLE_BUNDLE_ID`. Champ optionnel `displayName` dans `/oauth` (Apple n'envoie
  le nom qu'au client, premier login) — utilisé uniquement à la création.
- **Serveur — env + `/providers`** : nouvelles vars `APPLE_BUNDLE_ID` (défaut
  `com.plottime.app`, vider = désactivé), `GOOGLE_IOS_CLIENT_ID`,
  `GOOGLE_ANDROID_CLIENT_ID` (défaut vide). `GET /api/auth/providers` expose
  `apple: true/false`, `googleIosClientId`, `googleAndroidClientId`.
- **Mobile — `lib/ssoNative.ts`** : `nativeDiscordLogin` (expo-auth-session,
  code + PKCE **sans secret**, redirect `serietime://oauth/discord`),
  `nativeAppleLogin` (expo-apple-authentication chargé dynamiquement, iOS
  seulement) ; `components/NativeSsoButtons.tsx` : bouton **Apple officiel
  noir** (guideline 4.8) + « Continuer avec Google » (expo-auth-session
  provider, idToken) + « Continuer avec Discord », chacun affiché **uniquement
  si le serveur expose sa config**. `app/setup.tsx` : sur natif, l'inscription
  bascule en « SSO uniquement » dès qu'un provider natif est dispo (sinon
  formulaire e-mail conservé — secours dev) ; le login propose e-mail + SSO.
- **Packages mobile** : `expo-auth-session`, `expo-crypto`,
  `expo-apple-authentication`, `expo-web-browser` (versions SDK 54) ;
  `app.json` : plugin `expo-apple-authentication` + `ios.usesAppleSignIn`.
- **En attente de credentials** (tout est config-gated, rien ne change tant
  que les vars ne sont pas posées) : client IDs Google iOS/Android (à créer et
  à ajouter AUSSI à `GOOGLE_CLIENT_IDS`), redirect natif à déclarer dans l'app
  Discord, `APPLE_BUNDLE_ID` à confirmer avec le compte Apple Developer.
  Détail : `docs/STORES.md` § « A1 — état d'avancement ».
- **Tests** : nouveau `apple-auth.test.ts` (9 tests : signature RSA réelle sur
  JWKS mocké, audience/émetteur/expiration/signature invalides → 401, même
  `sub` → même compte, cache JWKS, `displayName` à la création). Suite serveur :
  **178 tests verts** ; typecheck serveur + mobile OK ; `npx expo export -p web`
  OK (modules natifs importés dynamiquement, web inchangé).

### 2026-07-17 — Claude : signaler un commentaire + bloquer un utilisateur (stores A4, Apple 1.2)
- **Prisma — migration `20260717120000_report_comments_and_blocks`** :
  - `Report.commentId` (nullable, FK `Comment` onDelete Cascade) + `mediaType`
    étendu à `'comment'` — un signalement de commentaire disparaît avec lui ;
  - nouveau modèle `Block { blockerId, blockedId }` (`@@unique`, cascades User).
- **Serveur — `modules/reports/routes.ts`** : `POST /api/report` accepte
  `{ commentId, mediaType: 'comment', title: <extrait>, reason: 'abuse' }` ;
  404 si le commentaire n'existe pas, 400 si `commentId` manquant, anti-doublon
  étendu (même reporter + même commentaire encore `pending`).
- **Serveur — blocage (`modules/social/blocks.ts` + `social/routes.ts` +
  `gamification/routes.ts`)** : `POST/DELETE /api/users/:id/block` (idempotents,
  400 auto-blocage, 404 inconnu ; bloquer **désabonne dans les deux sens**) ;
  `GET /api/users/:id` expose `isBlocked` (moi → lui). Filtrage **unidirectionnel
  façon « mute » Twitter** (être bloqué ne cache rien au bloqué) via un Set
  chargé une fois par requête (pas de N+1) : fil social, commentaires + réponses
  des médias, recherche d'utilisateurs, classement hebdo.
- **Mobile** : drapeau « Signaler » sur les commentaires/réponses **des autres**
  (`components/comments/CommentCard.tsx`, `ReportModal` réutilisé avec
  titre/texte dédiés, état local « Signalé ✓ ») ; profil public
  (`app/user/[id].tsx`) : menu ⋯ en haut à droite → confirmation
  Bloquer/Débloquer (mutation optimiste `isBlocked`, invalidation
  social/gamification/commentaires, bouton SUIVRE remplacé par « DÉBLOQUER »).
- **Tests** : `reports.test.ts` +4 (signalement de commentaire) et nouveau
  `blocks.test.ts` (10 tests : filtrages, unfollow bilatéral, non-réciprocité,
  idempotence, restauration au déblocage). Suite serveur : **169 tests verts** ;
  typecheck serveur + mobile OK.

### 2026-07-17 — Claude : pages légales publiques + attributions dans l'app (stores A2/A3/A5)
- **Serveur — nouveau module `apps/server/src/modules/legal/routes.ts`** (enregistré
  dans `app.ts`, **sans** hook `requireAuth` → routes publiques) : trois pages HTML
  statiques (template string, fond blanc, 720 px max, lisibles mobile, pied de page
  « PlotTime — service indépendant, non affilié à TV Time ni à Whip Media ») :
  - `GET /legal/privacy` — politique de confidentialité RGPD complète (données
    collectées, base légale = exécution du service, durées, droits
    accès/rectification/effacement/portabilité, hébergement France/UE, aucun
    cookie tiers, pas de pub/tracking/vente de données) ;
  - `GET /legal/terms` — CGU avec section **Règles de communauté** (pas de
    haine/harcèlement/contenu sexuel, modération automatique + signalements,
    suppression de contenus/comptes en cas d'abus — exigence Apple UGC) ;
  - `GET /legal/delete-account` — marche à suivre de suppression in-app
    (Paramètres → Supprimer le compte, immédiate et définitive) — exigence
    Google Data Safety (URL web à déclarer).
- **Mobile — `mobile/app/settings.tsx`** : section « À propos » en bas de
  l'onglet APPLICATION — rangées « Politique de confidentialité » et
  « Conditions d'utilisation » (ouvrent les pages `/legal/*` : `window.open`
  sur web, `Linking.openURL` sur natif) + bloc discret « Sources de données »
  avec les trois attributions obligatoires (TMDb texte exact anglais, TheTVDB,
  IGDB).
- **Tests** : `apps/server/src/__tests__/legal.test.ts` — 3 tests (200 + HTML +
  marqueurs clés, sans token). Suite serveur : **155 tests verts** ; typecheck
  serveur et mobile OK.

### 2026-07-17 — Doc de publication stores : conformité + mode opératoire
- **`docs/STORES.md`** : audit de conformité Play Store / App Store sur le code
  réel (acquis ✅, manques priorisés 🔴🟠🟡) + mode opératoire EAS pas à pas.
- Bloquant identifié : **l'auth native n'existe pas** (SSO web-only + inscription
  e-mail fermée en prod → un build store ne permettrait aucune création de
  compte). Sign in with Apple obligatoire (guideline 4.8). Autres manques :
  politique de confidentialité/CGU, attributions TMDb/TVDB/IGDB, signalement de
  commentaires + blocage d'utilisateurs (UGC), lien web de suppression (Google),
  décision package name (`com.serietime.app` → définitif au 1er upload Play).

### 2026-07-17 — Claude : thème Nuit dynamisé (jaune nav) + recherche à jour en temps réel
- **Thème Nuit moins monochrome (suite)** : en plus des pastilles/notifs/« +N »
  roses déjà en place, la **navigation active passe au JAUNE du logo**
  (`#FBAE00`) — icône + libellé de l'onglet actif dans la barre du bas, et
  soulignement de l'onglet haut actif (À VOIR/À VENIR, fiche). Nouveau rôle
  `navActive` dans les palettes (noir en Clair — fidélité TV Time intacte —,
  texte fort en Sombre/Sunset, jaune en Nuit).
- **Recherche à jour en temps réel** (bug UX signalé par Étienne) : ajouter ou
  cocher « vu » un film/série/jeu depuis sa fiche ne se reflétait pas dans les
  résultats de recherche au retour (le « + » restait). Le `refresh()` des
  fiches invalide désormais `['search']` (séries/films) et
  `['games','search']` (jeux) : l'écran Explorer étant encore monté derrière,
  le refetch part immédiatement et le retour est déjà à jour, sans spinner.
  Le flux Découvrir n'est PAS invalidé (règle produit : pas de re-mélange en
  pleine navigation). Vérifié E2E au navigateur (refetch observé, coche visible
  au retour).
### 2026-07-17 — Claude : thème Sombre — TOUT le jaune unifié sur le jaune du logo
- Suite de la demande pastilles : plusieurs jaunes cohabitaient en Sombre
  (pastilles #FBAE00 vs FILTRES/œil/barres #FFD400). Le rôle `yellow` de la
  palette SOMBRE passe au jaune du logo `#FBAE00` (FILTRES, œil, FAB, onglet
  actif, coches, tirer-pour-actualiser… suivent automatiquement), ainsi que
  la barre de progression « En cours » (`STATUS_BAR.watching` par thème) et
  les pistes jaunes pâles codées en dur (nouvel export `YELLOW_TRACK`).
  Clair/Sunset/Nuit inchangés — relevé au pixel (Sombre : œil, pastille et
  barre à rgb(251,174,0) ; Clair : #FFD400 intact).

### 2026-07-17 — Claude : thème Sombre — pastilles de section en jaune du logo
- Dans le thème SOMBRE uniquement : les pastilles « En cours », « À voir »,
  « Pas regardé depuis un moment », « Voulus »… passent au jaune du logo
  `#FBAE00` (texte foncé). Nuit garde son rose, Clair/Sunset leurs gris —
  vérifié au pixel dans les trois thèmes.

### 2026-07-17 — Claude : icône maskable aérée, fiches fluides, flash Séries (correctif racine)
- **Icône PWA (écran d'accueil)** : le motif était encore trop serré — les
  maskable sont recomposées avec le motif à 53 % du canevas, soit ~66 %
  AFFICHÉS après le rognage Android (zone sûre 80 %) : mêmes proportions que
  l'icône du multitâche (motif 66 %), fond bleu nuit bien visible. Recréer le
  raccourci après redéploiement.
- **Fiches série/film : défilement fluide.** La bannière repliable était DANS
  le flux : chaque frame de repli (hauteur animée, non nativisable) re-layoutait
  TOUTE la fiche — saccades au scroll sur la web app. L'en-tête (bannière +
  onglets) passe en SURIMPRESSION (hors flux : son animation ne re-layoute que
  lui) et le contenu défile dessous avec un padding haut constant. Géométrie
  identique au pixel : la plage de repli = HERO_MAX − HERO_MIN, le bord bas de
  l'en-tête suit exactement le contenu (vérifié à mi-repli, aucun trou).
- **Onglet Séries : flash de l'historique — correctif racine.** Le premier
  correctif (masque + garde-fou 700 ms) fuyait en prod : l'historique peut
  arriver du réseau APRÈS le démasquage → flash. Désormais, sur le web, le
  calage du scroll est posé dans un `useLayoutEffect` (après l'insertion DOM,
  AVANT la peinture du navigateur) : aucune frame ne peut montrer l'historique,
  quel que soit le moment où il arrive ; pendant son chargement, la file
  « À voir » reste visible (plus d'écran masqué). Natif : onLayout + masque
  (garde-fou 2,5 s). Même correctif sur « À VENIR ».
- Banc Playwright 7/7 : sonde d'échantillonnage sans flash au chargement
  normal ET avec l'historique retardé de 1,5 s (le cas prod), fiche dépliée/
  mi-repliée/repliée aux bonnes cotes, onglets et fiche film fonctionnels.

### 2026-07-17 — Claude : renommage PlotTime + icône PWA « maskable »
- **L'application s'appelle désormais PlotTime** (ex-SerieTime). Renommé
  partout où le nom est visible : titre et meta de la web app (`+html.tsx`),
  manifest PWA (`name`/`short_name`), `app.json` (`name`), écran de
  connexion, Paramètres (export, comptes liés, libellé du thème Nuit),
  messages de partage (fiches, épisodes, favoris, commentaires), message de
  modération, docs (README, ONBOARDING, ce fichier). Compatibilité conservée :
  le client accepte `app: SerieTime` OU `PlotTime` au `/health` (serveur pas
  encore redéployé) et l'import de sauvegardes accepte les anciens exports ;
  `APP_NAME` par défaut passe à PlotTime (⚠ si le `.env` du VPS force
  `APP_NAME=SerieTime`, le mettre à jour). NON renommés (identifiants
  techniques, cassants) : slug/scheme Expo, `com.serietime.app`, clés
  localStorage `serietime-*`, nom du repo GitHub, domaine
  serietime.studio-vives.fr (infra Benjamin).
- **Icône zoomée sur l'écran d'accueil Android (PWA)** : le manifest servait
  la même image bord-à-bord en `purpose: any` ET `maskable` — le lanceur
  rogne l'icône maskable à sa zone sûre (~80 %), d'où l'effet « zoomé » sans
  le fond bleu (le multitâche, lui, affiche l'icône `any`, correcte).
  Nouvelles `public/maskable-192/512.png` composées depuis les assets
  adaptive (fond bleu plein + motif avec marges, motif mesuré à 21-78 % du
  canevas) ; le manifest pointe `maskable` dessus. L'icône d'accueil se met
  à jour à la re-création du raccourci / mise à jour du WebAPK.
- Correctif au passage : `auth-signup-disabled.test.ts` (main) ne définissait
  pas `DATABASE_URL` et ne passait que sur les machines avec `.env` local →
  aligné sur le motif des autres tests (SQLite temporaire + migrate deploy).
  **152 tests serveur verts** post-merge.

### 2026-07-16 — Claude (10)
- **Rose du logo en accent secondaire du THÈME NUIT — uniquement** (demande
  produit : casser le monochrome du sombre avec le rose + le jaune du logo ;
  les thèmes Clair et Sunset ne devaient PAS bouger — corrigé après une
  première passe trop large). Rôles par thème `pillBg`/`pillFg`/`notif`/
  `plusCount` : Nuit = rose `#FF4D97`, Clair/Sunset = valeurs TV Time
  d'origine (pastilles grises/taupe, points rouges, compteurs gris).
- En Nuit : **pastilles de section roses** (onglet Séries, bibliothèques,
  Jeux, pastille flottante), **points de notification roses** (Explorer,
  cloche du profil), **compteurs « +N » roses** sur les cartes À voir. Le
  jaune de marque reste le premier accent (FILTRES, FAB, onglet actif,
  barres En cours).
- Vérifié au banc dans les trois thèmes (captures + relevé au pixel) :
  Clair/Sunset strictement identiques à avant, rose en Nuit seulement.

### 2026-07-17 — Jeux : « Je possède » (interrupteur) + fiche jeu réorganisée (retours Étienne)
Deux retours d'Étienne sur les jeux, liés :
- **« Possédé » n'est plus un statut exclusif** (le modèle d'hier était faux :
  on peut être « En cours » ET posséder le jeu, ou jouer via Game Pass sans le
  posséder) → **booléen `isOwned` indépendant** sur `UserMediaStatus`
  (migration `20260716215631_game_owned_flag`, défaut `false` ; aucune donnée
  à migrer — 0 ligne `status='owned'` en prod).
  - `POST /api/games/:id/owned` body `{ owned: boolean }` : upsert — si la
    ligne existe, ne touche que `isOwned` ; sinon création avec
    `status: 'wishlist'` (fallback documenté : un jeu possédé sans autre
    interaction doit exister quelque part, wishlist est le moins faux). Pas de
    `scheduleRecompute` (posséder ne donne aucun XP ; `gamesCompleted` reste
    basé sur `status='completed'` uniquement).
  - `GET /api/games` : groupes par statut wishlist/playing/completed/abandoned
    + groupe `owned` = TOUTES les lignes `isOwned` (vue « collection », peut
    recouper les autres groupes). Même forme de réponse — l'onglet Jeux
    (section POSSÉDÉS) fonctionne sans changement.
  - `serializeGame` + fiche `GET /api/games/:id` exposent `isOwned`.
  - Fiche mobile : chips réduits à Voulu/En cours/Terminé/Abandonné +
    **interrupteur « Je possède »** (icône `archive`, toggle animé répliqué du
    ToggleRow des Paramètres — non exporté) avec mise à jour optimiste.
  - Tests serveur (`games.test.ts`) : recoupement playing+owned, fallback
    wishlist, `owned` rejeté par `POST /status` (152 tests verts).
- **Haut de la fiche jeu réorganisé** (`mobile/app/game/[id].tsx`) — « trop
  vide à côté de la jaquette », « chiant de scroller pour cocher le statut » :
  1. à côté de la jaquette : infos compactes Genre / Sortie le / Note presse ;
  2. chips de statut + « Je possède » remontés juste sous la jaquette/titre ;
  3. bande-annonce en dessous ;
  4. fiche d'identité ensuite : « Plateformes : » (libellé ajouté devant la
     liste brute), Développeur, Éditeur, « Modes : » (ex-section
     « Informations », fusionnée puis supprimée) et « Temps de jeu : » ;
  5. reste inchangé (résumé, éditions/extensions, commentaires).

### 2026-07-16 — Popup de migration douce vers le SSO
Objectif : inciter en douceur les comptes e-mail existants à se lier à un
fournisseur SSO (Google/Discord) pour pouvoir récupérer leur compte, sans
bloquer personne.
- **`mobile/components/LinkAccountPrompt.tsx`** (nouveau) : modal centré style
  TV Time (overlay `COLORS.overlay`, carte `COLORS.white` arrondie), titre
  « Sécurise ton compte », texte explicatif, bouton principal jaune « Lier mon
  compte » (→ `router.push('/linked-accounts')`) et bouton discret « Plus
  tard ». `useQuery(['auth','me'])` sur `GET /api/auth/me` (staleTime 5 min).
  Condition d'affichage exacte : `ssoWebAvailable()` **et** la requête a
  répondu **et** `!linkedProviders?.google && !linkedProviders?.discord`
  **et** pas encore rejetée cette session (état local, non persisté — la
  popup revient au prochain lancement). Les deux boutons ont
  `accessibilityRole="button"` + `accessibilityLabel`.
- **Montage** : `<LinkAccountPrompt />` dans `mobile/app/(tabs)/_layout.tsx`
  (à côté des `<Tabs>`, dans un fragment) — jamais dans le root `_layout.tsx`,
  qui affiche aussi l'écran de connexion. Les tabs ne rendent qu'une fois
  connecté, ce qui garantit un utilisateur authentifié.
- SSO étant web-only (`ssoWebAvailable()`), la popup ne s'affiche jamais côté
  natif (la requête est même désactivée sur natif via `enabled`).
- `cd mobile && npm run typecheck` → 0 erreur.

### 2026-07-16 — Statut jeu « Possédé », libellé « Voulu », signalement d'œuvre
Trois évolutions demandées par Étienne.
- **Statut « Possédé » (collectionneurs)** : nouveau statut de jeu `owned`
  (« Possédé ») ajouté à `GAME_STATUSES` côté serveur (`modules/games/routes.ts`)
  et mobile (`app/game/[id].tsx`, `app/(tabs)/games.tsx` — section POSSÉDÉS entre
  VOULUS et EN COURS). C'est une string libre : pas de migration. `completedAt`
  reste posé UNIQUEMENT pour `completed`, et la gamification (`gamesCompleted`) ne
  compte que `completed` → un jeu possédé non terminé ne donne aucun XP de fin.
- **Libellé « Voulu » (singulier)** sur la fiche jeu : `STATUS_LABELS.wishlist`
  passe de « Voulus » à « Voulu » (le chip désigne CE jeu). Le titre de section
  « VOULUS » de l'onglet Jeux reste au pluriel (collection).
- **Signalement d'œuvre** : modèle Prisma `Report`
  (`reporterId`/`mediaId?`/`mediaType`/`tmdbId?`/`igdbId?`/`title`/`reason`/`note?`/`status`,
  migration `reports`, indices `[status, createdAt]` et `[reporterId]`) +
  module `modules/reports/routes.ts` (`POST /api/report`, zod, `reason` défaut
  `'adult'`, anti-doublon : même user + même œuvre + status pending ⇒ pas de
  2e ligne, 200 quand même). Action « Signaler » (icône `flag`) ajoutée au menu ⋯
  des fiches série/film et jeu, ouvrant un `ReportModal` de confirmation partagé
  (`components/ReportModal.tsx`) ; sur confirmation, `POST /api/report` puis toast
  « Merci, signalement envoyé 👍 » (erreur silencieuse). Stockage seul, tri
  manuel ultérieur (pas d'écran admin). Tests : `apps/server/src/__tests__/reports.test.ts`.
### 2026-07-16 — Nouvelle identité : icône/logo SerieTime partout + thème « Nuit »
- **Pack d'icônes intégré** (`mobile/assets/branding/`, source : pack fourni par
  Étienne) : icône universelle iOS/générale 1024, icône adaptative Android
  (calques avant + monochrome, fond `#0B075A`), icône Google Play, favicon web,
  icônes PWA 192/512 + apple-touch-icon (remplacées dans `public/`).
- **Écrans de démarrage au nouveau logo** : splash natif (`app.json` : logo sur
  fond bleu nuit `#0B075A`), écran de lancement PWA (`manifest.json`
  `background_color`), écran de chargement des polices (`_layout.tsx` : logo sur
  bleu nuit à la place du spinner blanc) et **logo sur l'écran de connexion**
  (`setup.tsx`). Anciens `assets/icon.png`/`adaptive-icon.png` supprimés.
- **4ᵉ thème « Nuit — les couleurs SerieTime »** (`midnight`) : fond bleu nuit
  du logo `#0B075A`, cartes indigo `#160F73`, accent **jaune `#FBAE00`** (texte
  bleu nuit posé dessus, comme l'icône), liens **violet `#B39DFF`**, favoris et
  alertes **rose `#FF4D9E`**, bouton « où regarder » violet logo. Ajouté à
  `theme.ts` (+ `IS_DARK` inclut `midnight`), à la pré-peinture `+html.tsx`
  (barres système avant premier rendu) et aux Paramètres. Vérifié au
  navigateur : file À voir, fiche série, Paramètres, connexion — 286 tests verts.

### 2026-07-16 — Profil public enrichi : niveau, trophées, streak et favoris
Le profil public d'un utilisateur (`/user/[id]`) ne montrait que 3 compteurs et
une rangée de séries récentes. Il expose désormais la **gamification** (niveau,
titre, streak, badges débloqués) et les **goûts** (favoris séries/films/jeux),
pour valoriser la réputation et coller à ce qu'on voit sur son propre profil.
- **Serveur (`GET /api/users/:id`, `modules/social/routes.ts`)** : réutilise
  `meView(id)` (lecture pure, aucune écriture/notification) via un helper
  `publicGamification(id)` qui renvoie un sous-ensemble PUBLIC
  `{ level, levelTitle, xp, nextLevelXp, currentStreak, bestStreak, badges }` où
  `badges` = **uniquement les paliers débloqués** (`tier > 0`), triés par palier
  décroissant puis déblocage récent, chacun `{ id, label, icon, tier, tierCount }`
  (les **défis restent privés**, jamais exposés). Ajout des `favoriteShows`/
  `favoriteMovies`/`favoriteGames` (12 max, `isFavorite`, `serializeMedia`, langue
  du visiteur) et du `gamesCount` aux stats. `meView` + les favoris sont en
  `Promise.all` avec les requêtes existantes (pas de N+1).
- **Confidentialité** : la **gamification reste visible même en `restricted`**
  (niveau + trophées = réputation), tandis que stats détaillées, séries récentes
  et favoris restent masqués (`favoriteShows: []`, etc.).
- **Mobile (`mobile/app/user/[id].tsx`)** : pastille de niveau jaune sur l'avatar
  + titre (« Niveau 52 · Sérievore ») et petite ligne streak (« 🔥 12 jours »)
  sous le nom ; section **Trophées** (rangée horizontale de pastilles colorées par
  palier via `TIER_COLORS`, icône Feather avec fallback `award`, label), visible
  même sur un profil privé ; compteur **Jeux** ajouté (Séries/Films/Épisodes/Jeux) ;
  sections **Séries/Films/Jeux préférés** en rangées d'affiches (tap → `/show/:id`,
  `/show/:id?type=movie`, `/game/:id`), masquées si vides ; rangée « séries
  récentes » conservée.
- **Tests** : nouveau cas serveur dans `social.test.ts` (profil public expose
  `gamification.level` + `favoriteMovies`, `challenges` absent ; profil privé
  non-suivi masque les favoris mais garde la gamification). `pnpm --filter
  @serietime/server typecheck` + `test` verts (143 serveur), `mobile` typecheck 0 erreur.

### 2026-07-16 — Interrupteur « contenu 18+ » par utilisateur + détection hentai renforcée
Ajout d'un réglage **par compte** pour afficher (ou non) le contenu
pornographique/hentai dans les suggestions, et durcissement de la détection du
hentai qui échappait encore aux filtres.
- **Réglage `allowAdultContent`** (défaut **false**) : ajouté au schéma zod fermé
  et aux `DEFAULTS` de `apps/server/src/modules/settings/routes.ts` (stockage
  `UserSetting` par utilisateur). Helper de lecture caché
  `apps/server/src/modules/settings/adultContent.ts` (`allowsAdultContent` /
  `invalidateAdultContent`, TTL 60 s), calqué sur `media/userLang.ts` ;
  invalidé au `POST /api/settings`.
- **`true` = débrayage total** pour ce compte : `include_adult=true` transmis à
  TMDb, plus aucun `without_keywords`, ni `containsAdultContent`, ni exclusion
  IGDB thème 42, ni vérification de mots-clés. Surfaces : `/api/explore/feed`,
  `/api/explore/discover`, `/api/search`, `/api/explore/games` (+
  `/api/games/search`, `/api/games/discover`). La **bibliothèque n'est jamais
  filtrée**.
- **Isolation de cache** : `include_adult` est surchargeable **par appel** et
  fait partie de la **clé `ApiCache`** (via les `URLSearchParams` de
  `cachedFetch`) ; côté IGDB la clause thème 42 est dans le corps Apicalypse
  (= clé). Un compte 18+ n'empoisonne donc jamais le cache d'un compte standard
  (testé).
- **Correction du sur-blocage `getAdultKeywordIds()`** : on ne retenait que le
  premier résultat flou de `/search/keyword` — « hentai » ramenait aussi
  *sentai/senpai/mental*, « porno » ramenait *porco* (Porco Rosso), tous exclus
  en silence des animés légitimes. Désormais **correspondance de nom EXACT**
  (casse/espaces normalisés) contre une liste curée
  (`hentai, pornography, pornographic, pornographic video, pornographic
  animation, porn, porno, softcore, hardcore porn, sex film, erotic movie,
  eroge`).
- **Détection réelle du hentai** (compte standard) : (a) le mot-clé EXACT
  `erotic` est ajouté au `without_keywords` des **seuls viviers animés**
  (`genres:[16]`/`language:'ja'`, option `excludeErotic` de `tmdbDiscover`) — pas
  des requêtes grand public (thrillers érotiques préservés) ; (b) nouvelle
  fonction `tmdbKeywordNames(type, tmdbId)` (`/tv|movie/{id}/keywords`, cachée
  30 j) appliquée aux items d'**animation de la sélection finale** de
  `/api/explore/feed` et `/api/search`, en `Promise.all` : exclusion si un
  mot-clé ∈ `{hentai, erotic, pornographic animation/video, pornography, porno,
  erotic movie, softcore, hardcore}`. Vérifié : *Jimihen* (TMDb 113360, taggé
  `erotic`) est exclu.
- **Mobile** (`mobile/app/settings.tsx`) : nouvelle rangée « Contenu 18+ »
  (section **Suggestions**) réutilisant le `ToggleRow` animé existant (enrichi
  d'`accessibilityRole="switch"` + label + `checked`) ; bascule optimiste sur
  `/api/settings`, puis `invalidateQueries(['explore'])`.
- **Tests** (`apps/server/src/__tests__/adult-toggle.test.ts`, 4) :
  `getAdultKeywordIds` nom exact (sentai/senpai/porco exclus) ; défaut = hentai
  `erotic` + porno exclus, animé sain conservé ; `allowAdultContent=true` =
  hentai/porno visibles + `include_adult=true` transmis ; isolation de cache
  entre deux comptes opposés. **285 tests verts** (143 core + 142 serveur),
  `typecheck` serveur et mobile OK.

### 2026-07-16 — Détection pornographie renforcée + popup drôle au commentaire bloqué
Durcissement anti-porno pour ne **rien** laisser passer de pornographique
(hentai, porno, softcore, X, eroge) sur séries/films/animés **et** jeux, **sans**
bloquer la violence (un contenu 18+ pour gore/meurtre/langage reste autorisé) :
on cible les **signaux de pornographie**, pas le classement d'âge.
- **Module pur** `packages/core/src/moderation/adultContent.ts` (exporté depuis
  `@serietime/core`) : `containsAdultContent(text, ...more)` normalise (réutilise
  `normalizeForModeration` : minuscules, accents, leetspeak, répétitions,
  séparateurs) puis cherche des marqueurs **sans ambiguïté**. `ADULT_MARKERS`
  (exportée, extensible, commentée) couvre fr/en/es/de/it/pt + japonais romanisé
  (hentai/eroge/nukige/ahegao/bukkake/futanari/jav…). Deux modes : sous-chaîne
  pour les racines non ambiguës (« porn » couvre porno/pornographic/pornographie/
  pornografia/pornografico/pornostar…), frontière de mot pour les courts/ambigus
  (`xxx`, `jav`, `milf` → évite « MaXXXine », « milfoil », « Java »). **Exclus**
  volontairement : `erotic`/`erotique`, `ecchi`, `sexy`, `nude`, `sex` seuls
  (« Sex Education », « Basic Instinct », « Nymphomaniac » restent grand public).
- **TMDb** : `getAdultKeywordIds()` récupère dynamiquement les ids de mots-clés
  porno via `GET /search/keyword?query=…` (termes : hentai, pornographic,
  pornography, porno, erotic movie), doublement cachés (ApiCache 30 j + mémoire
  process), passés en `without_keywords` sur **toutes** les requêtes
  `tmdbDiscover`. Post-filtre `containsAdultContent(titre/résumé)` (en plus de
  `adult === true`) partout où des résultats TMDb deviennent des cartes de flux
  ou de recherche : `/api/search`, les 3 boucles du flux Explorer (recos + pools),
  `/api/explore/discover`.
- **IGDB** : `isSafeGame` exclut désormais aussi `containsAdultContent(name,
  summary)` (visual novels/eroge explicites sans thème 42) — thème « Erotic »
  (id 42) conservé, `summary`/`name` déjà dans les `FIELDS`.
- **Popup drôle au commentaire bloqué.** Serveur (`social/routes.ts`) : message
  `comment_blocked` remplacé par un texte léger et complice (« Hop hop hop ! 🙅 La
  politesse est de mise sur SerieTime, chenapan… 😇 »). Mobile : nouveau composant
  `mobile/components/comments/BlockedCommentPopup.tsx` (petit modal centré,
  overlay semi-transparent, bouton « OK compris » avec `accessibilityLabel`, thème
  COLORS/FONTS) remplace le message inline sous la saisie, branché sur `postError`
  du hook partagé `useComments` → couvre les **deux** points d'envoi (composeur du
  `CommentsSheet` TikTok **et** écran plein écran `app/comments/[id]`).
- **Tests** : +44 core (blocage porno multilingue + contournements ; batterie
  non-régression 0 faux positif : Sex Education, Basic Instinct, Nymphomaniac,
  Game of Thrones/The Boys/horreur gore, ecchi, MaXXXine/milfoil/Java) et +2
  serveur (item TMDb `adult:false` au titre « Hentai » exclu, jeu IGDB sans
  thème 42 au nom/résumé porno exclu, **item violent conservé**). Core 143,
  serveur 138, `typecheck` serveur + mobile OK.
- **Limites connues** : collision « xXx » (film Vin Diesel 2002) — le token isolé
  `xxx` est un signal porno trop fort pour être relâché, tradeoff assumé
  (« MaXXXine » 2024 est, elle, épargnée par la frontière de mot). `tmdbTrending`
  et `tmdbRecommendations` ne supportent pas `without_keywords` → couverts par le
  seul post-filtre.

### 2026-07-16 — Modération en deux volets (commentaires haineux + contenu adulte)
Deux garde-fous de communauté, sans changement visuel hors le message d'erreur.
- **Volet A — Commentaires (haine/insultes graves, multilingue).** Nouveau
  module PUR `packages/core/src/moderation/` :
  - `blocklist.ts` : liste **curée** de slurs/injures haineuses, organisée par
    catégorie (`racism`, `antisemitism`, `homophobia`, `sexism`, `sexual_slur`,
    `violent_slur`) et couvrant fr/en/es/de/it/pt. Volontairement **sans termes
    ambigus** (exclus : « negro » = couleur ES/PT/IT, « chink » idiome EN, « fag »
    = cigarette UK, « viado » ≈ « enviado » PT, « retard » = en retard FR…).
    Extensible.
  - `filter.ts` : `normalizeForModeration` (minuscules, accents NFD, leetspeak
    `0→o 1→i 3→e 4→a 5→s 7→t @→a $→s`, répétitions réduites, séparateurs → espace)
    + `findBlockedTerm` (frontière de mot pour termes < 5 lettres → évite
    « Scunthorpe »/« assassin » ; sous-chaîne pour slurs longs ; patterns
    tolérants aux répétitions).
  - Serveur : `POST /api/media/:id/comments` (commentaires **et** réponses, même
    route) rejette en `400 { error: 'comment_blocked', message }` avant création ;
    seule la **catégorie** est journalisée, jamais le texte.
  - Mobile : `useComments` remonte le message de modération (`postError`) ;
    `CommentsSheet` et `app/comments/[id]` l'affichent sous la barre de saisie ;
    `ApiError.serverMessage` expose le `message` serveur.
- **Volet B — Suggestions (porno/hentai/contenu sexuel).**
  - TMDb : `include_adult=false` par défaut dans `cachedFetch` (toutes requêtes)
    + exclusion `adult === true` dans le mapping du flux Explorer (recommandations
    + viviers) et de la recherche (`TmdbSearchResult.adult` ajouté).
  - IGDB : exclusion du thème **« Erotic » (id 42)** ajoutée à chaque clause
    `where` (recherche/populaire/récents/genres/upcoming), `themes.id,themes.name`
    ajoutés aux `FIELDS`, garde `isSafeGame(g)` appliquée après `isMainGame`
    (le champ déprécié `category` n'est pas touché).
- **Tests** : +37 core (chaque catégorie × plusieurs langues, contournements
  leet/répétitions/séparateurs/accents, batterie de non-régression à **0 faux
  positif**) et +4 serveur (rejet commentaire/réponse, exclusion TMDb `adult`,
  exclusion IGDB thème 42). Total **235** (99 core + 136 serveur), les 194
  existants intacts ; `typecheck` serveur + mobile OK.

### 2026-07-16 — Checkup complet : sécurité, correction, perf, infra (invisible)
Lot de durcissement issu d'un audit à 4 volets, **sans changement visible** pour
l'utilisateur (mêmes réponses API, même UX).
- **Sécurité** : vérification de l'audience des jetons OAuth Facebook/Discord
  (empêche le rejeu d'un token émis pour une autre app → prise de contrôle de
  compte) ; validation d'hôte des URLs poster/bannière (whitelist TMDb/TheTVDB/
  IGDB) contre le vandalisme du catalogue partagé ; réglages passés
  **par-utilisateur** (`UserSetting`, migration des valeurs globales existantes)
  au lieu d'une ligne partagée par tous les comptes ; rate limit sur
  `/api/auth/oauth` et `/api/auth/link`.
- **Bugs** : `completedAt` posé sur les jeux terminés (le classement hebdo les
  ignorait) ; `scheduleRecompute` ajouté aux actions de masse (tout marquer vu,
  retrait de suivi) ; recompute gamification réentrant (mutex par utilisateur →
  plus de notifications en double) ; conteneur en `TZ=Europe/Paris` (fin des
  bornes « aujourd'hui » divergentes stats/file).
- **Perf** : formatter `Intl` mis en cache dans la gamification (~30 000
  créations d'objet en moins par appel de `/me` sur une grosse bibliothèque) ;
  index SQLite ajoutés (`Media.igdbId`, `UserEpisodeStatus(userId,status,
  watchedAt)`, `WatchEvent(userId,eventDate)`, `Notification(userId,date)`).
- **Infra / hygiène** : `.dockerignore` (contexte de build allégé), healthcheck
  Docker sur `/health`, code mort retiré (`services/tvmaze`, dépendance
  `csv-parse` côté serveur), `.gitignore` corrigé (chemins morts, `mobile/
  android|ios`), README aligné sur ONBOARDING. Côté VPS : rotation des backups
  (5 DB + 3 web) et purge du cache de build Docker (~18 Go récupérés).
- 11 tests d'intégration ajoutés (URL images, isolation des réglages, OAuth
  refusant un token étranger, completedAt jeux). **132 tests serveur verts**.

### 2026-07-16 — Flux Explorer varié et personnalisé (serveur)
- Problème : `GET /api/explore/feed` et `GET /api/explore/games` proposaient
  toujours les mêmes titres (aucune mémoire de ce qui avait été montré, pages
  aléatoires étroites 1..3 sur des classements quasi statiques, vivier jeux figé).
- **Prisma** : modèle `ExploreImpression` (`userId` + `itemKey` uniques,
  `servedAt`, cascade User) — migration `explore_impressions`. Clés :
  `show:tmdb:123` / `movie:tmdb:456` / `game:igdb:789`.
- **`modules/explore/impressions.ts`** : les items servis il y a moins de
  3 jours sont exclus du tirage suivant ; garde ANTI-FAMINE (si le vivier
  restant < cible — 66 cartes feed / 60 jeux — les items vus les plus anciens
  repassent d'abord, jamais de flux vide) ; enregistrement en
  `deleteMany` + `createMany` transactionnels (pas de N+1) ; purge
  fire-and-forget des lignes > 14 jours.
- **`modules/explore/taste.ts`** : profil de goût par genres (favoris ×3,
  watchlist/en cours/wishlist/playing ×2, terminés ×1, dislikés `isHidden`
  ×−2) sur `Media.genres` (CSV de noms — fr TMDb ou anglais IGDB) ; mapping
  statique nom→id des genres TMDb standards (tv + movie, variantes fr/en) et
  IGDB ; tirage pondéré sans remise (`pickWeighted`) + genre d'EXPLORATION
  hors profil.
- **Feed séries/films** : à chaque refresh, 2 genres pondérés + 1 genre
  d'exploration → viviers `tmdbDiscover` dédiés (tv + movie) ; recs tirées de
  8 graines AU HASARD parmi 30 candidats (avant : toujours les 8 mêmes) ;
  pages 1..8 pour discover/classiques/anime (1..3 conservé pour trending),
  DEUX décennies aléatoires au lieu d'une. Plafond PER_CAT et dédup inchangés.
- **Jeux** : `igdbPopular`/`igdbRecent` acceptent un `offset` Apicalypse
  aléatoire (fenêtre glissante dans les classements) + `igdbByGenres(genreIds,
  {offset})` (1-2 pools selon le profil de goût jeux). La clé `ApiCache` étant
  le corps Apicalypse exact, offsets/genres différents = entrées de cache
  différentes (le hasard n'est pas figé par le cache 24 h).
- **Tests** (`explore-taste.test.ts` unitaire + `explore-impressions.test.ts`
  intégration, fetch TMDb/Twitch/IGDB mocké) : pondérations du profil,
  mappings de genres, tirage pondéré, exclusion d'un item servi au 1er appel,
  format des clés en DB, garde anti-famine sur vivier minuscule entièrement
  vu, exclusion des jeux suivis. 121 tests serveur verts.

### 2026-07-16 — Langue de contenu par utilisateur (titres/résumés traduits)
- L'utilisateur choisit sa langue dans Paramètres > APPLICATION > « Langue »
  (Français par défaut, English, Español, Deutsch, Italiano, Português) : les
  titres (et résumés quand disponibles) des séries et films s'affichent dans
  cette langue partout. Les jeux (IGDB) gardent leur nom international.
- **Prisma** : `User.language` (défaut `fr`) + `Media.translationsJson`
  (JSON `{ en: { title, overview }, … }` — le fr reste porté par
  `localizedTitle`/`localizedOverview`) — migration
  `user_language_media_translations`.
- **Serveur** :
  - `services/tmdb` : `tmdbTranslations()` (endpoint `/translations`, cache
    7 j) + `syncTranslationsFromTmdb(media)` (une requête TMDb récupère les 5
    langues cibles en/es/de/it/pt, upsert `translationsJson`, skip silencieux
    sans tmdbId) + `backfillUserTranslations(userId, lang)` (bibliothèque
    complète en série, throttle 150 ms, un seul backfill par utilisateur).
  - `serializeMedia(media, status, lang?)` : 3e paramètre optionnel — titre et
    overview traduits si présents, fallback silencieux sinon ; helper
    `mediaTitle(media, lang)` pour les titres construits à la main
    (`showTitle` des épisodes, fil social, recherche locale).
  - `modules/media/userLang.ts` : `getUserLang(userId)` (cache mémoire 60 s) +
    `invalidateUserLang(userId)` ; langue threadée dans TOUTES les routes qui
    renvoient des médias (shows queue/upcoming/history/profile/library/:id/
    episodes, movies liste/profile/:id, profile + favoris, lists/:id, search,
    disliked, explore feed, social feed + profil public).
  - Flux Explorer / recherche TMDb / recommandations : paramètre `language`
    TMDb par langue utilisateur (cache `ApiCache` par langue).
  - Fiche (`GET /api/shows/:id`, `GET /api/movies/:id`) : traduction manquante
    récupérée à la volée (awaité — une requête cachée 7 j, même pattern que
    providers/credits).
  - `POST /api/settings { language }` : met à jour `User.language`, invalide le
    cache, lance le backfill en fond (réponse immédiate `started: true`) ;
    `GET /api/settings` et `GET /api/auth/me` exposent `language`.
- **Mobile** (`mobile/app/settings.tsx`) : section « Langue » sous « Thème »
  (mêmes `RadioRow` que le thème), sélection → POST + message « Bibliothèque en
  cours de traduction… » + invalidation GLOBALE du cache React Query (les
  titres changent partout).
- Tests : `apps/server/src/__tests__/language.test.ts` (7 tests : serializeMedia
  en/fallbacks, POST/GET settings + /me, titre traduit dans `GET /api/shows`,
  `syncTranslationsFromTmdb` avec fetch mocké, skip sans tmdbId) — 106 tests
  serveur verts, typecheck serveur + mobile OK.

### 2026-07-16 — Mot de passe oublié : réinitialisation par ré-authentification SSO (Google/Discord)
- Cas d'usage : « Modifier le mot de passe » exigeait l'ancien mot de passe —
  impossible justement quand on l'a oublié. Si un compte Google/Discord est lié,
  on prouve son identité par le SSO (même mécanique web que le login) et on pose
  un nouveau mot de passe sans l'ancien.
- **Prisma** : modèle `PasswordResetToken` (usage unique, 10 min, cascade à la
  suppression du compte) — migration `20260716120827_password_reset_tokens`.
- **Serveur** (`apps/server/src/modules/auth/routes.ts`) :
  `POST /api/auth/reset-password/init` (jeton provider Google/Discord vérifié
  côté serveur → compte identifié UNIQUEMENT par (provider, providerId), jamais
  par e-mail → jeton de reset) et `POST /api/auth/reset-password`
  (`{ resetToken, newPassword ≥ 8 }` → nouveau hash bcrypt, jeton consommé,
  autres sessions invalidées). Rate-limités comme le login. Le flux OAuth de
  login et le changement classique avec ancien mot de passe sont inchangés.
- **Mobile** (`mobile/app/settings.tsx`) : dans la modale « Modifier le mot de
  passe », lien « Mot de passe oublié ? Réinitialiser via Google ou Discord »
  (visible uniquement si un compte est lié ET configuré, web seulement comme le
  SSO existant) → ré-auth Google (bouton officiel) ou Discord (popup) →
  formulaire nouveau mot de passe + confirmation → succès.
- Tests : `apps/server/src/__tests__/password-reset.test.ts` (8 tests : flux
  complet avec login au nouveau mot de passe, jeton expiré/déjà utilisé/inconnu,
  identité SSO non liée refusée, autres champs intacts) — 99 tests serveur verts.
### 2026-07-16 — Claude (10)
- **Rose du logo en accent secondaire du THÈME NUIT — uniquement** (demande
  produit : casser le monochrome du sombre avec le rose + le jaune du logo ;
  les thèmes Clair et Sunset ne devaient PAS bouger — corrigé après une
  première passe trop large). Rôles par thème `pillBg`/`pillFg`/`notif`/
  `plusCount` : Nuit = rose `#FF4D97`, Clair/Sunset = valeurs TV Time
  d'origine (pastilles grises/taupe, points rouges, compteurs gris).
- En Nuit : **pastilles de section roses** (onglet Séries, bibliothèques,
  Jeux, pastille flottante), **points de notification roses** (Explorer,
  cloche du profil), **compteurs « +N » roses** sur les cartes À voir. Le
  jaune de marque reste le premier accent (FILTRES, FAB, onglet actif,
  barres En cours).
- Vérifié au banc dans les trois thèmes (captures + relevé au pixel) :
  Clair/Sunset strictement identiques à avant, rose en Nuit seulement.

### 2026-07-16 — Claude (9)
- **Fiches série ET film : sections à l'échelle harmonisée** (les cotes lues
  sur les captures TV Time brutes rendaient « énormes » — retour récurrent) :
  titres de section 20→16, synopsis 16/23→13,5/20, méta 17→14, pastilles
  plateformes/icônes/étoiles réduites, rangée « Vu » film 16→14 + coche 44,
  « Similaire à » 20/16→16/13,5. Le menu « … » (validé pixel-perfect) est
  inchangé. Styles partagés `AboutTab`/`MovieBody` → les deux fiches d'un coup.
- **Barre de gestes Android (liseré blanc en bas) — cause racine trouvée** :
  en PWA installée, Chrome choisit la couleur des barres système via le meta
  `theme-color` dont l'attribut `media` correspond au thème SYSTÈME du
  téléphone (supporté depuis Chrome 93, PWA uniquement) et via le
  `color-scheme` de la page — app sombre sur téléphone en clair ⇒ barre
  blanche. Correctif : TROIS metas `theme-color` (sans media + variantes
  clair/sombre) tous mis à la couleur du thème choisi par le script
  pré-peinture de `+html.tsx`, + `color-scheme` posé sur `<html>` ;
  helper `setThemeColorMeta()` (lib/theme) utilisé par le layout et les
  en-têtes sombres (Profil, profil public — les 3 metas suivent puis sont
  restaurés). Natif : rien à faire (edge-to-edge + `userInterfaceStyle`
  automatic déjà en place, la barre est transparente sur le contenu thémé).
- Vérifié au banc Playwright (12/12) : 3 metas à `#121217` et
  `color-scheme: dark` AVANT l'exécution du bundle (thème sombre forcé,
  émulation système clair — le cas exact du bug), persistance après
  chargement, bascule `#20202a` du Profil sur les 3 metas, et tailles
  16px/14px mesurées au DOM sur fiche série + fiche film.

### 2026-07-16 — Claude (8)
- **Onglet Séries : plus de flash au chargement.** L'historique de visionnage
  (rendu AU-DESSUS de « À voir », scroll calé en dessous après mesure) restait
  visible une fraction de seconde. La liste reste masquée (opacité 0) jusqu'au
  calage du scroll initial — garde-fou 700 ms pour ne jamais rester masqué.
  Même correctif sur « À VENIR » (historique des sorties passées) — seuls
  écrans à scroll initial différé de l'app.
- **Onglet Jeux : tirer-pour-actualiser façon Instagram** (le même composant
  que le Profil, web + natif) ; `PullToRefresh` relaie désormais `onScroll`
  (pastille de section flottante conservée).
- **Profil : rafraîchissement quasi instantané.** `computeStats` chargeait
  TOUTES les lignes d'épisodes vus (jointure à 3 niveaux, 20 000+ lignes sur
  une vraie bibliothèque) pour sommer des durées → agrégats SQL (`SUM CASE`,
  mêmes règles que `packages/core` : runtime épisode > 0 sinon série sinon
  40 min ; films 110 min). `/api/profile` mesuré à ~20 ms sur le banc.
- **Découverte jeux vivante** (`/api/games/discover`) :
  - « Populaires » = gros succès des **18 derniers mois** (tri par nombre de
    notes, fenêtre glissante = saisonnalité) — fini le top all-time figé
    (Zelda/Metroid éternels) ;
  - « À venir » = **jeux les plus attendus** (champ IGDB `hypes` = follows
    avant sortie, tri décroissant) — fini le shovelware trié par simple date ;
  - **échantillon aléatoire à chaque requête** (15 jeux tirés d'un vivier de
    60 mis en cache 24 h) : les carrousels changent à chaque pull-to-refresh
    sans appel IGDB supplémentaire. Corps Apicalypse stables sur la journée
    (timestamp arrondi au jour) pour rester adressables par l'ApiCache ;
    `popularQueryBody`/`upcomingQueryBody` exportés pour les bancs.
- Vérifié au banc Playwright (5/5) : échantillonnage du rendu pendant tout le
  chargement de l'onglet Séries (aucune frame fautive, scroll calé), carrousel
  Jeux alimenté puis RE-TIRÉ différemment après un geste de pull-to-refresh ;
  + 2 appels `/discover` successifs différents et stats profil exactes via
  curl. 91 tests serveur verts (les tests stats valident le SQL brut).

### 2026-07-16 — Claude (7)
- **Fenêtre épisode : tailles harmonisées** (retour récurrent « textes trop
  gros ») — code épisode 30→22, dates/méta 17→14, titres de section 20→16,
  synopsis 16/23→13,5/20, pastilles plateformes et icônes réduites, coche
  46→40. Alignée sur l'échelle des cartes de l'onglet Séries.
- **Fiche série → onglet ÉPISODES : taper une carte ouvre la fenêtre
  épisode** (la même que depuis l'onglet Séries, swipe latéral inclus) —
  dans « Continuer le suivi » comme dans « Tous les épisodes » (les épisodes
  non diffusés restent inertes, la coche garde son geste propre).
- **« Continuer le suivi » = carrousel latéral** : tous les épisodes diffusés
  non vus (dans l'ordre, la carte suivante dépasse à droite, snap façon
  TV Time) — chacun cochable ; cocher fait avancer la file (cache optimiste).
- Vérifié au banc Playwright (7/7) : 3 cartes côte à côte, glissement tactile
  effectif, ouverture de la fenêtre depuis le carrousel ET depuis une rangée
  de saison (sur le bon épisode), tailles 22px/16px mesurées au DOM.

### 2026-07-16 — Claude (6)
- **Bibliothèques du profil (Séries / Films) + onglet Jeux : pastille de
  statut FLOTTANTE** — « EN COURS », « TERMINÉ »… suit le défilement et change
  au passage des sections, comme dans l'onglet Séries (réfs TV Time). La
  mécanique est extraite dans `components/FloatingSection.tsx`
  (`useFloatingSection` + `FloatingSectionPill`) et l'onglet Séries refactoré
  dessus. Elle apparaît aussi quand un filtre de progression est actif.
- **Barres de progression colorées par STATUT** (`STATUS_BAR` dans
  `lib/theme.ts`, couleurs fixes dans tous les thèmes — codes de statut, pas
  accents) : jaune « En cours », vert « À jour », **bleu « Terminé »** (barre
  pleine — TV Time affiche du violet, choix produit : bleu), **orange
  « Regarder plus tard »**, **rouge « Arrêté »** — la barre montre où on s'est
  arrêté (épisodes vus / diffusés). Rien pour « Pas commencé ».
- La bibliothèque Séries gagne une section « Regarder plus tard » dédiée
  (avant, ces séries étaient mélangées à « Pas commencé »).
- **Fiche série : la barre de progression sous la bannière** suit les mêmes
  couleurs de statut (elle n'existait qu'en jaune/vert) — vérifié au banc
  (5/5 : couleur ET niveau de remplissage exacts pour chaque statut).
- Vérifié au banc Playwright (16/16) : 5 couleurs et largeurs de barres
  exactes (pleine / partielle / 2 épisodes sur 4), sections dans l'ordre,
  pastille flottante en défilement sur Séries + Jeux, pastille en mode filtré,
  onglet Séries sans régression après refactor. Captures comparées aux réfs.

### 2026-07-16 — Claude (5)
- **Correctif : liseré blanc en bas d'écran (barre de gestes Android) avec les
  thèmes Sombre/Sunset.** Android échantillonne la couleur des barres système
  au chargement de la page ; le `meta theme-color` n'était mis à jour qu'après
  l'exécution du bundle JS → la barre de gestes restait blanche (valeur du
  manifest). Un script « pré-peinture » dans `app/+html.tsx` lit la préférence
  (`localStorage`, ou `prefers-color-scheme` en mode système) et applique fond
  `<html>` + `theme-color` AVANT le premier rendu — supprime aussi le flash
  blanc au rechargement (changement de thème). NB : si un `bg` de palette
  change dans `lib/theme.ts`, reporter la valeur dans ce script.
- **Natif (Android/iPhone)** : `userInterfaceStyle` passé de `light` à
  `automatic` dans `app.json` — le verrou « clair » empêchait le thème sombre
  de suivre l'appareil en natif. `edgeToEdgeEnabled` étant déjà actif, le bas
  d'écran natif prend la couleur de la barre d'onglets (thémée, avec
  `paddingBottom: insets.bottom`).
- Vérifié au banc Playwright (17/17) : pour chaque thème (clair/sombre/
  sunset/système), `theme-color` et fond `<html>` corrects AVANT l'exécution
  du bundle et après chargement complet ; scénario réel « changement de thème
  → reload déjà sombre ». (L'onglet Profil garde volontairement son
  `theme-color` #20202a — en-tête sombre façon TV Time.)
- **QA post-gamification** (Benjamin a fusionné XP/badges/défis sur `main`) :
  91 tests serveur verts (après `prisma generate` — nouveaux modèles Prisma),
  typecheck mobile 0 erreur, bancs re-joués sur le code fusionné : thèmes 8/8,
  jeux éditions/extensions 8/8 (un « échec » = bascule de statut due à l'état
  résiduel du banc, pas une régression), retour 16/16, parcours QA global OK
  (3 alertes = faux positifs connus du robot), écrans Trophées/Badges/
  Classement vérifiés en clair ET en sombre (captures).

### 2026-07-16 — Claude (4)
- **Correctif : bouton « Retour » muet après un changement de thème.** Le
  changement de thème recharge la page web (nécessaire pour ré-appliquer les
  StyleSheet) ; la pile de navigation expo-router repart alors de zéro et
  `router.back()` ne faisait plus rien. Même symptôme pour tout écran ouvert
  par lien direct ou après un rechargement du navigateur.
- Nouveau helper `mobile/lib/nav.ts` → `goBack(fallback)` : `router.back()`
  si la pile contient un écran précédent (`router.canGoBack()`), sinon
  `router.replace(fallback)` avec un repli logique par écran (Paramètres,
  Notifications, Amis, bibliothèques et favoris → Profil ; fiche série/film,
  personne, commentaires → Accueil ; fiche jeu → onglet Jeux ; profil
  public → Amis ; couverture → Édition du profil).
- Balayage complet : les 17 `router.back()` de l'app (14 fichiers) passent
  par `goBack` ; plus aucun appel direct. Les nouveaux écrans gamification
  (Trophées, stats, classement) passent déjà par `PageHeader`, donc couverts.
- Vérifié au banc Playwright (15/15) : scénario exact du bug (thème sombre →
  reload → retour → Profil), navigations directes sur 9 écrans, et priorité
  conservée à l'historique réel quand la pile n'est pas vide.

### 2026-07-16 — Gamification (serveur) : XP, niveaux, badges, streaks, défis, classement
- Spec `docs/superpowers/specs/2026-07-16-gamification-design.md` — partie
  serveur (le moteur pur vit déjà dans `packages/core/src/gamification/`).
- **Prisma** : modèles `UserProgress`, `UserBadge`, `UserChallenge`
  (migration `20260716112602_gamification`, cascade à la suppression du compte).
- **`apps/server/src/modules/gamification/service.ts`** : `collectStats`
  (counts + colonnes seules, jamais de lignes complètes — bibliothèques
  20 000+ épisodes), `recomputeUser` (recompute idempotent : défis du mois →
  XP/niveau → badges → notifications `badge_unlocked` / `level_up` /
  `challenge_completed` pour les seules nouveautés, silencieux au premier
  calcul), `scheduleRecompute` (débounce 750 ms/utilisateur),
  `backfillAllUsers` (au boot du serveur).
- **Routes** : `GET /api/gamification/me` (recompute léger sans écriture :
  niveau, titre, streaks, catalogue complet des badges avec progression,
  défis du mois) et `GET /api/gamification/leaderboard` (XP hebdo depuis
  lundi 00:00 Europe/Paris, moi + comptes suivis, requêtes groupées).
- **Hooks** (`scheduleRecompute`) : épisode vu/dévu, « cocher les précédents »,
  changement de date, film vu/dévu, statut/retrait jeu, commentaire, follow ;
  recompute direct en fin de phase apply de l'import TV Time (XP rétroactif).
- **Fil social** : items `kind: 'badge'` (déblocages récents des comptes
  suivis) + `level` sur les utilisateurs du fil et du classement (batché).
- Tests : `apps/server/src/__tests__/gamification.test.ts` (6 tests
  d'intégration) — 88 tests serveur verts.

### 2026-07-16 — À venir : historique des sorties passées (HIER, AVANT-HIER…)
- `/api/shows/upcoming` remonte 14 jours en arrière : les épisodes parus mais
  NON VUS sont renvoyés dans `past` (groupes HIER / AVANT-HIER / jour de la
  semaine / date), les séries arrêtées restant exclues.
- Onglet À VENIR : l'historique est masqué au-dessus de la liste (scroll
  initial calé sur AUJOURD'HUI) et se découvre en remontant — même pattern que
  l'historique de visionnage de « À voir ». Une sortie manquée reste visible
  14 jours.
- `pastGroupLabel` ajouté à `packages/core` (testé).

### 2026-07-16 — Claude (3)
- **Recherche jeux : jeux de base uniquement** — les éditions (Deluxe,
  collector, GOTY… = `version_parent` IGDB) et extensions/DLC/updates sont
  exclues des résultats, y compris celles déjà importées en base (marquage
  `game.isDlc` à l'import + rattrapage automatique à l'ouverture de la fiche).
- **Fiche jeu : section « Éditions et extensions »** (défilement latéral façon
  app Xbox, avant Commentaires) : cartes jaquette + nom + type (Édition /
  Extension), badge coche jaune si déjà en bibliothèque. Clic → fiche
  descriptive standard (import IGDB silencieux si besoin) où l'on peut mettre
  Voulu / En cours / Terminé / Abandonné comme n'importe quel jeu. Données via
  `where parent_game = X | version_parent = X` (IGDB, cache 7 j).
- Tests : 85 verts (2 nouveaux avec cache IGDB simulé — zéro réseau) ;
  vérifié au navigateur 8/8 (recherche filtrée, section affichée avant
  Commentaires, clic extension → fiche + mise en « Voulus » confirmée serveur).

### 2026-07-16 — Claude (2)
- **Recherche Explorer : rangée d'onglets corrigée** — « SÉRIES ET FILMS » se
  repliait sur deux lignes (rangée bancale, soulignement décalé) : police 12,5
  + une seule ligne garantie, les trois onglets sont alignés.
- **Les jeux ne sortent plus dans « SÉRIES ET FILMS »** : la recherche médias
  interrogeait la base locale SANS filtre de type — les jeux IGDB importés
  (ex. Clair Obscur: Expedition 33 + ses éditions) ressortaient étiquetés
  « Film ». Filtre `type IN (show, movie)` + test de non-régression (83 tests
  serveur verts).
- **Recherche JEUX alignée sur séries/films** : bibliothèque locale d'abord
  (id local + coche « déjà ajouté »), puis IGDB dédupliqué par igdbId — un jeu
  déjà en bibliothèque s'ouvre directement (sans repasser par l'import) et
  reste trouvable même sans clé IGDB.

### 2026-07-16 — Claude
- **Paramètres** : onglet « À VENIR » supprimé (placeholder jamais développé) ;
  respiration ajoutée entre « RESYNCHRONISER MA BIBLIOTHÈQUE » et son texte
  d'aide (12 px).
- **Profil : tirer-pour-actualiser** façon Instagram (composant `PullToRefresh`
  maison, ressort + pastille, compatible web) — vérifié : le tirage relance
  bien `/api/profile`.
- **Tri des préférés respecté PARTOUT** : les sections « Séries/Films/Jeux
  préférés » du profil appliquent désormais le tri choisi sur leurs pages
  (avant : toujours l'ordre utilisateur). La page « Jeux préférés » reçoit sa
  rangée TRIER PAR + feuille de tri (comme séries/films), tri persisté.
- **Session QA complète au navigateur** (32 écrans parcourus comme un
  utilisateur : onglets, sous-onglets, fiches série/jeu, menus, favoris,
  bibliothèques, social, stats, badges, classement, notifications, profils
  publics, paramètres, import, comptes liés, édition de profil) : aucune
  erreur JS, aucune page vide, aucun bouton mort détecté. Les alertes du
  robot (« DÉCOUVRIR » manquant, page Bob vide) étaient de faux positifs —
  l'Explorer fusionné de Benjamin embarque déjà le tirer-pour-actualiser via
  sa variante `PullToRefreshView`.

### 2026-07-16 — Circuit « Arrêté » vérifié + finitions
- Audit du circuit « Arrêter de regarder » : fiche → statut `abandoned`,
  barre rouge + section Arrêté dans la bibliothèque, exclusion de « À venir »,
  groupe séparé en bas de « À voir » (parité TV Time), import TV Time
  `active=0`, statut collant au recalcul. Films : « Supprimer le film »
  (pas de statut arrêté, parité TV Time).
- Correctifs : « Arrêter de regarder » disponible aussi pour une série
  « Terminée » qui revient dans « À voir » avec une nouvelle saison (avant :
  seule option = supprimer la série et perdre l'historique) ; libellé du
  groupe de la file harmonisé « ABANDONNÉ » → « ARRÊTÉ ».

### 2026-07-16 — Finitions UX : accessibilité, squelettes de fiches, scrims dégradés
- **Accessibilité** : ~49 boutons icône-seule (rail Explorer, chevrons retour,
  ⋯, cœur, coches, X de modals, onglets…) reçoivent `accessibilityLabel`
  français + `accessibilityRole` (24 fichiers, labels dynamiques sur les
  toggles favori/vu/like). Zéro changement visuel.
- **Fiches série/jeu** : le flash blanc + spinner au chargement est remplacé
  par un écran squelette (`mobile/components/FicheSkeleton.tsx`, silhouette
  bannière + jaquette + lignes de texte, basé sur `Skeleton` d'anim.tsx).
- **Explorer** : les scrims haut/bas des cartes plein écran passent de blocs
  `rgba` unis (bande grise à bord net sur fonds clairs) à des dégradés
  `expo-linear-gradient` (~15.0.8, nouvelle dépendance mobile).

### 2026-07-15 — Recherche jeux déplacée dans l'Explorer (onglet JEUX)
- `mobile/app/(tabs)/games.tsx` : retrait de la barre de recherche IGDB
  (redondante) et du composant `GameSearchResults` ; l'onglet Jeux ouvre
  directement sur la bibliothèque/découverte, pleine hauteur.
- `mobile/app/(tabs)/explore.tsx` : nouvel onglet de recherche « JEUX »
  (entre SÉRIES ET FILMS et UTILISATEURS) via `GameResults`, sur le modèle de
  `MediaResults` — tap = consultation seule (`POST /api/games/add-from-igdb`
  sans statut, ouvre la fiche), `+` = suivi (statut « Voulus »).

### 2026-07-15 — Profil : sections Jeux + Jeux préférés + stat « Jeux joués »
- `/api/profile` renvoie `games`/`favoriteGames` (mêmes règles que séries/films :
  les « Voulus » restent dans l'onglet Jeux) et les stats gagnent `gamesCount`/
  `gamesPlayed` (en cours + terminés).
- Profil mobile : carte stat « Jeux joués » (icône manette), rangées « Jeux »
  (→ onglet Jeux) et « Jeux préférés » (→ nouvelle page `/library/favorite-games`,
  grille simple, tap = fiche jeu). `/api/profile/favorites` accepte `type=game`.

### 2026-07-15 — Import robuste (reprise + dates de diffusion) & densité UI
- **Import TV Time — étape 3/3 rétablie** : après statuts/affiches, le job de fond
  synchronise désormais les **listes d'épisodes + dates de diffusion** des séries
  importées (throttlé, statut recalculé par série). C'était l'étape supprimée qui
  vidait « À voir » (la file filtre sur `airDate <= maintenant`).
- **Reprise automatique** : un import resté « importing » sans job vivant (crash /
  redémarrage serveur) est relancé là où sa progression s'était arrêtée, dès que
  l'app re-consulte le statut (`resumeStalledImport`, upserts idempotents).
- L'écran d'import affiche la phase 3 et rappelle qu'on peut fermer la page
  (tout tourne côté serveur, progression en temps réel au retour).
- **Bouton « Resynchroniser ma bibliothèque »** (réglages) + `POST /api/shows/resync-all`
  pour rattraper les comptes déjà importés (utilisé pour réparer le compte pilote :
  339+ séries revenues dans « À voir »).
- **Densité recalée sur TV Time** (comparaison px des captures) : cartes « À voir » /
  « À venir » (code 20→17, cartes 104→96dp) et Profil (nom 24→20, sections 21→18,
  stats 23→19) — plus d'infos visibles par écran.

> Entrée type : `### AAAA-MM-JJ — Auteur` puis une liste courte de ce qui a changé.

### 2026-07-15 — Claude
- **Thèmes : Sombre + Sunset réellement fonctionnels** (Paramètres >
  Application > Thème : Système / Clair / Sombre / **Sunset**) :
  - `lib/theme.ts` : trois palettes complètes ; les clés COLORS deviennent des
    RÔLES (`white` = surface, `black` = texte fort, `pageMuted`, `onAccent` =
    texte sur l'accent, `imagePlaceholder`…), donc tous les styles existants
    sont thémables sans réécriture. **Sunset** : palette chaude inspirée de la
    charte Claude.ai (fonds crème #FAF5EE, texte brun #40332A, accent
    terracotta #E2854F, liens cuivrés) — pas un copier-coller.
  - Application : préférence en localStorage lue au chargement (avant les
    StyleSheet) ; changer de thème sauvegarde côté serveur PUIS recharge la
    web app (comme X/Twitter). `system` suit prefers-color-scheme. Sur l'app
    native, le thème suit l'appareil (note affichée dans les réglages).
  - **Balayage complet** : `color: COLORS.text` ajouté à tous les styles de
    texte sans couleur (31 fichiers) ; surfaces en dur (#fff, #f2f2f2,
    #e5e5e5…) remplacées par les rôles ; textes/icônes posés sur l'accent
    passés à `onAccent` (boutons jaunes, FAB, chips actives, badge NOUVEAU…) ;
    badge noir PREMIERE fixe dans tous les thèmes ; gris en dur illisibles en
    sombre corrigés ; barre d'état + fond du document + meta theme-color web
    suivent le thème ; en-têtes sombres by design (profil public, page acteur)
    conservés.
- **« Nom d'utilisateur » = nom d'affichage** : les Paramètres lisaient le
  store local figé à la connexion (« Etienne P. » malgré le profil renommé
  « Yggdrasil ») → la valeur vient désormais du profil serveur, et « Modifier
  le profil » met aussi à jour le store immédiatement.
- Vérifié au navigateur (8/8) : bascule Sombre → fonds/textes sombres corrects
  + préférence persistée localement ET côté serveur, Sunset → crème/terracotta,
  retour Clair, et nom d'utilisateur = displayName serveur. Captures des
  onglets Séries/Paramètres/fiche dans les trois thèmes.
### 2026-07-15 — Jeux vidéo : parité fiche avec séries/films (Claude)
- Objectif : la fiche jeu offre la même expérience que la fiche série/film — menu
  « … », personnalisation jaquette/bannière, favoris, listes, partage, aperçu
  bande-annonce.
- **Serveur** :
  - `apps/server/src/modules/media/favorites.ts` : `nextFavoriteOrder` accepte
    désormais `'show' | 'movie' | 'game'`.
  - `apps/server/src/modules/games/routes.ts` : `POST /api/games/:id/favorite`
    (miroir séries/films — bascule `isFavorite`/`favoritedAt`/`favoriteOrder`,
    notifie les abonnés ; **pas** de `createWatchEvent`, les jeux ne génèrent
    aucun événement de visionnage — isolation cross-domaine avec le fil
    `/api/social/feed`, qui lit `WatchEvent`), `GET /api/games/:id/images`
    (posters = cover IGDB, backdrops = artworks + screenshots IGDB, appel
    « live » mis en cache par `ApiCache`), `POST /api/games/:id/poster` et
    `POST /api/games/:id/banner`. `GET /api/games/:id` renvoie maintenant
    `isFavorite` et `videoId` (premier id vidéo YouTube IGDB).
  - `apps/server/src/services/igdb/index.ts` : champs IGDB étendus
    (`videos.video_id,videos.name,screenshots.image_id`), type `IgdbGame`
    complété — pas de nouvelle colonne DB, tout est récupéré à la volée et mis
    en cache par `igdbQuery`/`ApiCache`.
  - Tests ajoutés dans `apps/server/src/__tests__/games.test.ts` (aller-retour
    favori sur la fiche détail, mise à jour affiche/bannière).
- **Mobile** : `mobile/app/game/[id].tsx` réécrit sur le modèle de
  `mobile/app/show/[id].tsx` — bouton « … » dans le bandeau (même
  placement/style), menu Personnaliser/Favoris/Ajouter à une liste/Retirer/Partager
  (composants `PersonalizeMenu`/`ArtworkPicker`/`ListsSheet`/`SheetItem`
  dupliqués en version légère, comme demandé plutôt qu'une extraction risquée),
  bannière = `backdropPath` avec jaquette en surimpression, bloc « Bande-annonce »
  16:9 sous l'en-tête (miniature YouTube + bouton lecture ; tap = iframe
  autoplay intégré sur web, ouverture de l'URL YouTube via `Linking` sur natif —
  aucune nouvelle dépendance native). Le bouton « Retirer » (suivi) est
  maintenant dans le menu « … » au lieu d'être affiché en permanence dans la
  section Suivi, pour rester cohérent avec la fiche série/film.
- Gates : `cd apps/server && corepack pnpm exec tsc --noEmit` → 0 erreur ;
  `corepack pnpm test` → 82/82 (14 fichiers) ; `cd mobile && npm run typecheck`
  → 0 erreur.

### 2026-07-15 — Onglet Jeux vidéo (V1)
- Domaine jeux calqué sur séries : Media.type=game + sous-table Game + provider IGDB + module games + UserMediaStatus (Voulus/En cours/Terminés/Abandonnés, temps de jeu).
- Fiche jeu, recherche/ajout IGDB, découverte (populaires/à venir), sorties & DLC à venir, import bibliothèque Steam, notifications de sortie.
- Config : TWITCH_CLIENT_ID/SECRET (IGDB), STEAM_API_KEY. HowLongToBeat & PlayStation = V2.
- Notifications de sortie (Task 10) : passe ajoutée au worker de fond
  (`apps/server/src/services/sync-worker.ts`, fonction
  `notifyGameReleasesToday`, appelée à chaque `tick()`) — pour chaque
  `UserMediaStatus` d'un jeu suivi (non masqué) dont `Media.releaseDate`
  tombe aujourd'hui (bornes `setHours(0,0,0,0)` → +24h), crée une
  `Notification` (`type: 'game_release'`, titre « <titre> sort aujourd'hui »),
  même schéma que les notifications sociales (`modules/social/notify.ts` :
  `userId`/`type`/`title`/`date`/`metadataJson`). Dédup `(userId, mediaId,
  type)` via une recherche `contains` sur `metadataJson` (pas de colonne
  `mediaId` dédiée sur `Notification`). Passe légère, hors chemin critique des
  requêtes utilisateur.
- Typecheck serveur : 0 erreur. Suite complète : 80/80 sans régression.

### 2026-07-15 — Jeux vidéo : découverte + à venir + connexion Steam (Task 9)
- `mobile/app/(tabs)/games.tsx` : sous la bibliothèque, sections **« Sorties à
  venir »** (jeux suivis dont la sortie n'est pas passée, `GET
  /api/games/upcoming`, groupés par mois, carrousel horizontal, tap → fiche)
  et **« Populaires » / « À venir »** (découverte IGDB, `GET
  /api/games/discover`, carrousel horizontal, tap = ajoute en « Voulus » via
  `POST /api/games/add-from-igdb` puis ouvre la fiche, overlay de chargement
  sur la jaquette). La découverte est désormais toujours visible (avant :
  seulement en repli bibliothèque vide) — un seul rendu, jamais dupliqué.
- `mobile/app/settings.tsx` (onglet Compte, section « Jeux — Steam ») :
  `TextInput` SteamID/URL de profil + bouton « Importer ma bibliothèque » →
  `POST /api/games/steam/import`, affiche « N jeux importés » ou l'erreur
  (`steam_id_invalide` → message profil public requis) ; invalide
  `['games','library']` au succès.
- Typecheck mobile : 0 erreur.

### 2026-07-15 — Jeux vidéo : module API games (Task 4)
- `apps/server/src/modules/games/routes.ts` : routes `GET /api/games/search`
  (recherche IGDB), `POST /api/games/add-from-igdb` (ajout par id IGDB, statut
  optionnel), `GET /api/games` (bibliothèque groupée par statut wishlist/
  playing/completed/abandoned), `POST /api/games/:id/status` (changement de
  statut), `GET /api/games/:id` (détail, enrichissement paresseux si jamais
  synchronisé), `DELETE /api/games/:id/tracking`.
- Helper `ensureGameFromIgdb(igdbId)` (miroir de `ensureMediaFromTmdb`) :
  crée/met à jour `Media`(type `game`) + `Game` à partir d'IGDB ; renvoie
  l'existant sans erreur si IGDB est hors-ligne/quota dépassé.
- Module enregistré dans `apps/server/src/app.ts` (`await
  app.register(gamesRoutes)`).
- TDD : test `apps/server/src/__tests__/games.test.ts` (bibliothèque groupée
  par statut + changement de statut), suite complète 78/78 sans régression.
- Prépare la tâche suivante : UI mobile de suivi des jeux.

### 2026-07-15 — Jeux vidéo : modèle de données (Task 1)
- Migration Prisma additive `add_games` : nouvelle table `Game` (mediaId
  unique, `platforms`/`developer`/`publisher`/`gameModes`/`steamAppId`,
  `isDlc`, `parentGameId` → relation nommée `GameDlc` vers `Media`), colonne
  `Media.igdbId` et colonne `UserMediaStatus.playtimeMinutes`. Aucune donnée
  existante touchée (ALTER TABLE ADD COLUMN nullable + CREATE TABLE).
- Prépare les tâches suivantes : provider IGDB, module API `/api/games`, UI
  mobile de suivi des jeux.

### 2026-07-15 — Explorer refondu en flux TikTok
- Explorer unique plein écran, défilement vertical paginé (suppression de PARCOURIR + deck Tinder).
- Rail social : like (= À voir) / dislike / déjà vu / commentaire / partage, compteurs (likes, vus, commentaires) agrégés sur toute l'app via `/api/explore/feed`, note ★ TMDb sur la carte.
- Tap = overlay description ; bottom sheet commentaires réutilisant le hook `useComments` + `CommentCard` partagés ; pull-to-refresh + flux infini.

### 2026-07-15 — Claude
- **Refactor Commentaires : logique + carte partagées** (page plein écran
  `/comments/[id]` ET nouveau bottom sheet Explorer façon TikTok), sans
  changement de comportement de la page existante :
  - `mobile/components/comments/types.ts` : `CommentDto`, `dateFr`.
  - `mobile/components/comments/useComments.ts` : requête (même clé
    `['comments', mediaId]`, cache partagé avec les compteurs
    `CommentsRowLink`), tri PERTINENTS/RÉCENTS, réponses, `post`/`postReply`,
    cœur ❤️ et suppression **optimistes** (rollback si échec), partage.
  - `mobile/components/comments/CommentCard.tsx` : rendu d'une carte
    (avatar, cœur, réponses, partage, fil de réponses + composeur inline).
  - `mobile/app/comments/[id].tsx` consomme désormais ces modules (chrome de
    page inchangé : en-tête, tri, FAB crayon jaune, modale composeur).
  - `mobile/components/explore/CommentsSheet.tsx` réutilise `useComments` +
    `CommentCard` (au lieu de l'ancien `CommentsTab`) ; barre de composition
    **inline en bas** façon TikTok (pas de FAB) ; le hook n'est monté qu'une
    fois le `mediaId` résolu (composant interne `CommentsPanel`).
  - Suppression de l'ancien `mobile/components/comments.tsx` (obsolète,
    devenu doublon).
  - `cd mobile && npm run typecheck` : 0 erreur.

### 2026-07-11 — Claude (4)
- **Explorer : barre de recherche recalée sur TV Time** (comparaison px des
  captures) : rangée 44dp, icône 20, texte 15,5 — nettement plus compacte.
- **Bouton « actualiser » supprimé** (liste ET pioche Découvrir). Le flux se
  rafraîchit désormais : (1) en **arrivant sur l'onglet Explorer** depuis un
  autre onglet, (2) en **re-cliquant sur Explorer** déjà actif, (3) en
  **tirant la page vers le bas** — nouveau composant `PullToRefresh` maison
  façon Instagram : résistance élastique, pastille qui tourne avec la
  traction puis en continu pendant le rechargement, retour en ressort.
  Compatible web ET natif (le RefreshControl RN ne fonctionne pas sur la web
  app) ; `overscroll-behavior: contain` pour neutraliser le recharger-page du
  navigateur. Revenir d'une fiche ne re-mélange PAS le flux (le refresh se
  fait au changement d'onglet, pas au focus).
- Vérifié au navigateur (7/7) : cotes de la barre, absence du bouton, tirage
  tactile → nouvel appel `/api/explore/feed` + retour en place, refresh à
  l'arrivée sur l'onglet et au re-clic.

### 2026-07-11 — Claude (3)
- **Pop-up « Cocher aussi les épisodes précédents ? »** (règle produit,
  demande d'Étienne) : en cochant un épisode (ex. S02E03) alors que des
  épisodes ANTÉRIEURS diffusés ne sont pas vus, une mini pop-up propose de les
  cocher aussi. **OUI** → toutes les saisons précédentes + les épisodes
  antérieurs de la saison en cours sont cochés (S1 entière + S2E01-02 dans
  l'exemple) ; **NON** → seul l'épisode coché l'est. Spéciaux (saison 0) et
  épisodes non diffusés jamais touchés. C'est le SEUL cas où des épisodes se
  cochent sans geste direct de l'utilisateur — et uniquement après son OUI.
  - Serveur : `POST /api/episodes/:id/watched-previous` (+ recalcul du statut
    de la série, événement agrégé) — **testé** (72 tests verts).
  - Mobile : pop-up animée (composant partagé) branchée sur la fiche (onglet
    Épisodes) ET la fenêtre épisode ; pas de pop-up en cochant depuis la file
    « À voir » (l'épisode proposé est toujours le prochain, sans précédent non vu).
  - Vérifié au navigateur (6/6) : pop-up à la coche d'E3, OUI → E1+E2+E3 en
    base et compteur 3/4 à l'écran, NON → seul E3, pas de pop-up sur E1.

### 2026-07-11 — Claude (2)
- **Onglet Séries : pastilles de section FLOTTANTES** (copie TV Time) : la
  pastille grise de la section courante (« À VOIR », « PAS REGARDÉ DEPUIS UN
  MOMENT », « HISTORIQUE DE VISIONNAGE »…) suit le défilement en haut de
  l'écran et change de libellé au passage d'une section (rebond à l'apparition,
  masquée quand l'entête en dur est elle-même visible pour éviter le doublon).
- **Fenêtre « fiche épisode » façon TV Time** (`components/EpisodeSheet.tsx`) :
  sur les cartes de l'onglet Séries (file ET historique), la **pastille du
  titre ouvre la fiche de la série** et un appui **ailleurs sur la carte ouvre
  la fenêtre de l'épisode** — panneau plein écran qui remonte en ressort
  (fond assombri), chevron ↓, **points de pagination** (fenêtre de 5, point
  actif jaune), image de l'épisode avec pastille série (→ fiche) et partage,
  code S/E + titre, **date + Vu/Pas vu + coche** (bascule optimiste, la file
  derrière se met à jour), **Où regarder**, **Informations sur l'épisode**
  (note de la communauté en étoiles + synopsis), rangée **Commentaires →**
  page dédiée. **Swipe latéral** pour passer d'un épisode diffusé au suivant.
- CheckCircle : rôle/label d'accessibilité (« Marquer comme vu / non vu »).
- **Vérifié bout en bout au navigateur (12/12)** : titre → fiche, carte →
  fenêtre (192 ms), swipe aller/retour, coche « Vu » optimiste (171 ms) +
  confirmée serveur, navigation commentaires/fiche, pastilles flottantes à la
  descente et dans l'historique.

### 2026-07-11 — Claude
- **Audit complet de réactivité** (bugs « je dois appuyer 4 fois » / « mes
  changements semblent perdus ») — tout bascule désormais au doigt, le serveur
  confirme en arrière-plan (rollback si échec) :
  - **Ajouter/Supprimer des favoris** : le cœur rouge et la grille des pages
    « préférés » réagissent immédiatement (écriture optimiste dans le cache de
    la bibliothèque). Cause racine du « 4 appuis » : l'UI attendait le refetch
    complet de la bibliothèque et chaque appui re-basculait le favori serveur.
  - **Réorganisation (drag & drop)** : l'ordre est écrit tout de suite dans le
    cache et l'invalidation n'a lieu qu'à la **dernière** sauvegarde en vol —
    avant, le refetch d'un dépôt précédent réécrivait l'ancien ordre
    (« changements perdus » au retour sur la page).
  - **Bug d'invalidation corrigé** : la clé `['movies','library','all']` ne
    matchait pas le cache de la page Films (`['movies','library',tri,filtre]`)
    → invalidations élargies aux préfixes `['movies']` / `['shows']`.
  - **Cœur + suppression de commentaire** (page Commentaires) : optimistes.
  - **SUIVRE/ABONNÉ** (profil public avec compteur d'abonnés, abonnés/abonnements,
    recherche d'amis, résultats utilisateurs d'Explorer) : bascule instantanée,
    plus de spinner qui masque l'état.
  - **Décocher depuis l'historique** (onglet Séries) : la rangée disparaît
    immédiatement.
  - **DragGrid (web)** : `userSelect: none` — le glisser surlignait le texte des
    cellules (sélection navigateur) au lieu de déplacer l'affiche sur ordinateur.
- **Vérifié en conditions réelles** (serveur + app web pilotée par navigateur) :
  cœur rempli/vidé en ~300 ms après UN clic, 3 favoris ajoutés visibles dans la
  grille au retour, drag & drop persistant (ordre serveur ET affichage alignés).

### 2026-07-10 — Claude (6)
- **Fiche série/film reconstruite façon TV Time** (comparaison px des captures Naruto) :
  - **Bannière repliable** : la couverture (240 px) se réduit en barre compacte
    avec titre centré au défilement (tous les onglets) ; sous-titre
    « N saisons • Terminée • Plateforme » traduit en français.
  - **Onglets réduits à À PROPOS / ÉPISODES** (comme TV Time) ; la discussion
    devient une rangée « Commentaires (N) › » en bas de fiche.
  - **À propos, ordre TV Time** : Où regarder (pastilles noires pour toutes les
    plateformes), question d'intérêt compacte, **Similaire à** (vignette ronde +
    titre, ouvre la fiche), **Informations** (années « 2002 - 2007 », genres FR,
    rangée d'étoiles TMDb, synopsis, rangées horloge/chrono/« ajoutée par N
    personnes »), **Distribution**, **Les utilisateurs ont également regardé**
    (badge coche jaune si déjà suivi, import TMDb silencieux au clic), **Notes de
    la communauté** (courbe SVG des moyennes d'épisodes par saison, sélecteur +
    points), **Commentaires**. Fiche film alignée (Vu, mêmes sections).
- **Distribution + fiches acteurs** (`/person`) : cartes horizontales photo/nom/rôle ;
  page acteur sombre façon TV Time (‹ › pour passer d'un membre à l'autre, photo,
  « Né(e) le … », bio, bouton 𝕏, **Filmographie** filtrable Séries/Films avec
  affiches, rôles, notes en étoiles et genres — clic = ouverture de la fiche).
  Données via TMDb : nouvelles routes `GET /api/people/:tmdbId` (bio + filmographie,
  cache 30 j) et `GET /api/people/search?name=`.
- **Page Commentaires dédiée** (`/comments/[id]`) : cartes blanches sur fond gris,
  tri PERTINENTS/RÉCENTS, cœur (réaction ❤️), fils de réponses repliables,
  partage, suppression de ses commentaires, FAB jaune crayon + composeur plein écran.
- **Serveur** : `ensureTmdbIdFromTvdb` (les animés ajoutés via TheTVDB récupèrent
  leur id TMDb → distribution/recommandations/bande-annonce débloquées) ;
  recommandations enrichies (`localId`, `inLibrary`), `addedByCount`, `endYear`,
  `voteAverage`, `tmdbId` du cast ; `GET /api/shows/:id/community-ratings`
  (moyennes des notes d'épisodes de tous les utilisateurs, spéciaux exclus,
  **testé** — 69 tests serveur verts).

### 2026-07-10 — Claude (5)
- **Paramètres : copie TV Time** (comparaison px des captures) :
  - **COMPTE** : section **Réseaux sociaux** avec rangée « Modifier les comptes
    liés › » vers la nouvelle sous-page `/linked-accounts` (boutons
    Google/Discord/Facebook déplacés là) ; section **Vie privée** avec
    « Définir le profil comme privé » + interrupteur (la confidentialité
    existait côté serveur mais n'était pas exposée — `isPrivate` ajouté au
    GET/POST `/api/profile`, bascule optimiste) ; **SE DÉCONNECTER** en bouton
    jaune pleine largeur et **SUPPRIMER LE COMPTE** en bleu (comme TV Time).
  - **Styles TV Time** : radios du thème en **anneau + point noir** (fin des
    pastilles jaunes cochées), interrupteurs éteints à piste **noire** (bouton
    blanc) / allumés jaunes (bouton noir), **VIDER LE CACHE** en jaune,
    libellés de rangées 17 et sous-textes 14.
  - Non repris (fonctionnalités TV Time absentes chez nous) : SAUVEGARDER
    (édition inline), Services d'abonnement, politique de confidentialité,
    sections Commentaires/Notifications/Recommandations/Flux de l'onglet
    APPLICATION.

### 2026-07-10 — Claude (4)
- **« À voir » ignorait les nouvelles saisons des séries terminées (suite
  Clevatess)** : la file excluait inconditionnellement le statut « Terminée » —
  une série finie dont une nouvelle saison démarrait ne réapparaissait jamais.
  Désormais : si de nouveaux épisodes ont été diffusés (`remaining > 0`), la
  série revient dans « À voir » avec son prochain épisode et le badge PREMIERE
  (comportement TV Time). Le balayage d'arrière-plan **recalcule aussi le
  statut** après chaque sync (« Terminée » → « En cours » quand une saison
  arrive), pour des groupes de bibliothèque cohérents. **3 tests ajoutés**
  (`new-season-queue.test.ts`, 61 tests serveur verts) : série à jour absente
  de la file, retour avec PREMIERE à la diffusion d'une nouvelle saison,
  re-sortie + statut « En cours » après visionnage.

### 2026-07-10 — Claude (3)
- **Harmonisation générale des tailles** (réf. = onglet Séries recalé + mesures
  px des captures TV Time). Échelle commune : grands titres de page 26→**21**,
  titres de feuille/en-têtes 20-23→**18-19**, rangées de menus/feuilles
  17-19→**15-16** (paddings 15-17→12-13), boutons pill texte 14-15→**13**
  (hauteur ~40dp), champs 18→17.
  - **Pages favoris pixel perfect** : titre 21, bouton jaune ~38dp (marges 12),
    TRIER PAR 11/16, feuille de tri : titre 18, options 15 (rangées ~50dp),
    pastille 28, ANNULER/APPLIQUER ~40dp ; menu « ... » 15 (icônes 19-20).
  - **Réglages** : sections 23→19, rangées 19→16, interrupteurs/radios 16,
    modales 18/17, boutons compacts. **Fiche** : sections 24→20, synopsis
    18→16, saisons 24→20 (compteur 15), barre AJOUTER 15, Personnaliser 16,
    compte à rebours 22. **Feuilles de filtres** (Séries/Films du profil) :
    titre 18, options 15, puces 13, boutons 13/11. **Social / Notifications /
    PageHeader / états vides** : titres 20→18, rangées 17→16. **Profil
    public** : compteurs 24→21, sections 20→18. **Import / Setup / Édition de
    profil / Couverture** : 17-24 → 16-20. Réordonnancement : titre 19.

### 2026-07-10 — Claude (2)
- **Nouvelles saisons invisibles (cas Clevatess S2) : corrigé.** Trois causes
  serveur empilées :
  1. **Bug** : la resync de la fiche exigeait un `tmdbId` — les séries ajoutées
     via TheTVDB seul (animés, `sourcePriority: 'tvdb'`) n'étaient **jamais**
     resynchronisées : une saison sortie après l'ajout n'arrivait jamais en base.
  2. **Caches trop longs** : fenêtre de resync 3 j + cache HTTP TVDB 3 j
     (≈ 6 j de retard cumulés). Désormais **6 h** (fenêtre et cache) pour les
     séries EN COURS, 3 j pour les terminées ; `lastSyncedAt` et le nombre de
     saisons sont mis à jour après chaque sync TVDB.
  3. **Aucun rafraîchissement de fond** : la file « À voir » ne déclenche
     désormais un **balayage d'arrière-plan** (`shows/refresh.ts`,
     fire-and-forget, max 4 séries/2 min) qui resynchronise les séries en cours
     périmées (> 12 h) — une saison qui démarre rejoint « À voir » sans ouvrir
     la fiche, comme TV Time.

### 2026-07-10 — Claude
- **Fiche : menu « ... » recalé sur TV Time (px des captures)** : carte
  **flottante** (marges 8, coins 14) au lieu du panneau collé aux bords,
  rangées 62→**48dp**, police 18 semi-gras → **17 fine**, icônes 22→20,
  séparateurs hairline. **Films** : plus de rangée de statut ni de « Regarder
  plus tard » (parité TV Time). **Séries commencées : « Arrêter de regarder »**
  (statut Arrêtée via `/abandon`) — la série rejoint la section **ARRÊTÉ** de
  la page Séries du profil, avec **barre de progression rouge** (TV Time) ;
  libellés « Arrêtées/Abandonnée » → « Arrêté(e) ». Feuilles Personnaliser /
  Ajouter à une liste alignées sur la même carte flottante.
- **Réactivité « temps réel » (recette TanStack Query, optimistic updates)** :
  toutes les actions de la fiche (favori, vu/pas vu, suivre, regarder plus
  tard, arrêter, supprimer) écrivent immédiatement le résultat attendu dans le
  cache (`onMutate` + rollback en cas d'échec), le serveur confirme en
  arrière-plan — fini l'attente d'un aller-retour VPS avant que l'UI réagisse.
  **Listes : bug corrigé** — création/coche n'invalidaient jamais le cache du
  profil (les nouvelles listes n'apparaissaient qu'au redémarrage) ; désormais
  coche/création **optimistes** dans la feuille + invalidation `['lists']` et
  `['profile']`. Toasts affichés immédiatement. Serveur : notification des
  abonnés en arrière-plan sur les favoris (ne retarde plus la réponse).

### 2026-07-09 — Claude (5)
- **Onglet Séries : retour à la version TV Time** (décision d'équipe
  Étienne/Benjamin) — revert de « l'historique dans son onglet dédié »
  (PR #24) : de nouveau **deux onglets seulement** (À VOIR / À VENIR),
  l'« Historique de visionnage » se dévoile en **scrollant vers le haut**
  au-dessus de « À voir » (scroll initial calé dessous, décocher renvoie
  l'épisode dans « À voir »).

### 2026-07-09 — Claude (4)
- **Pages « Séries/Films préférés » : copie complète de TV Time** (ajout,
  ordre, tri, partage) :
  - **Serveur** : colonnes `favoriteOrder`/`favoritedAt` sur `UserMediaStatus`
    (migration `favorite_order`) — un nouvel ajout arrive horodaté en fin
    d'ordre, un retrait libère sa place ; favoris triés par ordre utilisateur
    partout (profil + `/api/profile/favorites`) ; nouvel endpoint
    `POST /api/profile/favorites/reorder` (drag & drop). **4 tests ajoutés**
    (58 tests serveur verts).
  - **Page principale** (`components/favorites.tsx`, partagée séries/films) :
    en-tête chevron + « ... », grand titre à gauche, bouton jaune, rangée
    TRIER PAR ouvrant la **feuille de tri** TV Time (Ordre de l'utilisateur /
    Derniers ajouts / Premiers ajouts / A-Z / Z-A, pastille jaune cochée,
    ANNULER / APPLIQUER grisé sans changement) — tri **persisté** par type
    (zustand). Menu « ... » : carte flottante **Réordonner les éléments** /
    **Partager** (partage natif, presse-papiers en secours web).
  - **Ajouter/Supprimer** : page TV Time — chevron retour + titre « Séries »/
    « Films », **recherche filtrante**, liste alphabétique, **cœur rouge**
    plein (favori) / contour gris, avec rebond.
  - **Réordonnancement drag & drop** (`app/library/reorder-favorites.tsx` +
    `components/DragGrid.tsx`, sans dépendance : Animated + PanResponder,
    web + natif) : « Faites glisser et déposez... », appui long qui soulève
    l'affiche, les autres glissent en ressort, auto-défilement près des bords,
    sauvegarde à chaque dépôt, « Terminé » pour revenir.

### 2026-07-09 — Claude (3)
- **Profil : couverture derrière la barre de statut** (comme TV Time). En natif
  (edge-to-edge Android déjà actif + iOS par défaut) : l'en-tête s'étend de
  `insets.top` et les **icônes de statut passent en clair** tant que l'écran est
  affiché (`expo-status-bar` + `useIsFocused`). Sur la **web app**, l'OS réserve
  la zone de statut : elle est **teintée de la couleur de l'en-tête** via un
  swap dynamique du meta `theme-color` (suivi par Android), restauré en quittant
  l'écran. Appliqué à l'onglet Profil **et** au profil public (`/user/[id]`).

### 2026-07-09 — Claude (2)
- **Cotes « pixel perfect » Explorer + Profil** (comparaison px des captures
  SerieTime vs TV Time, même téléphone — suite du recalage du 08/07 qui ne
  couvrait que Séries/Films) :
  - **Explorer — recherche** : barre compacte 70→**56dp** (saisie 19→17,
    icône 24→22), **soulignement sous toute la rangée** au lieu d'un champ
    encadré (le liseré venait du focus-ring du navigateur sur la web app,
    neutralisé via `outlineStyle:none`) ; placeholder court « Rechercher » au
    repos, complet une fois le champ actif (comme TV Time) ; onglets répartis
    sur toute la largeur (police 15→14) ; résultats : affiche 74→**56dp**,
    titre 20→**17**, méta 15→14, bouton +/coche 44→**40dp**, séparateurs
    hairline entre les lignes.
  - **Explorer — flux PARCOURIR** : cartes hero en **16/9** (au lieu de 16/11),
    coins arrondis 5→**12**, bouton + 46→**40dp**, titre 22→**20**,
    description 16→15 ; puces de mode/catégorie légèrement plus grandes
    (police 13→14, comme les puces FLUX/DÉCOUVRIR de TV Time) + suppression
    d'un `fontWeight` interdit (→ `FONTS.extraBold`).
  - **Profil** : avatar 82→**62dp** (initiale 34→26), nom 28→**24**,
    MODIFIER (police 13→12, bord 1.5), cloche 46→**40dp**, compteurs
    26/16→**21/14** (hauteur réduite), titres de section 24→**21**
    (chevrons 22), cartes stats : rayon 5→**10**, valeurs 27→**23**,
    libellés 12→11 ; carte Listes 155→145dp ; **marges latérales 24→16**
    partout (titres, affiches, stats), pastille cœur 28→24.

### 2026-07-09 — Claude
- **Vague d'animations 4** — les écrans restants sont animés (toujours API
  `Animated`, « réduire les animations » respecté, web + natif) :
  - Nouveau composant `PopIn` (`mobile/components/anim.tsx`) : apparition
    « ressort » des petits éléments (coche ajoutée, pastille de notifications).
  - **Recherche / Explorer** : fondu à l'entrée/sortie du mode recherche et entre
    les onglets SÉRIES ET FILMS / UTILISATEURS ; résultats et cartes PARCOURIR en
    cascade (`AppearItem`) ; `+` → `✓` avec rebond (`PopIn`) ; cartes hero avec
    enfoncement au tap (`PressableScale`) ; panneau détails DÉCOUVRIR qui
    monte/redescend en douceur (`SlideUpBar`).
  - **Réglages** : bascule d'onglets en fondu (`FadeSwitch`) ; interrupteurs dont
    le bouton glisse et la piste change de couleur ; coche des radios qui pop ;
    modales (mot de passe, suppression) avec entrée ressort.
  - **Écran social (Amis)** : bascule Fil d'actualité / Trouver des amis en fondu,
    lignes du fil et résultats en cascade, retour tactile au tap sur une activité.
  - **Notifications** : apparition en cascade des lignes.
  - **Films** : bascule À VOIR / À VENIR en fondu + cascade des affiches (aligné
    sur l'onglet Séries).
  - **Profil** : pastille de non-lus qui pop, cartes de statistiques en cascade.
  - **Profil public** (`/user/[id]`) : entrée en fondu (`Pop`), affiches récentes
    en cascade + enfoncement au tap.

### 2026-07-08 — Claude (11)
- **Vague d'animations 3** :
  - **Micro-transitions des onglets hauts** : bascule À VOIR / À VENIR et
    À PROPOS / ÉPISODES / DISCUSSION en fondu + léger glissement (`FadeSwitch`).
  - **Tirer pour rafraîchir** (teinte jaune de marque) sur « À voir », « À venir »,
    les pages profil (Séries, Films, favoris) et le profil (`lib/usePullRefresh.ts`
    + `RefreshControl`).

### 2026-07-08 — Claude (10)
- **Vague d'animations 2** (toujours API `Animated`, reduce-motion respecté) :
  - **Skeleton loaders pulsants** à la place du spinner (`components/skeletons.tsx`
    + `Skeleton`) : file « À voir » (cartes fantômes) et pages profil (grille
    d'affiches). Le layout ne saute plus quand les données arrivent.
  - **Bandeau « AJOUTÉE ! » / toast qui remonte** depuis le bas avec fondu
    (`SlideUpBar`) sur la fiche série/film.
  - **Effet d'enfoncement au tap** sur les affiches (profil, grilles library)
    via `PressableScale` (scale appliqué au Pressable → zéro impact layout).

### 2026-07-08 — Claude (9)
- **Animations pour rendre l'app vivante** (API `Animated` intégrée, pas de
  nouvelle dépendance ; fonctionne web + natif ; respecte « Réduire les
  animations » via `lib/useReduceMotion.ts`) :
  - **Barres de progression qui se remplissent** en douceur quand on coche un
    épisode (composant `AnimatedFill`) — fiche série (barres de saisons + barre
    globale sous la bannière) et grilles du profil.
  - **Coche (`CheckCircle`)** : pop élastique au changement d'état + léger
    enfoncement au press.
  - **Ouverture des pages en « pop »** (fondu + montée + scale) sur la fiche
    série/film et les pages profil (composant `Pop`) ; + transitions natives
    du `Stack` (fiche depuis le bas, glissement latéral) côté iOS/Android.
  - **Entrée en cascade** des cartes « À voir » et des sections du profil
    (`AppearItem`).
  - **Icône d'onglet** qui « pop » quand l'onglet devient actif.
  - Composants réutilisables dans `components/anim.tsx`.

### 2026-07-08 — Claude (8)
- **Onglet HISTORIQUE retiré** (il n'existe pas dans TV Time) : l'onglet Séries
  garde `À VOIR` / `À VENIR`, et l'**historique de visionnage réapparaît en
  faisant défiler vers le haut** dans « À voir » (scroll initial calé sous le
  bloc historique).
- **Re-clic sur l'onglet actif = actualisation + retour à l'état par défaut**
  (façon TV Time) : nouveau store `lib/tabReset.ts` ; `TabBar` incrémente un
  compteur par onglet, chaque écran (`index`, `movies`, `explore`, `profile`)
  se remonte via `key` → scroll et onglet interne réinitialisés.
- **Pages profil cliquables** (avant : « rien ne se passe ») — 4 nouvelles
  pages calquées sur TV Time, ouvertes depuis les sections du profil :
  - **Séries** (`/library/shows`) : en-tête (retour + titre + bouton œil),
    sections `EN COURS` / `À JOUR` / `TERMINÉ` / `PAS COMMENCÉ` / `ARRÊTÉES`,
    grille 3 colonnes, **barre de progression jaune/verte** (épisodes diffusés),
    bouton flottant `FILTRES` → sheet (Trier par + Progression, Réinitialiser/Appliquer).
  - **Films** (`/library/movies`) : sections `VU` / `NON VU`, grille 3 colonnes,
    `FILTRES` (Trier par + Avancement).
  - **Séries préférées** / **Films préférés** : bouton jaune
    `AJOUTER/SUPPRIMER`, `TRIER PAR Ordre de l'utilisateur`, grille, et une
    modale de sélection (étoile) pour (dé)favoriser.
  - Nouvel endpoint `GET /api/shows/library` (liste à plat + progression sur
    diffusés) ; les films réutilisent `/api/movies/profile`. Composants
    partagés `components/library.tsx`.

### 2026-07-08 — Claude (7)
- **« Personnaliser » copié de TV Time** (séries ET films, réf. 38-40) : le
  menu « … » → Personnaliser ouvre un petit sheet « Modifier l'affiche /
  Changer la bannière » ; chaque option ouvre un écran plein (retour + titre
  centré) — affiches en grille 2 colonnes, bannières en liste ; l'image active
  est assombrie avec **★ « Sélectionnée »** (fini le liseré jaune + coche).
- **Onglet Épisodes recalé sur TV Time (réf. PJ Mushoku)** :
  - **Coches TOUJOURS vertes** (défaut global de `CheckCircle` : vert + coche
    blanche) — le jaune est réservé aux barres de progression.
  - **Progression basée sur les épisodes DIFFUSÉS** : saison « terminée »
    (barre + coche vertes) quand tous les épisodes disponibles à date sont vus ;
    barre jaune sinon, **piste jaune pâle toujours visible** (réf. 35).
  - **Barre de progression globale de la série** au bas de la bannière
    (épisodes diffusés vus / diffusés, hors spéciaux) : jaune en cours, verte à
    jour.
  - **Épisodes non diffusés : plus de coche** (verrou serveur `400
    not_aired_yet` ajouté) ; à la place, **compte à rebours « N JOURS »**
    (nombre 24 extraBold + libellé 10) au lieu de la date.
  - Tests : verrou non-diffusé couvert (**79 tests** : 25 + 54).

### 2026-07-08 — Claude (6)
- **Onglet Séries : « Historique de visionnage » façon TV Time** — la liste
  « À voir » s'ouvre normalement, et **faire défiler vers le haut révèle les
  derniers épisodes cochés** (cartes fondues, coches vertes ; décocher remet
  l'épisode dans « À voir »). Nouvelle route `GET /api/shows/history`
  (10 derniers `watchedAt`), scroll initial calé sous le bloc historique
  (`onLayout` + `scrollTo`). Test serveur ajouté (**78 tests** : 25 + 53).
- **Re-clic sur l'onglet actif = actualisation** (barre de navigation du bas,
  façon TV Time) : `TabBar` invalide toutes les requêtes TanStack Query quand
  on re-clique sur l'onglet où l'on se trouve déjà.
- **Cotes « pixel perfect » sur mesures TV Time** (comparaison au px des
  captures, même téléphone) : onglets hauts 56→**42dp** (police 16→14,
  soulignement 4→3) ; **barre de navigation basse 70→56dp** (icônes 26→23,
  libellés 11→10.5) ; pastille de section (police 12→11, hauteur ~19dp) ;
  pastille de série (police 12→10.5, bord 2→1.5) ; badges (police 12→10) ;
  cartes À voir/À venir : code 22→**20**, titre 16→**13**, coche 44→**38dp**,
  rayon 14→10, hauteur ~104dp (vérifié au navigateur : carte 104, onglets 42,
  nav 55). **Échelle de police système verrouillée** comme TV Time
  (`allowFontScaling:false` natif, `text-size-adjust:none` web) — le réglage
  Android « grande police » gonflait nos textes, pas ceux de TV Time.

### 2026-07-08 — Claude (5)
- **Police de l'app : Rubik → Mulish** (partout, web + natif). Rubik, ronde et
  large, rendait le texte « trop gros / grossier » vs TV Time même en bold et à
  taille réduite. **Mulish** (sans-serif humaniste fine) colle au rendu net et
  léger de TV Time — choisi par Étienne après comparaison visuelle (Rubik / Inter
  / Montserrat / Mulish sur la carte « À voir »). `lib/theme.ts` (FONTS),
  `app/_layout.tsx` (chargement), CLAUDE.md mis à jour ; paquets de polices
  inutilisés retirés (rubik/inter/montserrat), seul `@expo-google-fonts/mulish`
  reste. Règle inchangée : `fontFamily: FONTS.x`, jamais `fontWeight`.

### 2026-07-08 — Claude (4)
- **Cartes « À voir » (onglet Séries) recalées pixel à pixel sur TV Time** — un
  gros delta de mise en page avait été signalé (cartes/texte trop grands, code
  épisode qui passait sur 2 lignes). `components/EpisodeQueueCard.tsx` :
  - dimensions réduites à celles de TV Time : vignette 96, coche 44, code 23,
    titre 16, carte ~112 min (≈15 % de la hauteur d'écran, comme TV Time) →
    ~5 cartes visibles au lieu d'une seule ;
  - **code épisode toujours sur une ligne** (`numberOfLines`) et **« +N » restants**
    réduit/discret à droite, il ne casse plus jamais la ligne du code.
  - **Typographie affinée** (texte jugé « trop grossier / gras » vs TV Time) :
    les éléments en avant (onglets À VOIR/À VENIR, pastilles de section et de
    série, code épisode, badges) passent de `extraBold` (Rubik 800) à **`bold`
    (700)** ; code à 22. + **lissage de police** sur la web app (`app/+html.tsx`,
    `-webkit-font-smoothing: antialiased`) : sans ça le web rendait le texte plus
    épais qu'en natif.
- **Badges façon TV Time** (`apps/server` file « À voir ») :
  - **PREMIERE** désormais aussi pour le **1ᵉʳ épisode d'une saison** (pas seulement
    d'une série) — ex. « S02 | E01 » ;
  - **NOUVEAU** resserré à la **fenêtre de 3 jours** après diffusion (au lieu de 7),
    et uniquement pour un épisode déjà diffusé.

### 2026-07-08 — Claude (3)
- **Liste des saisons (onglet Épisodes) alignée sur TV Time** :
  - Les **épisodes spéciaux (saison 0) passent en bas** de la liste (avant en haut).
  - **Barres de progression par saison** en bas de chaque carte : **jaune** quand
    le visionnage est en cours, **vert** quand la saison est terminée (coche verte
    à coche blanche) ; masquée tant qu'aucun épisode n'est vu.
  - **Coche « Tous les épisodes »** : 1er appui = tout marquer vu **sauf les
    spéciaux** ; quand on est **à jour** (tous les épisodes réguliers *diffusés*
    vus), un nouvel appui affiche la barre **« Marquer tout comme non vu »**
    (icône œil barré) qui décoche tout (hors spéciaux). Les spéciaux se cochent
    toujours **à la main**.
  - Une série est considérée **« à jour » même sans les spéciaux** (déjà le cas
    côté serveur : `seasonNumber > 0` dans le calcul de statut ; nouveau route
    `POST /api/shows/:id/mark-all-unwatched`, symétrique de `mark-all-watched`).
  - Tests : nouveau fichier `specials.test.ts` (tout marquer/démarquer ignore la
    saison 0, série « terminée » sans les spéciaux). **77 tests** (25 core + 52 serveur).
  - Seed de démo enrichi (Mushoku Tensei : 3 saisons + spéciaux, S1/S2 terminées,
    S3 en cours) pour vérifier visuellement barres et tri.

### 2026-07-08 (après-midi) — Claude (avec Benjamin) — Audit vagues 1 & 2
Suite au `docs/AUDIT-2026-07-08.md`. Branche synchronisée avec le travail d'Étienne
(police Rubik) au préalable.
**Sécurité serveur** : rate limiting `@fastify/rate-limit` sur login (10/5 min) et
register (10/10 min) ; mdp min 8, purge des sessions expirées, invalidation des autres
sessions au changement de mdp ; borne anti zip-bomb (volume décompressé total + nb
d'entrées) ; imports TV Time scopés par `userId` (migration `import_user_scope`) ;
`backup/import` durci (catalogue partagé en create-only, tables perso via updateMany
scopé, export sans `passwordHash`) ; avatars/couvertures bornés.
**Robustesse mobile** : `LoadError` partagé (message + RÉESSAYER) sur profil, fiche
série, épisodes, films, notifications, social, profil public — fini les spinners
infinis / faux « vide ». Coche optimiste depuis « À VOIR ». « Partager » via Web Share
API sur la web app. Notif → film ouvre la bonne fiche (`mediaType` en métadonnées).
**Explorer** : viviers dédiés par catégorie (tendances + découverte + vivier animé
genre 16/ja) et plafond équilibré ~22/catégorie → « Animés » passe de 3 à ~20 items.
Barre catégories + ↻ collante ; cartes du flux cochées après ajout (lots précédents).
**Réglages compte** : suppression de compte réelle (route `DELETE /api/auth/account` +
modale de confirmation), changement de mdp, export JSON ; retrait des boutons morts.
Profil : carte « temps films » ajoutée.
**Infra** : rotation des logs Docker, cache Nginx 1 an sur `/_expo/`, cron healthcheck
(relance si KO), CI proposée (`docs/proposed-ci-workflow.yml`).
Typecheck mobile + serveur, 74 tests verts. Déployé et vérifié en prod.

### 2026-07-08 (matin) — Claude (avec Benjamin)
Retours d'usage de la première vraie session + finitions web app :
- **Explorer : pull-to-refresh** (`RefreshControl`) et **flux renouvelé à chaque tirage**
  côté serveur (page de tendances TMDb aléatoire + mélange + échantillon aléatoire des
  recommandations). Dédoublonnage étendu au **titre normalisé** (même œuvre sous
  plusieurs ids TMDb selon la plateforme).
- **Explorer : filtres par catégorie** TOUT / SÉRIES / FILMS / ANIMÉS (animé = animation
  TMDb d'origine japonaise, étiquetée côté serveur) + **bouton ↻** — indispensable sur le
  web où le geste « tirer pour rafraîchir » n'existe pas. Pool de tendances élargi à 18.
- **« À VOIR » / « À VENIR » : écran d'erreur dédié** (« Impossible de charger » +
  RÉESSAYER) quand la requête échoue — iOS suspend le réseau de la web app au réveil et
  l'échec s'affichait comme un faux « aucun épisode à venir ». Le 401 ne purge plus la
  session quand aucun jeton n'avait été envoyé (course à la réhydratation du store).
- **Coche épisode instantanée** : mises à jour optimistes TanStack Query sur épisode
  vu/non-vu et « tout marquer vu » (rollback si l'API échoue).
- **Sondage de la fiche série** : choix multiples.
- **Titres de saisons/arcs tronqués** (`numberOfLines`) — plus de débordement sur
  One Piece.
- **Vignettes d'épisodes** : repli sur l'affiche de la série quand l'épisode n'a pas
  encore d'image (épisodes non diffusés) + **badge « À VENIR · date »** dans la liste
  des épisodes ; l'onglet « À VENIR » affiche désormais les images (la carte ignorait
  l'image même quand elle existait).
- **Session absente/expirée (401)** : déconnexion + redirection automatique vers l'écran
  de connexion (fini les écrans « aucun résultat » de la web app épinglée) + garde sur
  le groupe d'onglets. Au passage, les erreurs de connexion affichent à nouveau le bon
  message (« E-mail ou mot de passe incorrect ») au lieu de « Connexion impossible ».
- **Web app** : `app/+html.tsx` (metas iOS : icône d'écran d'accueil, titre, plein
  écran, `theme-color`), `public/apple-touch-icon.png`, export **statique**
  (`web.output: "static"`) ; le store persiste via un stockage inerte pendant le rendu
  statique (l'export plantait sur AsyncStorage sans `window`).
- **Config de déploiement** : `mobile/app.config.js` — l'URL du serveur se bake via
  `SERIETIME_SERVER_URL` au moment de l'export, `app.json` reste vierge (le dev local
  d'Étienne garde l'écran « URL du serveur ») ; `docker-compose.prod.yml` versionné.
- Typecheck mobile + serveur verts, 74 tests verts.

### 2026-07-08 — Claude (2)
- **Police Rubik** partout (native + web) : la plus proche de la géométrique
  arrondie de TV Time parmi les polices libres ; graisses embarquées
  (regular→extraBold), règle « fontFamily, jamais fontWeight » dans CLAUDE.md.
- **Écran « Modifier le profil » conforme à TV Time** : Sexe et Pays en valeurs
  bleues avec **menus déroulants** (liste des pays en toutes lettres,
  `lib/countries.ts`), fin du champ code ISO.
- Règles d'équipe documentées dans CLAUDE.md : un seul code pour app native et
  web app (redéployer l'export web après fusion), design = copie fidèle de
  TV Time (aucune liberté, comparer aux captures de référence).

### 2026-07-08 — Claude
- **Sauvegarde du profil fiabilisée** : la photo de profil est compressée côté
  app (512 px ≈ 100 Ko via expo-image-manipulator) — les photos brutes en
  base64 pouvaient dépasser la limite serveur (413) et échouer **en silence** ;
  un message d'erreur s'affiche désormais en cas d'échec.
- **Passe design TV Time (profil)** : compteurs sociaux dans l'en-tête
  (abonnements / abonnés / commentaires, tap → écran social), cœur en pastille
  rouge avant « Séries/Films préférés », carte Listes en collage d'affiches
  avec titre en surimpression et points de pagination, suppression des bords
  gris autour des affiches (bug du composant Poster), coins plus arrondis
  (cartes 8, affiches 6), vignette de la file À voir élargie.

### 2026-07-08 — Benjamin (avec Claude)
- **Déploiement production** sur le VPS Hostinger de Benjamin : conteneur Docker isolé
  (plafonds 512 Mo RAM / 1 CPU, port bindé sur 127.0.0.1), Nginx en frontal, HTTPS
  Let's Encrypt auto-renouvelé → **https://serietime.studio-vives.fr** (`/health` OK).
- **Web app** : export Expo web (`npx expo export -p web`) servi par Nginx à la racine
  du domaine, `/api` + `/health` proxifiés vers le conteneur (même origine, pas de CORS).
  Validée sur iPhone (Safari + icône écran d'accueil) et testée de bout en bout
  (inscription, recherche, ajout de série).
- **Clé TMDb configurée en prod** → tendances/recommandations Explorer + images films actifs.
- **Sauvegarde automatique de la base** : cron quotidien 4 h 30 (`sqlite3 .backup` + gzip,
  rotation 14 jours) sur le VPS.
- **Correctif feed Explorer** (`apps/server/src/modules/search/routes.ts`) : les médias
  ajoutés via TheTVDB (sans `tmdbId`) n'étaient jamais reconnus comme « déjà dans la
  bibliothèque » et réapparaissaient dans les recommandations/tendances. Le filtre
  compare désormais aussi type + titre normalisé (+ année quand connue des deux côtés),
  pour la bibliothèque comme pour les « non appréciés ». Typecheck + 74 tests verts.
- Pièges web app iOS documentés : stockage séparé Safari/icône (se connecter dans la
  web app), créer l'icône depuis la racine du site, Brave Shields bloque les affiches.

### 2026-07-07 — Claude
- **Édition de profil** (écran `/profile/edit`) : photo de profil (upload via
  expo-image-picker → data URL), photo de couverture (recherche + bannières
  TheTVDB de n'importe quelle œuvre via `/profile/cover`), nom, année de
  naissance, sexe, pays. Avatar et couverture affichés sur l'en-tête du profil.
- **Correctif majeur d'affichage des affiches** : le composant `Poster`
  n'affichait jamais l'image (rendait `null` quand une URL existait) → toutes
  les affiches restaient grises/noires. Corrigé (partout : profil, films, etc.).
- **Profil : les 4 sections** (Séries, Séries préférées, Films, Films préférés)
  sont **toujours affichées**, avec un état vide quand rien n'est ajouté.
- Invalidation de `['profile']` après favori/personnalisation → les favoris et
  changements d'affiche apparaissent immédiatement.
- `tmdbImage` laisse passer les URL `data:` (avatars base64).
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
