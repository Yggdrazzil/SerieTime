# Matrice de parité fonctionnelle — refonte Prisme

> Source de vérité fonctionnelle pour la refonte du front PlotTime.
> Dernier audit : **2026-07-17** (`main@c148ed8`).

## Règles de validation

- Le dépôt et les comportements réellement câblés priment sur les maquettes.
- Une route historique reste accessible pendant et après la migration, même si elle
  n'est plus une destination principale.
- Une ligne ne passe à `Vérifié` qu'après contrôle des données lues/écrites, des
  erreurs, du retour, du deep link, du chargement et de l'état vide.
- Les trois familles de médias restent accessibles : série/animé, film et jeu.
- Les données fictives et les interactions inertes du prototype ne sont jamais
  introduites dans le produit.
- Aucun endpoint, contrat d'authentification ou modèle Prisma ne doit changer pour
  une migration purement visuelle.

Statuts : `Inventorié`, `En migration`, `Implémenté`, `Vérifié`, `Bloqué`.

## Routes, parcours et actions

| Domaine | Route ou entrée | Comportement à conserver | Sources principales | API, store ou persistance | États et preuves | Cible Prisme | Statut |
|---|---|---|---|---|---|---|---|
| Démarrage | `/` | Redirige vers l'auth si serveur/session absents, sinon vers les onglets | `mobile/app/index.tsx` | Zustand persisté, `resolvedServerUrl()` | Hydratation et session expirée | Shell inchangé, splash de marque | Inventorié |
| Authentification | `/setup` | URL serveur en développement, connexion, inscription selon configuration, SSO web et natif config-gated | `mobile/app/setup.tsx`, `SsoButtons`, `NativeSsoButtons` | `/health`, `/api/auth/providers`, `/register`, `/login`, `/oauth`; Zustand/AsyncStorage | Validation, provider indisponible, erreur réseau/auth; tests serveur auth | Écran Prisme sans barre basse, CTA et erreurs accessibles | Inventorié |
| Comptes liés | `/linked-accounts` | Affiche les providers, lie/délie Google, Discord et Facebook selon plateforme/config | `mobile/app/linked-accounts.tsx`, `lib/sso*` | `/api/auth/providers`, `/api/auth/link`, `/api/auth/unlink` | État occupé, erreur, dernier mode de connexion; Apple natif à auditer | Sous-page Compte dense | Inventorié |
| Shell privé | `/(tabs)` | Garde d'auth, cinq destinations, re-tap = rafraîchissement/remise à zéro, nouvel accès Explorer = nouveau tirage | `(tabs)/_layout.tsx`, `TabBar.tsx`, `tabReset.ts` | QueryClient, store de reset | Safe areas, Android back, deep links | Accueil, Agenda, Explorer, Bibliothèque, Profil | Implémenté |
| Accueil séries | `/(tabs)/index` — À voir | File groupée, historique masqué au-dessus, retour optimiste vu/non-vu, badges, `+N`, ouverture série et épisode | `(tabs)/index.tsx`, `EpisodeQueueCard`, `EpisodeSheet`, `FloatingSection` | `/api/shows/queue`, `/history`, `/api/episodes/:id/watched|unwatched` | Chargement, refresh, vide, erreur, rollback; tests épisodes serveur | Accueil Prisme + listes Studio | En migration |
| Fiche épisode | Feuille depuis l'accueil et les fiches | Navigation entre épisodes, vu/non-vu, tout le précédent, providers, note communauté, commentaires, ouverture série | `EpisodeSheet.tsx` | `/api/shows/:id/episodes`, `/community-ratings`, `/comments`, mutations épisodes | Double action, erreur, contenu absent | Feuille Prisme 280 ms, action primaire 44 px | Inventorié |
| Agenda séries | `/(tabs)/agenda` | Sorties passées accessibles en remontant, groupes de dates, heure/chaîne, première, épisodes multiples | `agenda.tsx`, `UpcomingView` partagé depuis `index.tsx` | `/api/shows/upcoming` | Chargement, refresh, vide, erreur, date/heure manquante | Agenda Prisme, liste chronologique Studio | Implémenté |
| Films — aperçu historique | `/(tabs)/movies` | Affiche films vus et à voir, ouverture fiche film | `(tabs)/movies.tsx` | `/api/movies` | Route masquée de la barre mais accessible depuis le hub et en deep link | Bibliothèque filtrée Films; route conservée | En migration |
| Jeux — bibliothèque | `/(tabs)/games` | Groupes voulus/en cours/terminés/abandonnés/possédés, découverte, prochaines sorties, ajout IGDB et ouverture fiche | `(tabs)/games.tsx` | `/api/games`, `/discover`, `/upcoming`, `/add-from-igdb` | Route masquée de la barre mais accessible depuis le hub et en deep link | Bibliothèque Jeux + blocs Agenda/Explorer; route conservée | En migration |
| Explorer — recherche média | `/(tabs)/explore` — Séries et films | Recherche débouncée, consultation sans suivi, ajout via TVDb/TMDb, bouton suivre/watchlist | `(tabs)/explore.tsx` | `/api/search`, `/shows|movies/add-*`, `/follow`, `/watchlist` | Saisie vide, chargement, source absente, erreur, déjà suivi | Explorer Prisme, filtre multi-média | Inventorié |
| Explorer — recherche jeux | `/(tabs)/explore` — Jeux | Recherche IGDB, ajout local, ajout wishlist, ouverture fiche | `(tabs)/explore.tsx` | `/api/games/search`, `/add-from-igdb`, `/:id/status` | Résultat local/distant, provider absent, mutation | Explorer Prisme, filtre Jeux | Inventorié |
| Explorer — utilisateurs | `/(tabs)/explore` — Utilisateurs | Recherche, suivre/ne plus suivre, ouverture profil public | `(tabs)/explore.tsx` | `/api/users/search`, `/api/social/follow/:id` | Profil bloqué/privé, mutation optimiste/erreur | Recherche secondaire conservée | Inventorié |
| Explorer — flux | `/(tabs)/explore` — flux vertical | Flux personnalisé séries/films et jeux, description, commentaires, suivi, terminé, masquer/non intéressé | `components/explore/*` | `/api/explore/feed|games`, tracking/watchlist/status/watched/disliked | Rechargement, pagination, résolution média, erreur partielle | Cartes immersives Prisme, gestes et boutons équivalents | Inventorié |
| Hub Bibliothèque | `/(tabs)/library` | Accès explicite aux bibliothèques et favoris Séries, Films et Jeux, avec vrais compteurs globaux | `(tabs)/library.tsx` | `/api/profile` (`stats.showsCount/moviesCount/gamesCount`) | Compteurs en chargement/erreur, refresh, navigation vers routes historiques | Hub Prisme responsive | Implémenté |
| Bibliothèque séries | `/library/shows` | Filtres de statut, tri, progression, ouverture détail | `mobile/app/library/shows.tsx`, `components/library.tsx` | `/api/shows/library` | Chargement, refresh, vide, filtre sans résultat | `/library?type=show`, grille/liste Prisme | Inventorié |
| Bibliothèque films | `/library/movies` | Vu/non vu, tris/filtres, ouverture détail | `mobile/app/library/movies.tsx` | `/api/movies/profile?sort&filter` | Chargement, refresh, vide, erreur | `/library?type=movie`, route historique conservée | Inventorié |
| Favoris séries | `/library/favorite-shows` | Grille favoris, tri persisté, retrait, partage et accès réorganisation | `favorite-shows.tsx`, `components/favorites.tsx` | `/api/profile/favorites`, `/api/shows/:id/favorite`, Zustand `favSort` | Optimiste/rollback, vide, erreur | Bibliothèque > Favoris Séries | Inventorié |
| Favoris films | `/library/favorite-movies` | Même comportement adapté aux films | `favorite-movies.tsx`, `components/favorites.tsx` | `/api/profile/favorites`, `/api/movies/:id/favorite`, `favSort` | Optimiste/rollback, vide, erreur | Bibliothèque > Favoris Films | Inventorié |
| Favoris jeux | `/library/favorite-games` | Affichage et ouverture des jeux favoris | `favorite-games.tsx` | `/api/profile/favorites?type=game` | Chargement, vide, erreur; capacités moindres à documenter | Bibliothèque > Favoris Jeux | Inventorié |
| Réordre favoris | `/library/reorder-favorites?type=` | Glisser-déposer et sauvegarde de l'ordre par type | `reorder-favorites.tsx`, `DragGrid.tsx` | `/api/profile/favorites/reorder`, Zustand | Type invalide, mutation/rollback | Mode édition Bibliothèque | Inventorié |
| Détail série | `/show/[id]` | Consultation sans suivi; bannière/affiche, à propos, épisodes, casting, similaires, communauté, listes, personnalisation, partage, signalement, favori, watch later, abandon, suppression | `mobile/app/show/[id].tsx` | `/api/shows/:id` et sous-routes, listes, report, tracking | Média externe/local, image absente, mutation optimiste, erreur; nombreux tests serveur | Fiche MediaDetail Prisme + épisodes Studio | Inventorié |
| Détail film | `/show/[id]?type=movie` | Même shell adapté : vu/non-vu, watchlist, casting, similaires, listes, personnalisation, partage, signalement, favori, retrait | `mobile/app/show/[id].tsx` | `/api/movies/:id` et sous-routes | Paramètre `type`, média externe/local, erreurs | Fiche MediaDetail Film | Inventorié |
| Détail jeu | `/game/[id]` | Statut, possédé, favori, retrait, affiche/bannière, bande-annonce, identité, extensions, listes, partage, signalement, commentaires et jeux liés | `mobile/app/game/[id].tsx` | `/api/games/:id` et sous-routes, listes, report | IGDB/local, provider absent, mutation/rollback | Fiche MediaDetail Jeu | Inventorié |
| Personne | `/person?mediaId&type&index` | Casting, biographie, filmographie, résolution/ajout du média puis ouverture | `mobile/app/person.tsx` | `/api/:type/:id`, `/api/people/search|:id`, `/add-from-tmdb` | Paramètres invalides, personne sans ID/image | Fiche Personne Prisme | Inventorié |
| Commentaires média | `/comments/[id]?title=` | Fils, réponses, réactions, suppression de ses commentaires, signalement d'autrui, profils publics | `comments/[id].tsx`, `components/comments/*` | `/api/media/:id/comments`, `/comments/:id/react`, `/report` | Modération bloquante, envoi vide/double, erreur, pagination future | Discussion Studio + composeur safe-area | Inventorié |
| Profil | `/(tabs)/profile` | Couverture/avatar, niveau, édition, notifications, réglages, compteurs sociaux, stats, trophées, listes, collections et favoris des 3 médias | `(tabs)/profile.tsx` | `/api/profile`, `/notifications/unread-count`, `/gamification/me`, Zustand favoris | Chargement, refresh, erreur, valeurs absentes | Profil Prisme enrichi, sans perte de sections | Inventorié |
| Édition profil | `/profile/edit` | Avatar compressé, nom, naissance, genre, pays, accès couverture, sauvegarde | `profile/edit.tsx` | `/api/profile`, image picker/manipulator | Permission refusée, image trop grande, erreur sauvegarde | Formulaire Prisme | Inventorié |
| Couverture profil | `/profile/cover` | Recherche d'œuvre, récupération des bannières, sélection et retour | `profile/cover.tsx` | `/api/search`, `/add-*`, `/images`, profil | Debounce, vide, provider absent, image absente | Sélecteur visuel Prisme | Inventorié |
| Profil public | `/user/[id]` | Suivre, bloquer/débloquer, confidentialité, réputation, trophées, stats, favoris/récents, navigation médias | `user/[id].tsx` | `/api/users/:id`, `/follow`, `/block` | Soi-même, privé, bloqué, erreur | Profil public Prisme | Inventorié |
| Connexions | `/social/connections?type=following|followers` | Listes, suivre/ne plus suivre, ouverture profils | `social/connections.tsx` | `/api/social/following|followers`, `/follow/:id` | Paramètre invalide, vide, erreur | Liste Studio | Inventorié |
| Mes commentaires | `/social/my-comments` | Historique personnel et ouverture du média | `social/my-comments.tsx` | `/api/social/comments` | Vide, média supprimé, erreur | Activité Profil | Inventorié |
| Fil social | `/social` | Activité des comptes suivis, onglet trouver des amis, profils et médias | `mobile/app/social.tsx` | `/api/social/feed`, `/users/search`, `/follow/:id` | Route actuellement peu exposée, vide, erreur | Profil > Activité/Communauté | Inventorié |
| Notifications | `/notifications` | Liste in-app, marquage lu, badge, deep links vers série/film/jeu | `notifications.tsx` | `/api/notifications`, `/read` | Vide, métadonnées partielles, erreur; polling 30 s | Centre Prisme groupé chronologiquement | Inventorié |
| Statistiques | `/stats` | Temps, volumes, répartitions, comparaison/classement, accès badges | `stats/index.tsx` | `/api/stats/detailed` | Chargement, valeurs nulles, erreur | Cartes Prisme + résumé accessible | Inventorié |
| Badges statistiques | `/stats/badges` | Badges obtenus/verrouillés et progression | `stats/badges.tsx` | `/api/stats/badges` | Vide, erreur | Trophées Prisme regroupés | Inventorié |
| Classements statistiques | `/stats/leaderboard` | Comparaison au classement | `stats/leaderboard.tsx` | `/api/stats/leaderboard` | Profil absent, égalités, erreur | Classement Studio | Inventorié |
| Trophées | `/trophies` | Niveau/XP, streak, défis mensuels, badges à paliers, classement hebdomadaire | `trophies.tsx`, `useGamificationToasts.ts` | `/api/gamification/me`, `/leaderboard` | Chargement, toast global, progression | Hub Trophées Prisme | Inventorié |
| Import TV Time | `/import` | Sélection ZIP web, upload/analyse, polling, confirmation, reprise du dernier import | `mobile/app/import.tsx` | `/api/import/tvtime/*` | Mauvais type/taille, doublon, échec partiel, progression | Assistant Prisme; natif à traiter séparément | Inventorié |
| Réglages — compte | `/settings` | Profil privé, Steam, resynchronisation séries, comptes liés, mot de passe/réauth SSO, suppression compte, déconnexion | `settings.tsx` | `/api/profile`, `/games/steam/import`, `/shows/resync-all`, `/auth/*` | Confirmations, provider absent, danger | Sections Studio | Inventorié |
| Réglages — données | `/settings` | Export JSON et import/restauration selon plateforme, import TV Time | `settings.tsx` | `/api/backup/export`, API d'import | Téléchargement web, natif actuellement limité, fichier invalide | Section Données Prisme | Inventorié |
| Réglages — préférences | `/settings` | Langue, thème, contenu 18+, notifications et préférences exposées, cache | `settings.tsx`, `lib/theme.ts` | `/api/settings`, localStorage thème, `/api/cache/clear` | Optimiste/rollback, iOS 18+, serveur indisponible | Sections Apparence/Contenu/Notifications | Inventorié |
| Réglages — légal | `/settings` + `/legal/*` | Confidentialité, CGU, suppression de compte, attributions TMDb/TVDb/IGDB | `settings.tsx`, serveur `modules/legal` | Pages publiques HTML | Ouverture externe, hors connexion | À propos Prisme | Inventorié |
| Gamification globale | Toutes routes privées | Toast niveau/badge et invalidation après actions de suivi | `_layout.tsx`, `useGamificationToasts.ts` | `/api/gamification/me`, QueryClient | Réduction des animations, doublons | Toast/undo Prisme | Inventorié |
| PWA et deep links | Export web et routes Expo | Manifest, icônes, même origine API, routes rechargeables, safe areas | `+html.tsx`, `public/manifest.json`, Expo Router | localStorage/AsyncStorage, URL serveur | Zoom, text scaling et focus clavier implémentés ; pas de service worker/offline actuellement | Shell responsive 320–desktop | En migration |

