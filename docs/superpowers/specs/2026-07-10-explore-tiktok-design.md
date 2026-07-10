# Explorer « TikTok » — spec de conception

Date : 2026-07-10 · Branche : `feat/explore-tiktok`

## Objectif

Refondre l'onglet **Explorer** (`mobile/app/(tabs)/explore.tsx`) en un **flux vertical
plein écran façon TikTok**, unique et épuré, avec une dimension **sociale / gamifiée**
(compteurs de likes, de « déjà vu », de commentaires visibles sur chaque œuvre).

Étienne n'était pas convaincu de la version actuelle (bascule PARCOURIR liste + deck
Tinder à swipes). On remplace **tout** ça par une expérience TikTok pure.

Référence visuelle : capture TikTok fournie par Benjamin (barre de recherche en haut,
média plein écran, rail d'actions vertical à droite avec compteurs, légende auteur en
bas-gauche, barre « Ajouter un commentaire » en bas).

## Décisions actées (cadrage)

| Sujet | Décision |
|---|---|
| Périmètre | **Un seul Explorer**, TikTok pur. On supprime PARCOURIR (liste) **et** le deck Tinder. |
| Gestes | **Pas de swipe latéral.** Défilement vertical uniquement (haut/bas), paging plein écran. |
| Média | **V1 = image plein écran** (backdrop, fallback poster). Autoplay trailer = V2 (hors scope). |
| Actions rail | like · dislike · déjà vu · commentaire · partager. |
| Compteurs | Sur **like, commentaire, déjà vu**. Portée = **toute l'app** (tous les utilisateurs). |
| « Like » | = ajoute à « À voir » (watchlist). Cœur plein quand l'œuvre est dans ma watchlist. |
| Tap média | Développe/replie un overlay semi-transparent de description (+ « Voir la fiche »). |
| Filtres catégories | Conservés en rangée de pastilles fine, semi-transparente, sous la barre de recherche. |

## Rappel du modèle existant (source de vérité)

- Flux : `GET /api/explore/feed` renvoie `{ feed: FeedItem[] }`. Chaque item :
  `{ id, tmdbId, tvdbId, type: 'show'|'movie', category?, title, year, posterPath, backdropPath, overview, inLibrary }`.
  `id` est `null` tant que le média n'a pas de ligne locale (recommandation TMDb pure).
- Résolution d'un item en `mediaId` local : `POST /api/shows/add-from-tmdb` ou
  `/api/movies/add-from-tmdb` avec `{ tmdbId, follow: false }` → `{ mediaId }`.
- Statuts (`UserMediaStatus.status`, string) : `not_started`, `watchlist`, `watching`,
  `paused`, `completed`, `abandoned` (+ `isFavorite`, `isHidden` booléens).
- **Like / À voir** = `status = 'watchlist'` (films : `POST /api/movies/:id/watchlist` ;
  séries : `POST /api/shows/:id/watchlater`, qui pose aussi `watchlist`).
- **Déjà vu** : films = `POST /api/movies/:id/watched` → `status='completed'`. Séries =
  `POST /api/shows/:id/mark-all-watched` (marque les **épisodes** `watched`, ne pose pas
  `completed` sur le média).
- **Dislike / Pas intéressé** = `POST /api/disliked/:mediaId { hidden: true }` → `isHidden`.
- **Commentaires** : `GET /api/media/:id/comments`, `POST /api/media/:id/comments`,
  réactions `POST /api/comments/:id/react`.
- **Partage** : helper `share()` existant dans `mobile/app/show/[id].tsx:132`
  (web `navigator.share` + natif `Share.share`). À factoriser dans `mobile/lib/`.

## Travail serveur

### 1. Enrichir `/api/explore/feed` avec les compteurs sociaux

Chaque `FeedItem` gagne deux blocs :

```ts
stats: { likes: number; watched: number; comments: number };  // toute l'app
me:    { liked: boolean; watched: boolean };                   // utilisateur courant
```

Agrégation en une passe, après l'assemblage du `feed` (liste déjà plafonnée) :

1. Collecter les `tmdbId` (+ `type`) des cartes.
2. `prisma.media.findMany({ where: { tmdbId: { in }, ... }, select: { id, tmdbId, type } })`
   → map `tmdb:type -> mediaId`.
