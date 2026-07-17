# Refonte front Prisme — audit et plan directeur

> Plan de migration établi le **2026-07-17** depuis le code de
> `PlotTime-Team/PlotTime-Refonte`, l'application publique et le kit
> `kit-refonte-front-prisme.zip`.

## Décision de conception

La direction retenue est **Prisme**, enrichie de la densité **Studio** pour les
files, épisodes, réglages, commentaires, notifications et classements.

Le prototype est une intention graphique, pas une implémentation : seules les
bascules concept/écran/média, la navigation basse et la coche « vu » y sont
câblées. La cloche, l'avatar, les cartes, le tri, le calendrier, le micro et la
plupart des actions y sont inertes. Ses données de démonstration, son faux
téléphone et le sélecteur Prisme/Cinéma/Studio sont exclus du produit.

Ordre de priorité appliqué :

1. code et contrats réels pour les fonctionnalités ;
2. présente matrice pour la non-régression ;
3. spécification du kit pour l'architecture UX ;
4. maquettes Prisme pour la composition ;
5. captures historiques uniquement pour détecter une information perdue.

## État technique audité

- Front unique Expo 54 / React Native 0.81 / Expo Router pour Web, Android et iOS.
- TanStack Query pour le cache serveur, Zustand + AsyncStorage pour la session et
  quelques préférences.
- Serveur Fastify 4 / Prisma 5 / SQLite, 33 modèles et environ 132 routes dont
  trois pages légales publiques.
- Production joignable : `/health` répond PlotTime 1.0.0 ; TVDb et TMDb sont
  actifs ; les routes privées refusent bien une requête sans jeton.
- PWA installable mais sans service worker ni mode hors-ligne.
- Aucun changement de schéma, endpoint ou authentification n'est requis par la
  refonte.

## Architecture cible sans casser les routes

| Destination cible | Rôle | Héritage conservé |
|---|---|---|
| Accueil | Reprendre rapidement et marquer vu | File et historique de `/(tabs)/index` ; accès aux fiches et EpisodeSheet |
| Agenda | Séries, films et jeux datés ou à confirmer | Vue À venir actuelle + sorties jeux ; ancienne vue toujours atteignable |
| Explorer | Recherche et découverte multi-média/utilisateurs | Recherche, flux personnalisé, actions suivre/terminer/masquer |
| Bibliothèque | Collection et favoris par média/statut | Anciennes routes Séries, Films, Jeux et `/library/*`, avec filtre initial |
| Profil | Identité, stats, trophées, social et réglages | Toutes les sections et routes profondes actuelles |

Les anciens chemins restent enregistrés. Les onglets `movies` et `games` peuvent
devenir des routes masquées de la barre principale, jamais des écrans supprimés.
Un deep link historique ouvre la vue équivalente et son filtre, sans effacer la
position ou un formulaire en cours.

## Système visuel Prisme

### Couleurs sémantiques

- primaire : violet `#6D4ED1` ; interaction et focus ;
- secondaire : rose `#EF5BA8` ; accent illustratif/notification ;
- tertiaire : jaune `#F3C54F` ; accent et contexte, jamais petit texte blanc ;
- fond : `#F7F5FA`, surface `#FFFFFF`, surface subtile `#EEEAF2` ;
- texte : `#201A24`, secondaire `#736B78` ;
- succès `#277A53`, avertissement `#9A6500`, danger `#B5294A`, info `#2D65A8`.

Les contrastes du prototype sont corrigés : le violet sur blanc est utilisable,
mais le rose et le jaune ne portent pas de petit texte blanc. Les bordures et les
états sélectionnés ne reposent jamais sur la couleur seule.

### Géométrie, rythme et mouvement

- grille d'espacement : 4, 8, 12, 16, 20, 24, 32 ;
- rayons : 8, 12, 18, 24 et pilule ;
- cible tactile : 44 px minimum, CTA principal 48 px ;
- cartes prioritaires généreuses, listes Studio avec séparateurs fins ;
- press/focus 160 ms, sélection/progression 200 ms, feuille 280 ms ;
- courbe `(0.2, 0, 0, 1)` ; ressort réservé aux confirmations utiles ;
- mouvement réduit : transitions neutralisées, fonctions conservées.

Les icônes existantes Expo Vector Icons sont réutilisées. Le fichier Lucide du
prototype n'est pas ajouté au bundle.

### Primitives à introduire

- `AppShell`, `TopAppBar`, `BottomNavigation` ;
- `ScreenHeader`, `SectionHeader`, `SegmentedFilter` ;
- `FeatureCard`, `MediaRow`, `PosterCard`, `EpisodeRow` ;
- `PrimaryAction`, `IconAction`, `StatusBadge`, `ProgressBar` ;
- `StatCard`, `TrophyCard`, `SettingsSection`, `SettingsRow` ;
- `Skeleton`, `EmptyState`, `ErrorState`, `OfflineState`, `UndoToast` ;
- feuille/confirmation partagée avec protection contre les doubles actions.