## Dette préexistante observée pendant l'audit

Ces éléments ne doivent pas être attribués à la refonte. Ils seront corrigés dans
des lots séparés quand cela ne change pas le produit attendu.

- Les actions de saison utilisent un test de vérité sur `seasonNumber` : la saison
  `0` peut envoyer `{}` et viser toutes les saisons.
- Le client accepte un mot de passe de 6 caractères alors que le serveur en exige
  8, ce qui crée une validation contradictoire.
- Les activités et commentaires liés aux jeux sont routés à tort vers `/show` au
  lieu de la fiche jeu.
- Les signalements peuvent être affichés comme réussis même lorsque la requête
  réseau échoue.
- Les invalidations de cache après mutation sont incomplètes entre jeux, profil et
  gamification.
- Plusieurs longues listes utilisent des `ScrollView` non virtualisées et chaque
  item peut enregistrer son propre listener de réduction des mouvements.
- Des éléments visibles ou techniques hérités de SerieTime/TV Time restent à
  rebrander (`Ordre TV Time`, page OAuth, noms d'export). Le scheme et les clés de
  stockage historiques ne doivent toutefois pas être renommés sans migration et
  maintien de compatibilité.
- L'import TV Time est effectivement sélectionnable sur le Web seulement, ne
  propose pas l'interface de résolution manuelle décrite dans la documentation et
  n'invalide pas tous les caches après confirmation.
- Les archives ZIP envoyées pour l'import TV Time ne sont pas purgées après
  traitement.
- Le client mobile appelle l'export de sauvegarde en `GET` alors que le serveur
  l'expose en `POST`, ce qui produit une 404 en production ; le partage de
  l'export et la restauration ne sont pas disponibles correctement sur natif.
- L'écran de comptes liés est très incomplet sur natif et ne gère pas Apple.
- Les listes personnalisées affichées sur le profil ne sont pas ouvrables et ne
  disposent pas d'un écran de gestion complet.
- Les favoris jeux n'ont pas encore la parité d'actions des favoris séries/films.
- Le fil `/social` est difficilement atteignable depuis la navigation actuelle.
- Le blocage social fonctionne comme un mute unidirectionnel et laisse possibles
  certaines interactions ou notifications entre comptes bloqués.
- Les notifications exploitent peu `actorId`/`commentId` et redirigent surtout vers
  le média.
- La politique de confidentialité doit être réalignée avec les tiers réellement
  utilisés et les durées effectives de conservation.
- Le thème choisi explicitement est réellement persisté sur le Web seulement ; le
  natif suit le système.
- Le Web désactivait le zoom/text scaling ; ce point est corrigé dans le socle
  Prisme, avec focus clavier visible.
- Il n'existe ni tests de composants/front, ni lint front, ni E2E versionné ; le
  mobile est hors du workspace `pnpm` racine.
- La PWA n'a ni service worker, ni cache hors-ligne, ni file de mutations différées.

## Contrôles transverses avant passage à `Vérifié`

- Cibles tactiles de 44 × 44 px minimum et focus visible sur Web.
- Contrastes WCAG AA ; rose et jaune réservés aux accents, pas aux petits textes
  blancs sans surface de contraste.
- `prefers-reduced-motion` respecté sans supprimer une fonction de rafraîchissement.
- Largeurs 320, 360, 390, 430, 768 et desktop ; clavier et safe areas.
- Mutation optimiste avec rollback, blocage des doubles soumissions et message
  d'erreur récupérable.
- Titre long, image absente, date inconnue, contenu partiel et session expirée.
- Retour Android, geste iOS, re-tap d'onglet, restauration de filtre et deep link.