3. Sur ces `mediaId` :
   - `likes` : `groupBy` `UserMediaStatus` `where status='watchlist'` (count par mediaId).
   - `watched` : `groupBy` `UserMediaStatus` `where status='completed'`.
   - `comments` : `groupBy` `Comment` par `mediaId`.
   - `me.liked` / `me.watched` : `UserMediaStatus` du `request.userId` sur ces mediaId.
4. Réinjecter par `tmdb:type`. Cartes **sans** `Media` local → tout à `0`, `me` à `false`.

Coût : quelques requêtes agrégées sur une liste plafonnée (≈ ≤ 66 items). Acceptable.

### 2. Cohérence du compteur « déjà vu » pour les séries

Le compteur `watched` compte `UserMediaStatus.status='completed'`. Pour que marquer
une **série** « déjà vu » depuis l'Explorer soit compté, l'action Déjà vu (séries)
devra, **en plus** de `mark-all-watched`, garantir une ligne `UserMediaStatus`
`completed` sur le média. Deux options :
- (a) faire poser `completed` par `mark-all-watched` lui-même (attention aux autres écrans) ;
- (b) enchaîner côté client `mark-all-watched` puis `POST /api/shows/:id/status { status: 'completed' }`.

**Choix** : (b) côté client (isolé à l'Explorer, aucun risque de régression ailleurs).

## Travail mobile

### Structure de fichiers

- `mobile/app/(tabs)/explore.tsx` — **coquille** : barre de recherche + résultats de
  recherche (MediaResults / UserResults, **inchangés**) ; en dehors de la recherche,
  monte `<TikTokFeed />`. On **supprime** : `ModeBar`, mode `browse` (liste), deck
  Tinder, `PanResponder`, `fling`/`swipeUp`/`swipeDown`, styles associés.
- `mobile/components/explore/TikTokFeed.tsx` — la `FlatList` verticale + logique flux.
- `mobile/components/explore/TikTokCard.tsx` — une carte plein écran (image, scrim,
  légende, rail, overlay).
- `mobile/components/explore/ActionRail.tsx` — le rail d'actions vertical + compteurs.
- `mobile/components/explore/CommentsSheet.tsx` — bottom sheet commentaires.
- `mobile/components/explore/DescriptionOverlay.tsx` — overlay de description (tap).
- `mobile/lib/share.ts` — helper `share()` factorisé (extrait de `show/[id].tsx`).

### TikTokFeed

- `FlatList` verticale, `pagingEnabled`, `showsVerticalScrollIndicator={false}`,
  `snapToInterval = hauteur du conteneur` (mesurée via `onLayout`), `decelerationRate="fast"`,
  `getItemLayout` (perf), `initialNumToRender={2}`, `maxToRenderPerBatch={3}`, `windowSize={3}`.
- Chaque item occupe **exactement** la hauteur du conteneur (zone Explorer, tab bar exclue).
  Le média passe **derrière** la barre de recherche (barre en `absolute` + scrim haut).
- **Infini** : `onEndReachedThreshold` ~0.5 → re-`refetch` de `/api/explore/feed` (tirage
  aléatoire) et **append** en dédupliquant (`type:tmdbId`). Garde-fou : si le fetch échoue
  ou ne ramène rien de neuf N fois, afficher un pied « Fin des suggestions · ↻ ».
- `onViewableItemsChanged` → index actif (utile pour prefetch et, plus tard, autoplay V2).
- **Prefetch** : `Image.prefetch` des 2-3 backdrops suivants pour un snap fluide.
- Sur web (export Expo) : `pagingEnabled` vertical fonctionne via react-native-web ;
  à tester (`npx expo start --web`). Molette = défilement page à page.

### TikTokCard

- Fond : `Image` backdrop (`tmdbImage(backdropPath,'w780')` fallback poster `w500`),
  `absoluteFill`. Scrim dégradé bas (lisibilité légende) + léger scrim haut (barre recherche).
- **Légende** bas-gauche : `titre · année · type` (Mulish, `FONTS.x`), overview 2 lignes.
- **Tap** sur le média (hors rail/légende interactifs) → toggle `DescriptionOverlay`.
- État local par carte : overlay ouvert/fermé + infos détaillées lazy.

### ActionRail (droite, bas)

Ordre (haut → bas) :
1. **Miniature poster** (rond/carré arrondi) → `Voir la fiche` (résout mediaId puis
   `router.push('/show/:id')`).
2. **❤️ Like** + compteur `stats.likes`. Actif = `me.liked` (cœur plein). Clic =
   `POST` watchlist (séries `watchlater` / films `watchlist`). **Optimiste** : bascule
   l'icône + incrémente/décrémente le compteur immédiatement, rollback si erreur.
3. **👎 Dislike** (pas de compteur). Clic = résout mediaId + `POST /api/disliked/:id
   { hidden: true }`, puis **avance à la carte suivante** (`scrollToIndex` next).
4. **👁 Déjà vu** + compteur `stats.watched`. Actif = `me.watched`. Clic = films
   `POST /watched` ; séries `mark-all-watched` **puis** `POST /api/shows/:id/status
   { status: 'completed' }`. Optimiste.
5. **💬 Commentaire** + compteur `stats.comments`. Clic = ouvre `CommentsSheet`.
6. **➤ Partager** (pas de compteur). Clic = `share()` (titre + lien fiche).

- Compteurs : format compact FR (`1,2 K`, `13,4 K`) — util `formatCount(n)`.
- Icônes pleines/vives quand l'action est active (feedback gamifié) ; petite animation
  « pop » à l'activation (réutiliser `PopIn` de `components/anim`).
- Chaque action résout le `mediaId` à la volée si `item.id` est `null`
  (`add-from-tmdb {follow:false}`), memoïsé par carte pour éviter les doubles résolutions.

### DescriptionOverlay (tap)

- Panneau semi-transparent glissant sur la moitié basse (réutiliser `SlideUpBar`).
- Contenu : overview complète + genres / réalisation-création / diffusion / casting /
  où-regarder (lazy-load, **même pattern** que le deck actuel : `add-from-tmdb` puis
  `GET /api/(shows|movies)/:id`). Bouton **« Voir la fiche »**.
- Re-tap sur le média ou chevron → referme.

### CommentsSheet

- Bottom sheet (Modal ou `SlideUpBar`) ouvert depuis 💬 ou la barre du bas.
- Résout `mediaId`, `GET /api/media/:id/comments` → liste (avatar, nom, texte, date,
  réactions). Champ de saisie + `POST` pour publier ; la liste se rafraîchit et le
  compteur du rail s'incrémente. Réactions emoji : V1 = lecture seule (afficher les
  compteurs de réactions) ; toggle de réaction = optionnel, à confirmer au plan.
