# Commentaires par épisode — Design

**Date :** 2026-07-23
**Auteur :** Claude / Benjamin
**Statut :** validé (design), prêt pour le plan d'implémentation

## Objectif

Permettre de commenter **un épisode précis** (pas seulement la série au global),
depuis la fiche épisode, et de **réagir juste après l'avoir visionné** — sans
jamais spoiler ceux qui ne l'ont pas encore vu.

## Contexte / état actuel (exploré)

Le socle commentaires est **déjà entièrement construit pour les épisodes** —
il ne reste qu'à l'exposer côté UI + poser la garde anti-spoiler :

- **Modèle `Comment`** possède déjà `episodeId String?` + relation `episode` +
  index `@@index([episodeId])`.
- **`GET /api/media/:id/comments?episodeId=X`** filtre déjà les racines ET les
  réponses par `episodeId` (`apps/server/src/modules/social/routes.ts:1081`).
- **`POST /api/media/:id/comments`** accepte déjà `{ body, episodeId, parentId }`,
  valide que l'épisode appartient bien au média, et crée le commentaire avec son
  `episodeId` (`…:1142`). Modération, notifications (`comment` / `comment_reply`)
  incluses.
- **Fil social** (`/api/social/feed`) et **notifications** portent déjà l'info
  épisode (`c.episode` → « X a commenté S1E5 »).
- **Mobile** : socle réutilisable — hook `useComments(mediaId, title?)`,
  `CommentCard`, écran `/comments/[id]`, `CommentsSheet`, tri, blocage,
  signalement (`mobile/components/comments/*`, `mobile/components/explore/CommentsSheet.tsx`).
- **`EpisodeSheet`** (Modal piloté par état) affiche déjà, par épisode
  (`EpisodePage`), `item.watched`, `episode.id`, `mediaId`, une mutation
  `toggle` (marquer vu/non-vu), et une requête commentaires — actuellement
  **scopée série** (`['comments', mediaId]`), à re-scoper à l'épisode.
- **`UserEpisodeStatus`** (userId, episodeId, `status`, `watchedAt`) est la
  source de vérité du « vu » → sert la garde anti-spoiler.

## Décisions produit (validées)

1. **Anti-spoiler : strict.** On ne **voit** ET ne **poste** les commentaires
   d'un épisode **que si on l'a marqué vu**. Appliqué **côté client** (garde
   d'affichage) **et vérifié côté serveur** (impossible à contourner).
2. **Prompt post-vu :** à la bascule « marqué vu », une invite discrète et
   *dismissible* propose de donner son avis sur l'épisode.
3. Les commentaires **série** restent inchangés ; les deux fils **coexistent**.

## Périmètre

### Serveur (2 ajouts, tout le reste existe)

Helper : `hasWatchedEpisode(userId, episodeId): Promise<boolean>` —
`UserEpisodeStatus` avec `status === 'watched'`.

- **`GET /api/media/:id/comments`** : si `episodeId` fourni ET l'utilisateur n'a
  pas vu l'épisode → `403 { error: 'episode_not_watched' }`. Sans `episodeId`
  (fil série) : **inchangé**.
- **`POST /api/media/:id/comments`** : si `episodeId` (dans le body) ET épisode
  non vu → `403 { error: 'episode_not_watched' }`. Couvre aussi les **réponses**
  (une réponse dans un fil épisode porte le même `episodeId`). Validation
  « épisode appartient au média » : déjà présente, conservée.

### Mobile

- **`useComments`** : accepte un `episodeId` optionnel. Clé de cache
  `['comments', mediaId, episodeId]` quand présent, `['comments', mediaId]`
  sinon (aucune régression sur le fil série ; l'invalidation par préfixe
  `['comments', mediaId]` couvre les deux). Le `episodeId` est passé au GET
  (query) et au POST (body). Sur `403 episode_not_watched`, le hook expose un
  état « verrouillé » plutôt qu'une erreur brute.
- **`EpisodePage`** (dans `EpisodeSheet`) :
  - **Épisode vu** → entrée **« Commentaires de l'épisode · N »** ouvrant le fil
    épisode (réactions/réponses/tri/champ de saisie — mêmes composants que la
    série, scopés `episodeId`).
  - **Épisode non vu** → garde verrouillée : **« 👁 Regarde l'épisode pour
    débloquer les commentaires »** — **sans compteur** (ne rien laisser filtrer).
  - La requête commentaires série actuelle de `EpisodePage` est re-scopée à
    l'épisode (ou dédoublée), le compteur ne s'affiche qu'en état « vu ».
- **Prompt post-vu** : quand `toggle` fait passer l'épisode de non-vu → vu, une
  invite discrète, non bloquante, *dismissible* (« Un avis sur S{n}E{n} ? »)
  ouvre le champ de saisie du fil épisode. N'apparaît **jamais** lors d'un
  « non-vu → » ou d'un re-marquage.
- **Présentation du fil épisode** : réutilisation de l'UI commentaires overlay
  (`CommentsSheet`, généralisée pour accepter un `episodeId`), ouverte en
  surcouche depuis `EpisodePage`. Chaque overlay gère sa propre garde de retour
  (`useBackClose`) : un « retour » ferme d'abord le fil, puis la fiche épisode.

### Hors périmètre (cette itération)

- Notes / réactions d'épisode (existent déjà, séparément).
- Aucun changement au comportement du fil social / des notifications
  (les commentaires épisode y apparaissent déjà correctement).
- Pas de garde anti-spoiler ajoutée au **fil social** (il montre déjà l'épisode
  d'un visionnage — comportement existant assumé, hors sujet ici).

## Flux de données

1. Ouverture fiche épisode → `EpisodePage` lit `item.watched`.
2. **Non vu** : garde affichée, **aucun** appel commentaires (rien ne fuit).
3. **Vu** : `useComments(mediaId, { episodeId })` → `GET …?episodeId=X` (200) →
   compteur + accès au fil.
4. Saisie → `POST …/comments { body, episodeId }` (serveur re-vérifie « vu ») →
   invalidation `['comments', mediaId, episodeId]` (optimiste possible, comme
   l'existant) → notification/feed gérés serveur.
5. Marquer vu → prompt post-vu → ouvre le fil épisode sur le champ de saisie.

## Gestion des erreurs

- `403 episode_not_watched` (course : l'épisode est « démarqué » entre-temps) →
  le client bascule sur la garde verrouillée (pas d'erreur rouge).
- `400 comment_blocked` (modération) : déjà géré par le socle, inchangé.
- Perte réseau : états de chargement/erreur du socle commentaires, inchangés.

## Tests

- **Serveur (Vitest, `apps/server`)** :
  - GET épisode : utilisateur ayant vu → 200 + liste ; n'ayant pas vu → 403.
  - POST épisode : vu → 201/200 + commentaire créé avec `episodeId` ; non vu →
    403 ; réponse (parentId) dans un fil épisode non vu → 403.
  - Non-régression : GET/POST **série** (sans `episodeId`) inchangés.
- **Mobile** : `tsc --noEmit` 0 erreur ; smoke en live sur plottime (fiche
  épisode vu → commenter ; non vu → garde ; prompt post-vu).

## Critères de succès (vérifiables)

- Un utilisateur ayant vu S1E5 peut lire et poster des commentaires **propres à
  S1E5** ; un utilisateur ne l'ayant pas vu voit la garde et **aucun contenu**.
- Le serveur refuse (403) toute lecture/écriture de commentaires d'un épisode
  non vu, même requête forgée.
- Les commentaires **série** et le reste de l'app sont **inchangés** (tests de
  non-régression verts, typecheck 0 erreur).
