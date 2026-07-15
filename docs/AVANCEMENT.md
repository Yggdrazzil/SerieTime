# État d'avancement — SerieTime

> **Ce fichier est la source de vérité de l'avancement du projet.**
> Merci de le mettre à jour **après chaque modification ou ajout de fonctionnalité** :
> 1. actualiser le tableau « État par domaine » si un statut change ;
> 2. ajouter une entrée datée en tête du « Journal des modifications » (date, auteur, résumé) ;
> 3. déplacer les éléments terminés de « Prochaines étapes » vers le journal.

Dernière mise à jour : **2026-07-15** (Claude) — Jeux vidéo : notifications de sortie + journal V1 (Task 10)

---

## Vue d'ensemble

Application de suivi de séries / animés / films destinée à remplacer TV Time :
app mobile **React Native + Expo** (`mobile/`, npm) + serveur **Fastify + Prisma + SQLite**
(`apps/server/`, workspace pnpm). Design et parcours calqués sur TV Time
(références visuelles : `docs/screenshots/reference/`).

- **Branche de référence : `main`** (à cloner / puller). Le développement passe
  par des branches courtes fusionnées via pull request.
- Tests : `pnpm test` (77 tests au 2026-07-08 : 25 core + 52 serveur).
- Lancement local : voir `README.md` (serveur `pnpm dev:server`, mobile `npx expo start -c`).

## État par domaine

| Domaine | État | Notes |
|---|---|---|
| Authentification multi-comptes (e-mail + mot de passe) | ✅ Fait | Inscription/connexion, sessions 30 j, données isolées par compte (testé) |
| SSO Google / Facebook | ⏸ Préparé, désactivé | Prêt côté serveur (`/api/auth/oauth`) ; nécessite ids OAuth + dev build Expo |
| Contenu séries via TheTVDB | ✅ Fait | Recherche, fiche, saisons/épisodes, titres/synopsis FR, artworks ; clé dans `apps/server/.env` |
| Contenu films / tendances via TMDb | ✅ Fait | Clé TMDb (compte Benjamin) configurée sur le serveur de prod ; flux Explorer et images films actifs |
| File « À voir » / « À venir » | ✅ Fait | Groupes TV Time (pas commencé, à voir, etc.) ; « Regarder plus tard » exclu des deux |
| Fiche série/film façon TV Time | ✅ Fait | Bannière repliable, onglets À PROPOS / ÉPISODES, distribution (fiches acteurs), « également regardé », similaire à, notes de la communauté, page Commentaires dédiée |
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
| Hébergement VPS | ✅ Fait | Prod sur le VPS Hostinger de Benjamin : `https://serietime.studio-vives.fr` (Docker isolé, HTTPS Let's Encrypt, backup DB nocturne) |
| Web app (navigateur / écran d'accueil) | ✅ Fait | Export Expo web servi par Nginx à la racine du domaine (`/api` proxifié) ; utilisable iPhone + Android sans store |
| Distribution native (APK / stores) | ⏳ Optionnel | EAS Build documenté dans le README ; la web app couvre déjà l'usage quotidien |
| Jeux vidéo — modèle de données | ✅ Fait | Table `Game` (plateformes, développeur, éditeur, modes, Steam App ID, DLC) + `Media.igdbId` + `UserMediaStatus.playtimeMinutes` (migration `add_games`) |
| Jeux vidéo — provider IGDB | ✅ Fait | `apps/server/src/services/igdb/` : auth Twitch (client credentials, cache mémoire), requêtes Apicalypse avec cache `ApiCache`, mapper `igdbToMedia` |
| Jeux vidéo — module API | ✅ Fait | `apps/server/src/modules/games/routes.ts` : `GET /api/games/search`, `POST /api/games/add-from-igdb`, `GET /api/games` (bibliothèque groupée par statut wishlist/playing/completed/abandoned), `POST /api/games/:id/status`, `GET /api/games/:id` (enrichissement paresseux), `GET /api/games/discover`, `GET /api/games/upcoming`, `POST /api/games/steam/import`, `DELETE /api/games/:id/tracking` |
| Jeux vidéo — onglet Jeux (mobile) | ✅ Fait | `mobile/app/(tabs)/games.tsx` : bibliothèque par statut, recherche IGDB, carrousels « Populaires »/« À venir » (découverte, tap = ajoute + ouvre la fiche), « Sorties à venir » (jeux suivis, groupés par mois) |
| Jeux vidéo — connexion Steam (mobile) | ✅ Fait | Bloc « Jeux — Steam » dans `mobile/app/settings.tsx` (onglet Compte) : SteamID/URL de profil → import bibliothèque possédée |
| Jeux vidéo — fiche jeu (mobile) | ✅ Fait | `mobile/app/game/[id].tsx` : miroir simplifié de la fiche série (jaquette, infos, sélecteur de statut wishlist/playing/completed/abandoned, temps de jeu, commentaires), suivi optimiste avec rollback |
| Jeux vidéo — notifications de sortie | ✅ Fait | Passe du worker de fond (`apps/server/src/services/sync-worker.ts`) : `Notification` de type `game_release` quand `Media.releaseDate` d'un jeu suivi (non masqué) tombe aujourd'hui, dédupliquée par `(userId, mediaId, type)` |

## Prochaines étapes (par priorité)

0. **Retours Benjamin (08/07 aprem)** :
   - **Barre de progression** sur les séries/animés (façon TV Time : mince barre
     épisodes vus / total sous les cartes « À voir » et sur le profil). Données
     watchedCount/totalCount à exposer côté serveur.
   - **Explorer façon TikTok/Tinder** : suggestions en plein écran, image du média,
     description en surimpression au tap, scroll vertical pour changer de suggestion,
     swipe droite = « À voir » (watchlist), swipe gauche = « Pas intéressé »
     (`/api/disliked`, `isHidden` — déjà en place). Gros chantier UI (gestes en web
     app), backend prêt.
1. Option « Ne plus suivre » / gestion fine depuis les listes du profil (l'API existe : `DELETE /api/shows/:id/tracking`).
4. Notifications push (quand on passera au dev build Expo).
5. SSO Google/Facebook (ids OAuth à créer, dev build requis).
6. Publication native optionnelle (EAS Build APK, puis stores).

## Journal des modifications

> Entrée type : `### AAAA-MM-JJ — Auteur` puis une liste courte de ce qui a changé.

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