- Réutiliser au maximum le rendu commentaires de la fiche (`show/[id].tsx`) — extraire
  un composant partagé si le code est propre à factoriser.

### Barre « Ajouter un commentaire… »

- Barre fine en bas de chaque écran (comme TikTok), au-dessus de la tab bar. Tap →
  ouvre `CommentsSheet` (focus direct sur la saisie).

### Filtres catégories

- Rangée horizontale de pastilles fine, **semi-transparente**, posée sous la barre de
  recherche (TOUT / SÉRIES / FILMS / ANIMÉS). Filtre le `deck` en mémoire (`category`),
  remet l'index du flux à 0 au changement.

## Compatibilité web (règle produit)

La web app est l'export web du même projet Expo. Tout le code doit fonctionner sur web :
tester le paging vertical, l'overlay, le sheet commentaires et le partage
(`navigator.share`) via `npx expo start --web`. Aucun module natif obligatoire en V1
(pas de vidéo).

## Design / esthétique (règle produit)

- Police **Mulish** via `FONTS.x` (jamais `fontWeight`).
- Rendu fidèle à la capture TikTok : full-bleed, rail à droite avec icône + nombre
  dessous, légende bas-gauche, barre de commentaire en bas.

## Hors scope (V2+)

- Autoplay des bandes-annonces (vidéo/WebView, enrichissement trailer du feed).
- Compteurs « amis uniquement » (portée sociale restreinte).
- Republication / repost façon TikTok.

## Suivi d'avancement

Mettre à jour `docs/AVANCEMENT.md` (tableau « État par domaine » + entrée datée du
Journal) dans le même commit que la fonctionnalité.
