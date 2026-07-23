# Commentaires par épisode — Plan d'implémentation

> **Pour les workers agentiques :** SOUS-SKILL REQUISE — utiliser
> superpowers:subagent-driven-development (ou executing-plans) pour exécuter ce
> plan tâche par tâche. Étapes en cases à cocher (`- [ ]`).

**Goal :** commenter un épisode précis depuis la fiche épisode, réservé à ceux
qui l'ont vu (anti-spoiler strict), en réutilisant le socle commentaires.

**Architecture :** le backend accepte déjà `episodeId` (GET/POST
`/api/media/:id/comments`). On ajoute la garde « vu » côté serveur, on scope le
hook `useComments` par épisode, et on branche l'UI (fiche épisode + prompt
post-vu). Spec : `docs/superpowers/specs/2026-07-23-commentaires-par-episode-design.md`.

**Tech Stack :** Fastify + Prisma + SQLite (serveur, Vitest) ; React Native +
Expo + react-query (mobile).

## Global Constraints

- Aucune régression sur les commentaires **série** (appels sans `episodeId`
  inchangés : clé `['comments', mediaId]`, mêmes URLs).
- Anti-spoiler **strict** : garde client (`episode.watched`) **ET** serveur
  (403 `episode_not_watched`) sur lecture ET écriture (commentaires ET réponses).
- Pas de nouvelle migration (colonne `Comment.episodeId` déjà présente et
  déployée). Vérifier `prisma migrate status` = à jour.
- Typographie : jamais `fontWeight`, toujours `fontFamily: FONTS.x`.
- Serveur : `pnpm` ; mobile : `npm`. Typecheck mobile 0 erreur.
- Mettre à jour `docs/AVANCEMENT.md` dans le commit final.
- Branche `feat/episode-comments`, PR vers `main`.

## File Structure

- Modifier : `apps/server/src/modules/social/routes.ts` (garde « vu » GET+POST).
- Créer : `apps/server/src/__tests__/episode-comments.test.ts`.
- Modifier : `mobile/components/comments/useComments.ts` (param `episodeId`).
- Modifier : `mobile/app/comments/[id].tsx` (params `episodeId`/`episodeLabel`).
- Modifier : `mobile/components/EpisodeSheet.tsx` (requête épisode, ligne gardée,
  prompt post-vu).
- Modifier : `docs/AVANCEMENT.md`.

---

### Task 1 : Serveur — garde « vu » sur les commentaires épisode + tests

**Files :**
- Modify : `apps/server/src/modules/social/routes.ts` (GET `:1081`, POST `:1142`)
- Test : `apps/server/src/__tests__/episode-comments.test.ts` (créer)

**Interfaces :**
- Produit : `403 { error: 'episode_not_watched' }` sur GET (`?episodeId` non vu)
  et POST (body `episodeId` non vu). Consommé par le mobile (Task 2/3).

