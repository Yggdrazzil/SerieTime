# État d'avancement — SerieTime

> **Ce fichier est la source de vérité de l'avancement du projet.**
> Merci de le mettre à jour **après chaque modification ou ajout de fonctionnalité** :
> 1. actualiser le tableau « État par domaine » si un statut change ;
> 2. ajouter une entrée datée en tête du « Journal des modifications » (date, auteur, résumé) ;
> 3. déplacer les éléments terminés de « Prochaines étapes » vers le journal.

Dernière mise à jour : **2026-07-09** (Claude) — vague d'animations 4 : recherche/Explorer, réglages, social, notifications, films, profils

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
| Hébergement VPS | ✅ Fait | Prod sur le VPS Hostinger de Benjamin : `https://serietime.studio-vives.fr` (Docker isolé, HTTPS Let's Encrypt, backup DB nocturne) |
| Web app (navigateur / écran d'accueil) | ✅ Fait | Export Expo web servi par Nginx à la racine du domaine (`/api` proxifié) ; utilisable iPhone + Android sans store |
| Distribution native (APK / stores) | ⏳ Optionnel | EAS Build documenté dans le README ; la web app couvre déjà l'usage quotidien |

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