## Extension aux écrans absents des maquettes

- **Auth/setup** : shell clair sans navigation basse, progression explicite,
  validation près du champ, CTA fixe au-dessus de la safe area et import visible.
- **Fiches média** : en-tête partagé avec backdrop/poster, retour, favori,
  partage et menu ; action primaire et progression ; série avec lignes d'épisodes
  Studio, film et jeu avec leurs seules données réelles.
- **Réglages** : sections denses, lignes de 44 px, danger isolé, sous-pages avec
  retour ; aucune préférence actuellement visible n'est retirée.
- **Stats/trophées** : synthèse Profil puis pages dédiées, progression textuelle,
  catégories Débloqués/En cours/Verrouillés et iconographie PlotTime originale.
- **Social/commentaires** : compteurs conservés, listes d'utilisateurs compactes,
  composeur compatible clavier, modération et blocage inchangés.
- **Notifications** : badge et état lu non transmis par la couleur seule, groupes
  chronologiques et deep links robustes.
- **Import** : Source → fichier → analyse → confirmation → progression → bilan ;
  aucun écrasement silencieux.

## Lots de migration et portes de sortie

### Lot 0 — audit et référence

- matrice complète ;
- baseline typecheck/tests/export ;
- dette préexistante distinguée des régressions ;
- aucun code métier modifié.

### Lot 1 — tokens, accessibilité et primitives

- rôles Prisme ajoutés sans supprimer immédiatement les anciens rôles ;
- primitives et états partagés ;
- réactivation du text scaling/zoom avec correction des débordements ;
- tests unitaires des helpers visuels et contrôle de typage/export.

### Lot 2 — shell et navigation

- cinq destinations cibles ;
- routes historiques conservées ;
- safe areas, re-tap, reset et invalidations existantes préservés ;
- Agenda et Bibliothèque initialisés avec les vraies APIs.

### Lot 3 — Accueil et Agenda

- file prioritaire Prisme + listes Studio ;
- vu/non-vu, historique, badges, `+N`, feuille épisode et rollback inchangés ;
- agenda chronologique, dates inconnues et sorties jeux.

### Lot 4 — Explorer et Bibliothèque

- recherche multi-média/utilisateurs et flux immersif ;
- filtres Séries/Films/Jeux et statuts ;
- favoris, tri, réordre et anciennes routes accessibles.

### Lot 5 — Profil, social, stats et réglages

- profil complet, édition, couverture, listes/favoris ;
- profils publics, connexions, commentaires, notifications ;
- statistiques, trophées, import/export et tous les réglages.

### Lot 6 — fiches et finitions

- shell partagé série/film/jeu sans réduire leurs capacités spécifiques ;
- casting, listes, personnalisation, communauté et modération ;
- performance, accessibilité, responsive, réduction de mouvement et deep links.

Chaque lot : matrice mise à jour, contrôle de typage, tests pertinents, export Web,
inspection aux largeurs cibles, commit autonome et publication sur `origin/main`
selon l'instruction de travail actuelle.

## Référence de validation

- Le typecheck mobile passe sur le commit audité.
- Les **158 tests de logique pure du package core** passent.
- Une passe ciblée de **15 tests serveur sans migration Prisma** passe également.
- Sous Windows, la suite serveur globale échoue au niveau du moteur Prisma avant
  que ses **27 suites** puissent s'exécuter, y compris avec un worker unique ; ce
  défaut d'environnement ne doit pas être attribué à la refonte.
- Aucun test de composant ou E2E front n'est actuellement versionné : ils seront
  ajoutés autour des actions les plus sensibles au fil de la migration.
- `npm audit` signale 14 vulnérabilités modérées dans l'arbre Expo installé ;
  elles ne sont pas corrigées automatiquement pendant une refonte visuelle.

## Risques hors refonte à garder visibles

- credentials SSO natifs encore incomplets en production (Google iOS/Android
  vides ; redirect Discord à valider en build) ;
- jeton stocké dans AsyncStorage plutôt que SecureStore sur natif ;
- appels externes sans timeout uniforme et cache serveur global peu borné ;
- préférences serveur exposées mais partiellement consommées ;
- le client mobile appelle l'export de sauvegarde en `GET` alors que le serveur
  l'expose en `POST`, ce qui produit une 404 en production ; le partage de
  l'export et la restauration ne sont pas disponibles correctement sur natif ;
- les archives ZIP envoyées pour l'import TV Time ne sont pas purgées après
  traitement ;
- la politique de confidentialité doit être réalignée avec les tiers réellement
  utilisés et les durées effectives de conservation ;
- le blocage social fonctionne comme un mute unidirectionnel et laisse possibles
  certaines interactions ou notifications entre comptes bloqués ;
- infrastructure VPS et redéploiement Web gérés hors du dépôt.