- [ ] **Step 1 : Écrire le test (échoue d'abord)**

Créer `apps/server/src/__tests__/episode-comments.test.ts` :

```ts
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-epcom-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'epcom.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let app: FastifyInstance;
const users: Record<string, { token: string; id: string }> = {};
let mediaId = '';
let epId = '';
const bearer = (n: string) => ({ authorization: `Bearer ${users[n]!.token}` });

async function register(name: string, email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: name, email, password: 'secret123' } });
  expect(res.statusCode).toBe(200);
  users[name] = { token: res.json().token, id: res.json().user.id };
}

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', { cwd: path.resolve(import.meta.dirname, '../..'), env: process.env, stdio: 'pipe' });
  const { buildApp } = await import('../app.js');
  app = await buildApp();
  await register('vic', 'vic@example.com'); // a vu l'épisode
  await register('nora', 'nora@example.com'); // ne l'a pas vu
  const { prisma } = await import('../db/client.js');
  const media = await prisma.media.create({ data: { type: 'show', title: 'Ma série', year: 2021, show: { create: {} } } });
  mediaId = media.id;
  const show = await prisma.show.findFirstOrThrow({ where: { mediaId } });
  const ep = await prisma.episode.create({ data: { showId: show.id, seasonNumber: 1, episodeNumber: 1, title: 'S1E1', airDate: new Date('2021-01-01') } });
  epId = ep.id;
  // vic marque l'épisode vu (endpoint réel).
  const w = await app.inject({ method: 'POST', url: `/api/episodes/${epId}/watched`, headers: bearer('vic') });
  expect(w.statusCode).toBe(200);
}, 120_000);

afterAll(async () => { await app?.close(); });

describe('Commentaires par épisode — garde anti-spoiler', () => {
  it('série (sans episodeId) reste ouverte à tous', async () => {
    const get = await app.inject({ method: 'GET', url: `/api/media/${mediaId}/comments`, headers: bearer('nora') });
    expect(get.statusCode).toBe(200);
    const post = await app.inject({ method: 'POST', url: `/api/media/${mediaId}/comments`, headers: bearer('nora'), payload: { body: 'Avis général' } });
    expect(post.statusCode).toBe(200);
  });

  it('lecture épisode : 200 pour qui a vu, 403 sinon', async () => {
    const seen = await app.inject({ method: 'GET', url: `/api/media/${mediaId}/comments?episodeId=${epId}`, headers: bearer('vic') });
    expect(seen.statusCode).toBe(200);
    const unseen = await app.inject({ method: 'GET', url: `/api/media/${mediaId}/comments?episodeId=${epId}`, headers: bearer('nora') });
    expect(unseen.statusCode).toBe(403);
    expect(unseen.json().error).toBe('episode_not_watched');
  });

  it('écriture épisode : autorisée si vu, 403 sinon', async () => {
    const ok = await app.inject({ method: 'POST', url: `/api/media/${mediaId}/comments`, headers: bearer('vic'), payload: { body: 'Quel épisode !', episodeId: epId } });
    expect(ok.statusCode).toBe(200);
    const ko = await app.inject({ method: 'POST', url: `/api/media/${mediaId}/comments`, headers: bearer('nora'), payload: { body: 'Je veux spoiler', episodeId: epId } });
    expect(ko.statusCode).toBe(403);
    expect(ko.json().error).toBe('episode_not_watched');
  });

  it('réponse dans un fil épisode : 403 si non vu', async () => {
    const root = await app.inject({ method: 'POST', url: `/api/media/${mediaId}/comments`, headers: bearer('vic'), payload: { body: 'Racine', episodeId: epId } });
    const rootId = root.json().id as string;
    const reply = await app.inject({ method: 'POST', url: `/api/media/${mediaId}/comments`, headers: bearer('nora'), payload: { body: 'Réponse interdite', episodeId: epId, parentId: rootId } });
    expect(reply.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2 : Lancer le test → échoue** (GET/POST épisode renvoient 200 au
  lieu de 403 pour `nora`).

Run : `pnpm --filter @serietime/server exec vitest run src/__tests__/episode-comments.test.ts`
Expected : FAIL (attendu 403, reçu 200).

- [ ] **Step 3 : Ajouter le helper + les gardes**

Dans `apps/server/src/modules/social/routes.ts`, ajouter le helper au-dessus des
routes commentaires (près de la fonction d'inscription des routes, portée module
ou dans la closure ayant accès à `prisma`) :

```ts
// Garde anti-spoiler : commenter/lire les commentaires d'un épisode exige de
// l'avoir marqué vu (UserEpisodeStatus). Empêche de spoiler et de scraper.
async function hasWatchedEpisode(userId: string, episodeId: string): Promise<boolean> {
  const s = await prisma.userEpisodeStatus.findUnique({
    where: { userId_episodeId: { userId, episodeId } },
    select: { status: true },
  });
  return s?.status === 'watched';
}
```

GET (`app.get('/api/media/:id/comments', async (request) => {`) : ajouter le
paramètre `reply` et la garde juste après le parse de `episodeId`/`take` :

```ts
  app.get('/api/media/:id/comments', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { episodeId, take } = z
      .object({ episodeId: z.string().optional(), take: z.coerce.number().int().min(1).max(500).optional() })
      .parse(request.query ?? {});
    // Anti-spoiler : le fil d'un épisode n'est lisible que si on l'a vu.
    if (episodeId && !(await hasWatchedEpisode(request.userId, episodeId))) {
      return reply.code(403).send({ error: 'episode_not_watched' });
    }
    const rootTake = take ?? 100;
    // …suite inchangée…
```

POST (`app.post('/api/media/:id/comments', async (request, reply) => {`) : à
l'intérieur du bloc `if (body.episodeId) { … }` existant, après la vérification
« l'épisode appartient au média » (`if (ep.show.mediaId !== id) …`), ajouter :

```ts
      // Anti-spoiler : on ne poste (commentaire OU réponse) sur un épisode que
      // si on l'a vu.
      if (!(await hasWatchedEpisode(request.userId, body.episodeId))) {
        return reply.code(403).send({ error: 'episode_not_watched' });
      }
```

- [ ] **Step 4 : Lancer le test → passe**

Run : `pnpm --filter @serietime/server exec vitest run src/__tests__/episode-comments.test.ts`
Expected : PASS (tous).

- [ ] **Step 5 : Non-régression suite complète serveur**

Run : `pnpm --filter @serietime/server test`
Expected : tout vert (les tests commentaires/social existants inchangés).

- [ ] **Step 6 : Commit**

```bash
git add apps/server/src/modules/social/routes.ts apps/server/src/__tests__/episode-comments.test.ts
git commit -m "feat(comments): garde anti-spoiler serveur sur les commentaires épisode"
```

---

### Task 2 : Mobile — `useComments` scopé épisode + écran commentaires

**Files :**
- Modify : `mobile/components/comments/useComments.ts`
- Modify : `mobile/app/comments/[id].tsx`

**Interfaces :**
- Consomme : GET/POST `/api/media/:id/comments?episodeId=` (Task 1).
- Produit : `useComments(mediaId, title?, episodeId?)` scopé ; l'écran
  `/comments/[id]?episodeId=&episodeLabel=` affiche le fil épisode.

- [ ] **Step 1 : Étendre le hook**

Dans `mobile/components/comments/useComments.ts` :

- Signature : `export function useComments(mediaId: string, title?: string, episodeId?: string) {`
- Après les états, calculer la clé scopée et l'URL :

```ts
  const key = useMemo<readonly unknown[]>(
    () => (episodeId ? ['comments', mediaId, episodeId] : ['comments', mediaId]),
    [mediaId, episodeId],
  );
  const epParam = episodeId ? `?episodeId=${episodeId}` : '';
  const epBody = episodeId ? { episodeId } : {};
```

- Remplacer **toutes** les occurrences de `['comments', mediaId]` par `key`
  (query, `invalidate`, `heart` cancel/get/setQueryData, `remove`
  cancel/get/setQueryData).
- GET : `queryFn: () => api.get<{ comments: CommentDto[] }>(\`/api/media/${mediaId}/comments${epParam}\`)`.
- `post` : `await api.post(\`/api/media/${mediaId}/comments\`, { body: body.trim(), ...epBody });`
- `postReply` : `await api.post(\`/api/media/${mediaId}/comments\`, { body: replyText.trim(), parentId, ...epBody });`

(Aucun autre changement : le tri/optimiste/partage restent identiques. Série =
`episodeId` absent → comportement strictement inchangé.)

- [ ] **Step 2 : Écran commentaires — accepter épisode**

Dans `mobile/app/comments/[id].tsx` :

```ts
  const { id, title, type, episodeId, episodeLabel } = useLocalSearchParams<{
    id: string; title?: string; type?: string; episodeId?: string; episodeLabel?: string;
  }>();
```

- Passer `episodeId` au hook : `useComments(id, title, episodeId)`.
- Dans l'en-tête, si `episodeLabel` est présent, l'afficher comme sur-ligne du
  titre (ex. petit texte `episodeLabel` au-dessus/à côté de « Commentaires »),
  pour signaler que le fil est celui de l'épisode. (Repérer le rendu du titre de
  l'en-tête dans ce fichier et y insérer `{episodeLabel ? <Text …>{episodeLabel}</Text> : null}`
  avec un style discret `FONTS.semiBold`, `COLORS.textMuted`.)

- [ ] **Step 3 : Typecheck**

Run : `mobile/node_modules/.bin/tsc --noEmit -p mobile/tsconfig.json`
Expected : 0 erreur.

- [ ] **Step 4 : Commit**

```bash
git add mobile/components/comments/useComments.ts "mobile/app/comments/[id].tsx"
git commit -m "feat(comments): hook et écran commentaires scopés à un épisode"
```

---

### Task 3 : Mobile — fiche épisode : ligne gardée + prompt post-vu

**Files :**
- Modify : `mobile/components/EpisodeSheet.tsx` (`EpisodePage`)

**Interfaces :**
- Consomme : `useComments`/écran de la Task 2, GET épisode de la Task 1.

- [ ] **Step 1 : Requête commentaires scopée épisode + activée si vu**

Remplacer la requête `comments` (`:411`) par :

```ts
  const comments = useQuery({
    queryKey: ['comments', mediaId, episode.id],
    queryFn: () =>
      api.get<{ comments: { replies?: unknown[] }[] }>(
        '/api/media/' + mediaId + '/comments?episodeId=' + episode.id,
      ),
    enabled: episode.watched, // anti-spoiler : aucun appel si pas vu
    staleTime: 60_000,
  });
```

`commentsTotal` (`:613`) reste inchangé (désormais = total épisode).

- [ ] **Step 2 : Handler d'ouverture épisode + prompt post-vu (état)**

Dans `EpisodePage`, ajouter un état et un handler (près des autres `useState`) :

```ts
  const [avisPrompt, setAvisPrompt] = useState(false);
  const epLabel = episodeCode(episode.seasonNumber, episode.episodeNumber);
  const openEpisodeComments = () => {
    onNavigateAway();
    onClose();
    router.push((
      '/comments/' + mediaId +
      '?title=' + encodeURIComponent(mediaTitle) +
      '&type=show&episodeId=' + episode.id +
      '&episodeLabel=' + encodeURIComponent(epLabel)
    ) as Href);
  };
```

Brancher le prompt sur la mutation `toggle` : ajouter à l'objet `useMutation`
un `onSuccess` (l'item porte l'état AVANT bascule → `!item.watched` = on vient
de marquer vu) :

```ts
    onSuccess: (_data: unknown, item: EpisodeDto) => {
      if (!item.watched) setAvisPrompt(true); // non-vu → vu : proposer un avis
    },
```

- [ ] **Step 3 : Ligne « Commentaires » gardée (vu vs non-vu)**

Remplacer la `Pressable` `commentsCard` (`:833`-fin de la carte) par une version
gardée : si `episode.watched`, ligne « Commentaires de l'épisode · N » ouvrant
`openEpisodeComments` ; sinon, carte **verrouillée** non cliquable :

```tsx
      {episode.watched ? (
        <Pressable
          style={({ pressed }) => [styles.commentsCard, pressed && styles.cardPressed]}
          onPress={openEpisodeComments}
          accessibilityRole="button"
          accessibilityLabel={
            commentsTotal === null
              ? "Ouvrir les commentaires de l'épisode"
              : "Ouvrir les commentaires de l'épisode, " + commentsTotal + ' contribution' + (commentsTotal > 1 ? 's' : '')
          }
        >
          <View style={styles.commentsIcon} accessible={false}>
            <Feather name="message-circle" size={20} color={COLORS.secondary} />
          </View>
          <View style={styles.commentsCopy}>
            <Text style={styles.commentsTitle}>Commentaires de l'épisode</Text>
          </View>
          <View style={styles.commentsAction}>
            <Text style={styles.commentsCount}>
              {comments.isLoading ? '…' : comments.isError ? '—' : commentsTotal}
            </Text>
            <Feather name="chevron-right" size={20} color={COLORS.textMuted} />
          </View>
        </Pressable>
      ) : (
        <View style={styles.commentsLocked} accessibilityRole="text"
          accessibilityLabel="Regarde l'épisode pour débloquer les commentaires">
          <View style={styles.commentsIcon} accessible={false}>
            <Feather name="eye-off" size={20} color={COLORS.textMuted} />
          </View>
          <View style={styles.commentsCopy}>
            <Text style={styles.commentsLockedText}>Regarde l'épisode pour débloquer les commentaires</Text>
          </View>
        </View>
      )}
```

Ajouter les styles (près de `commentsCard`) :

```ts
  commentsLocked: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, padding: SPACE.md, borderRadius: RADIUS.card, backgroundColor: COLORS.surfaceMuted },
  commentsLockedText: { flex: 1, fontFamily: FONTS.semiBold, fontSize: 13.5, color: COLORS.textMuted },
```

(Vérifier les noms de tokens existants — `RADIUS.card`, `COLORS.surfaceMuted`,
`SPACE.md` — et s'aligner sur ceux réellement utilisés par `commentsCard`.)

- [ ] **Step 4 : Prompt post-vu (bannière dismissible)**

Juste au-dessus de la carte commentaires, afficher la bannière quand
`avisPrompt && episode.watched` :

```tsx
      {avisPrompt && episode.watched ? (
        <View style={styles.avisPrompt}>
          <Text style={styles.avisPromptText}>Un avis sur {epLabel} ?</Text>
          <View style={styles.avisPromptActions}>
            <Pressable onPress={() => { setAvisPrompt(false); openEpisodeComments(); }}
              style={({ pressed }) => [styles.avisPromptBtn, pressed && styles.cardPressed]}
              accessibilityRole="button" accessibilityLabel="Donner mon avis sur l'épisode">
              <Text style={styles.avisPromptBtnText}>Commenter</Text>
            </Pressable>
            <Pressable onPress={() => setAvisPrompt(false)} hitSlop={8}
              accessibilityRole="button" accessibilityLabel="Fermer">
              <Feather name="x" size={18} color={COLORS.textMuted} />
            </Pressable>
          </View>
        </View>
      ) : null}
```

Styles :

```ts
  avisPrompt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm, padding: SPACE.sm, borderRadius: RADIUS.card, backgroundColor: COLORS.primarySoft, marginBottom: SPACE.sm },
  avisPromptText: { flex: 1, fontFamily: FONTS.bold, fontSize: 14, color: COLORS.text },
  avisPromptActions: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  avisPromptBtn: { paddingVertical: 8, paddingHorizontal: SPACE.md, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary },
  avisPromptBtnText: { fontFamily: FONTS.extraBold, fontSize: 13, color: COLORS.onPrimary, letterSpacing: 0.3 },
```

- [ ] **Step 5 : Typecheck**

Run : `mobile/node_modules/.bin/tsc --noEmit -p mobile/tsconfig.json`
Expected : 0 erreur.

- [ ] **Step 6 : Commit**

```bash
git add mobile/components/EpisodeSheet.tsx
git commit -m "feat(comments): fiche épisode — ligne commentaires gardée + prompt post-vu"
```

---

### Task 4 : Journal + typecheck global + déploiement

**Files :**
- Modify : `docs/AVANCEMENT.md`

- [ ] **Step 1 : Entrée de journal** (en tête, format existant) résumant :
  commentaires par épisode (fiche épisode), anti-spoiler strict (client+serveur),
  prompt post-vu ; socle réutilisé, backend déjà `episodeId`.

- [ ] **Step 2 : Vérifs finales** : `pnpm --filter @serietime/server test`
  (vert) + `tsc --noEmit -p mobile/tsconfig.json` (0 erreur).

- [ ] **Step 3 : Commit + PR** vers `main` (PlotTime-Team/PlotTime-Refonte),
  merge.

- [ ] **Step 4 : Déploiement (WEB + SERVEUR — changement serveur).**
  - Web : `SERIETIME_SERVER_URL=https://plottime.studio-vives.fr npx expo export -p web --clear` → backup + rsync `/var/www/plottime-web` + `chown 501:staff`.
  - Serveur : sync `main` → `Yggdrazzil/PlotTime` (branche `refonte-prisme` + PR + merge) → sur le VPS `/opt/serietime` : **backup DB** → `git pull --ff-only origin main` → `docker compose -f docker-compose.prod.yml up -d --build`. Vérifier healthcheck `healthy` + logs « No pending migrations » (colonne `episodeId` déjà présente).
  - **Vérifier après : plottime 200, `/health` 200, photo `studio-vives.fr` 200.**

- [ ] **Step 5 : Smoke live** (compte pilote) : fiche épisode **vu** → commenter
  l'épisode ; épisode **non vu** → carte verrouillée ; marquer vu → prompt.

## Self-Review

- **Couverture spec** : garde serveur (Task 1) ✓, hook/écran scopés (Task 2) ✓,
  UI fiche épisode + prompt (Task 3) ✓, tests garde (Task 1) ✓, déploiement
  serveur (Task 4) ✓.
- **Types cohérents** : `useComments(mediaId, title?, episodeId?)` — l'écran
  `comments/[id]` passe les 3 ; les autres appelants (série) restent à 1-2 args.
- **Placeholders** : aucun (code fourni). Seules zones « à repérer » : l'insertion
  du `episodeLabel` dans l'en-tête de `comments/[id]` et l'alignement des noms de
  tokens de style — instructions explicites données.
