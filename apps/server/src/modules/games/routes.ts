import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { igdbGame, igdbRelated, igdbSearch, igdbToMedia, igdbImageUrl, isMainGame } from '../../services/igdb/index.js';
import { nextFavoriteOrder } from '../media/favorites.js';
import { isAllowedImageUrl } from '../media/imageUrl.js';
import { scheduleRecompute } from '../gamification/service.js';
import { filterSeenWithFallback, loadRecentImpressions, recordImpressions } from '../explore/impressions.js';
import { genreProfile, igdbGenreWeights, pickWeighted } from '../explore/taste.js';
import { allowsAdultContent } from '../settings/adultContent.js';

// « Possédé » n'est PAS un statut : c'est l'interrupteur indépendant `isOwned`
// (on peut être « En cours » ET posséder le jeu, ou y jouer via Game Pass sans
// le posséder) — cf. POST /api/games/:id/owned.
const GAME_STATUSES = ['wishlist', 'playing', 'completed', 'abandoned'] as const;

// Crée/à-jour le Media (type game) + Game à partir d'un id IGDB. Miroir de ensureMediaFromTmdb.
export async function ensureGameFromIgdb(igdbId: string) {
  const existing = await prisma.media.findFirst({ where: { type: 'game', igdbId }, include: { game: true } });
  const g = await igdbGame(Number(igdbId));
  if (!g) return existing; // offline/quota → renvoie l'existant si on l'a déjà
  const { media, game } = igdbToMedia(g);
  if (existing) {
    await prisma.media.update({ where: { id: existing.id }, data: { ...media, lastSyncedAt: new Date() } });
    await prisma.game.upsert({ where: { mediaId: existing.id }, create: { mediaId: existing.id, ...game }, update: game });
    return prisma.media.findUnique({ where: { id: existing.id }, include: { game: true } });
  }
  const created = await prisma.media.create({ data: { ...media, lastSyncedAt: new Date(), game: { create: game } }, include: { game: true } });
  return created;
}

function serializeGame(m: { id: string; title: string; posterPath: string | null; year: number | null; voteAverage: number | null; igdbId: string | null; game?: { platforms: string | null } | null }, status?: { status: string; playtimeMinutes: number | null; isOwned: boolean } | null) {
  return {
    id: m.id, title: m.title, posterPath: m.posterPath, year: m.year,
    voteAverage: m.voteAverage, igdbId: m.igdbId,
    platforms: m.game?.platforms ?? null,
    userStatus: status?.status ?? null,
    isOwned: status?.isOwned ?? false,
    playtimeMinutes: status?.playtimeMinutes ?? null,
  };
}

export async function gamesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // Recherche jeux : BIBLIOTHÈQUE LOCALE d'abord (même comportement que la
  // recherche séries/films), puis IGDB, dédupliqué par igdbId. Les jeux déjà
  // connus renvoient leur id local (`id`) et `inLibrary` pour la coche jaune.
  app.get('/api/games/search', async (request) => {
    const { q } = z.object({ q: z.string().default('') }).parse(request.query ?? {});
    if (q.trim().length < 2) return { results: [] };
    const needle = q.trim();
    const local = await prisma.media.findMany({
      where: {
        type: 'game',
        OR: [
          { title: { contains: needle } },
          { originalTitle: { contains: needle } },
          { localizedTitle: { contains: needle } },
        ],
        // Éditions (Deluxe, GOTY…) et extensions/DLC importées : jamais dans
        // la recherche — elles vivent dans la section dédiée de la fiche.
        NOT: { game: { isDlc: true } },
      },
      include: { statuses: { where: { userId: request.userId } }, game: true },
      take: 50,
    });
    const seen = new Set(local.map((m) => m.igdbId).filter(Boolean));
    const allowAdult = await allowsAdultContent(request.userId);
    const games = await igdbSearch(needle, allowAdult).catch(() => []);
    // `platforms` renvoyé en tableau (filtre côté client) : local = string
    // « Plateforme A, Plateforme B » à découper ; IGDB = objets {name}.
    const splitPlatforms = (s: string | null | undefined) =>
      s ? s.split(',').map((x) => x.trim()).filter(Boolean) : [];

    type GameResult = {
      id: string | null; igdbId: string | null; title: string; year: number | null;
      posterPath: string | null; inLibrary: boolean;
      voteAverage: number | null; voteCount: number | null; platforms: string[];
    };
    const results: GameResult[] = [
      ...local.map((m) => ({
        id: m.id,
        igdbId: m.igdbId,
        title: m.localizedTitle ?? m.title,
        year: m.year,
        posterPath: m.posterPath,
        inLibrary: m.statuses.length > 0,
        voteAverage: m.voteAverage,
        voteCount: m.voteCount,
        platforms: splitPlatforms(m.game?.platforms),
      })),
      ...games
        .filter((g) => !seen.has(String(g.id)))
        .map((g) => ({
          id: null,
          igdbId: String(g.id),
          title: g.name,
          year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
          posterPath: g.cover ? igdbImageUrl(g.cover.image_id) : null,
          inLibrary: false,
          voteAverage: typeof g.total_rating === 'number' ? g.total_rating / 10 : null,
          voteCount: typeof g.total_rating_count === 'number' ? g.total_rating_count : null,
          platforms: g.platforms ? g.platforms.map((p) => p.name) : [],
        })),
    ];

    // Ordre par défaut (retour Étienne : plus d'ordre « aléatoire ») : les jeux
    // NOTÉS d'abord, puis par popularité (nombre de notes) et meilleure note —
    // les titres connus (Mario…) remontent en tête ; année/titre départagent.
    const rank = (r: GameResult) => (r.voteCount && r.voteCount > 0 ? 1 : 0);
    results.sort((a, b) =>
      rank(b) - rank(a) ||
      (b.voteCount ?? 0) - (a.voteCount ?? 0) ||
      (b.voteAverage ?? 0) - (a.voteAverage ?? 0) ||
      (b.year ?? 0) - (a.year ?? 0) ||
      a.title.localeCompare(b.title, 'fr'),
    );
    return { results };
  });

  app.post('/api/games/add-from-igdb', async (request) => {
    const { igdbId, status } = z.object({ igdbId: z.string(), status: z.enum(GAME_STATUSES).optional() }).parse(request.body);
    const media = await ensureGameFromIgdb(igdbId);
    if (!media) return { mediaId: null };
    if (status) {
      const completedAt = status === 'completed' ? new Date() : null;
      await prisma.userMediaStatus.upsert({
        where: { userId_mediaId: { userId: request.userId, mediaId: media.id } },
        create: { userId: request.userId, mediaId: media.id, status, completedAt },
        update: { status, completedAt },
      });
    }
    return { mediaId: media.id };
  });

  app.get('/api/games', async (request) => {
    const rows = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, media: { type: 'game' }, isHidden: false },
      include: { media: { include: { game: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    // wishlist/playing/completed/abandoned = groupes PAR STATUT (exclusifs) ;
    // `owned` = vue « collection » : TOUTES les lignes isOwned, quel que soit
    // le statut — un jeu peut donc apparaître dans deux groupes (En cours +
    // Possédés), c'est voulu. Même forme de réponse qu'avant pour le mobile.
    const groups: Record<string, ReturnType<typeof serializeGame>[]> = { wishlist: [], owned: [], playing: [], completed: [], abandoned: [] };
    for (const r of rows) {
      const bucket = groups[r.status];
      if (bucket) bucket.push(serializeGame(r.media, r));
      if (r.isOwned) groups.owned!.push(serializeGame(r.media, r));
    }
    return groups;
  });

  // Interrupteur « Je possède » — booléen INDÉPENDANT du statut. Un jeu marqué
  // possédé sans autre interaction doit bien exister dans UserMediaStatus : on
  // crée alors la ligne avec `status: 'wishlist'` (fallback le moins faux — pas
  // d'XP, pas de completedAt, et le jeu apparaît dans la bibliothèque).
  // Pas de scheduleRecompute : posséder un jeu ne donne aucun XP.
  app.post('/api/games/:id/owned', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { owned } = z.object({ owned: z.boolean() }).parse(request.body);
    const media = await prisma.media.findFirst({ where: { id, type: 'game' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status: 'wishlist', isOwned: owned },
      update: { isOwned: owned },
    });
    return { ok: true, isOwned: owned };
  });

  // Temps de jeu DÉCLARATIF (demande produit 2026-07-20) : l'utilisateur pose
  // ses heures à la bascule de statut (feuille sur la fiche jeu) ou les corrige
  // à tout moment. `hours: null` efface la déclaration. Écrase la valeur Steam
  // le cas échéant (déclaration explicite > import).
  app.post('/api/games/:id/playtime', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { hours } = z.object({ hours: z.number().min(0).max(100_000).nullable() }).parse(request.body);
    const media = await prisma.media.findFirst({ where: { id, type: 'game' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    const playtimeMinutes = hours === null ? null : Math.round(hours * 60);
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status: 'wishlist', playtimeMinutes },
      update: { playtimeMinutes },
    });
    return { ok: true, playtimeMinutes };
  });

  app.post('/api/games/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = z.object({ status: z.enum(GAME_STATUSES) }).parse(request.body);
    const media = await prisma.media.findFirst({ where: { id, type: 'game' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    // Horodate la fin du jeu (comme les films) : sans `completedAt`, le
    // classement hebdo (gamification, filtre `completedAt >= lundi`) ne compte
    // jamais les jeux terminés.
    const completedAt = status === 'completed' ? new Date() : null;
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status, completedAt },
      update: { status, completedAt },
    });
    scheduleRecompute(request.userId); // gamification : jeu terminé (ou plus terminé)
    return { ok: true };
  });

  app.delete('/api/games/:id/tracking', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.userMediaStatus.deleteMany({ where: { userId: request.userId, mediaId: id } });
    scheduleRecompute(request.userId); // gamification : recompute idempotent après retrait
    return { ok: true };
  });

  // Favori (parité fiche série/film) : bascule isFavorite + horodatage + ordre
  // personnalisé. Pas de createWatchEvent ici : les jeux ne génèrent aucun
  // événement de visionnage (isolation cross-domaine avec le fil séries/films,
  // cf. /api/social/feed qui lit WatchEvent).
  app.post('/api/games/:id/favorite', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'game' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    const existing = await prisma.userMediaStatus.findUnique({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
    });
    const isFavorite = !(existing?.isFavorite ?? false);
    const fav = isFavorite
      ? { isFavorite, favoritedAt: new Date(), favoriteOrder: await nextFavoriteOrder(request.userId, 'game') }
      : { isFavorite, favoritedAt: null, favoriteOrder: null };
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status: existing?.status ?? 'wishlist', ...fav },
      update: fav,
    });
    if (isFavorite) {
      // Notification des abonnés en arrière-plan, comme pour séries/films
      // (table Notification, distincte du fil WatchEvent — mobile/app/notifications.tsx
      // sait déjà router vers /game/:id pour mediaType === 'game').
      void (async () => {
        const me = await prisma.user.findUnique({ where: { id: request.userId } });
        const { notifyFollowers } = await import('../social/notify.js');
        await notifyFollowers(request.userId, {
          type: 'friend_favorite',
          title: `${me?.displayName ?? 'Quelqu’un'} a ajouté ${media.localizedTitle ?? media.title} à ses favoris`,
          imageUrl: media.posterPath,
          mediaId: id,
        });
      })().catch(() => undefined);
    }
    return { ok: true, isFavorite };
  });

  app.post('/api/games/:id/poster', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { posterPath } = z.object({ posterPath: z.string().refine(isAllowedImageUrl) }).parse(request.body);
    const media = await prisma.media.findFirst({ where: { id, type: 'game' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.media.update({ where: { id }, data: { posterPath } });
    return { ok: true };
  });

  app.post('/api/games/:id/banner', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { backdropPath } = z.object({ backdropPath: z.string().refine(isAllowedImageUrl) }).parse(request.body);
    const media = await prisma.media.findFirst({ where: { id, type: 'game' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.media.update({ where: { id }, data: { backdropPath } });
    return { ok: true };
  });

  // Images disponibles pour personnaliser affiche/bannière — appel IGDB « live »
  // (mis en cache par igdbQuery/ApiCache) plutôt qu'une persistance en base.
  app.get('/api/games/:id/images', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'game' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    let posters: string[] = media.posterPath ? [media.posterPath] : [];
    let backdrops: string[] = media.backdropPath ? [media.backdropPath] : [];
    if (media.igdbId) {
      const g = await igdbGame(Number(media.igdbId));
      if (g) {
        const coverUrls = g.cover ? [igdbImageUrl(g.cover.image_id, 't_cover_big')] : [];
        const artworkUrls = (g.artworks ?? []).map((a) => igdbImageUrl(a.image_id, 't_1080p'));
        const screenshotUrls = (g.screenshots ?? []).map((s) => igdbImageUrl(s.image_id, 't_1080p'));
        posters = [...new Set([...posters, ...coverUrls])];
        backdrops = [...new Set([...backdrops, ...artworkUrls, ...screenshotUrls])];
      }
    }
    return {
      posters,
      backdrops,
      selectedPoster: media.posterPath,
      selectedBackdrop: media.backdropPath,
    };
  });

  app.get('/api/games/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'game' }, include: { game: true } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    // Enrichissement paresseux : si jamais synchronisé, on complète via IGDB.
    if (media.igdbId && !media.lastSyncedAt) await ensureGameFromIgdb(media.igdbId);
    const fresh = await prisma.media.findUnique({ where: { id }, include: { game: true } });
    const status = await prisma.userMediaStatus.findUnique({ where: { userId_mediaId: { userId: request.userId, mediaId: id } } });
    // Bande-annonce : premier id vidéo YouTube IGDB, récupéré « live » (caché
    // par igdbQuery) — pas de nouvelle colonne DB pour ça.
    let videoId: string | null = null;
    let criticScore: number | null = null;
    let playerScore: number | null = null;
    // Éditions (Deluxe, GOTY…) et extensions/DLC du jeu — section à défilement
    // latéral de la fiche (façon app Xbox), croisée avec la bibliothèque.
    type RelatedOut = {
      igdbId: string; localId: string | null; inLibrary: boolean;
      title: string; year: number | null; posterPath: string | null;
      kind: 'edition' | 'extension';
    };
    let related: RelatedOut[] = [];
    if (fresh!.igdbId) {
      const g = await igdbGame(Number(fresh!.igdbId));
      videoId = g?.videos?.[0]?.video_id ?? null;
      // Deux notes IGDB sur le MÊME barème /100 : joueurs (rating) et presse
      // (aggregated_rating, ≈ Metacritic). Fini l'étoile combinée en doublon.
      criticScore = typeof g?.aggregated_rating === 'number' ? Math.round(g.aggregated_rating) : null;
      playerScore = typeof g?.rating === 'number' ? Math.round(g.rating) : null;
      // Rattrapage : les jeux importés avant le marquage isDlc sont recalés
      // ici (une édition déjà en base disparaît alors de la recherche).
      if (g && fresh!.game && fresh!.game.isDlc !== !isMainGame(g)) {
        await prisma.game.update({ where: { mediaId: fresh!.id }, data: { isDlc: !isMainGame(g) } });
      }
      const rel = await igdbRelated(Number(fresh!.igdbId));
      if (rel.length) {
        const ids = rel.map((r) => String(r.id));
        const locals = await prisma.media.findMany({
          where: { type: 'game', igdbId: { in: ids } },
          select: { id: true, igdbId: true, statuses: { where: { userId: request.userId }, select: { id: true } } },
        });
        const byIgdb = new Map(locals.map((l) => [l.igdbId, l]));
        related = rel.map((r) => {
          const local = byIgdb.get(String(r.id));
          return {
            igdbId: String(r.id),
            localId: local?.id ?? null,
            inLibrary: (local?.statuses.length ?? 0) > 0,
            title: r.name,
            year: r.first_release_date ? new Date(r.first_release_date * 1000).getFullYear() : null,
            posterPath: r.cover ? igdbImageUrl(r.cover.image_id) : null,
            kind: r.version_parent === Number(fresh!.igdbId) ? 'edition' : 'extension',
          };
        });
      }
    }
    return {
      ...serializeGame(fresh!, status),
      overview: fresh!.overview, backdropPath: fresh!.backdropPath,
      developer: fresh!.game?.developer ?? null, publisher: fresh!.game?.publisher ?? null,
      gameModes: fresh!.game?.gameModes ?? null, releaseDate: fresh!.releaseDate?.toISOString() ?? null,
      genres: fresh!.genres ?? null,
      isFavorite: status?.isFavorite ?? false,
      videoId,
      playerScore,
      criticScore,
      related,
    };
  });

  app.get('/api/games/discover', async (request) => {
    const { igdbPopular, igdbUpcoming, igdbImageUrl } = await import('../../services/igdb/index.js');
    const allowAdult = await allowsAdultContent(request.userId);
    const card = (g: { id: number; name: string; first_release_date?: number; cover?: { image_id: string } }) => ({
      igdbId: String(g.id), title: g.name,
      year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
      posterPath: g.cover ? igdbImageUrl(g.cover.image_id) : null,
    });
    // Échantillon aléatoire à CHAQUE requête dans un vivier mis en cache 24 h
    // (gros succès des 18 derniers mois / jeux les plus attendus) : les
    // carrousels changent à chaque rafraîchissement sans appel IGDB
    // supplémentaire — l'app reste vivante, la latence reste celle du cache.
    // `allowAdult` (18+) reste honoré via les paramètres des viviers.
    const sample = <T>(arr: T[], n: number): T[] => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a.slice(0, n);
    };
    const [popular, upcoming] = await Promise.all([igdbPopular({ allowAdult }), igdbUpcoming(allowAdult)]);
    return { popular: sample(popular, 15).map(card), upcoming: sample(upcoming, 15).map(card) };
  });

  // Flux « JEUX » de l'Explorer TikTok : cartes plein écran (mêmes champs que le
  // feed séries/films), alimentées par IGDB (populaires + à venir).
  app.get('/api/explore/games', async (request) => {
    const { igdbPopular, igdbUpcoming, igdbRecent, igdbByGenres, igdbImageUrl } = await import('../../services/igdb/index.js');
    // Jeux déjà suivis : exclus du flux (liker un jeu le fait sortir du tirage)
    // ET matière du profil de goût par genres (mêmes pondérations que le feed
    // séries/films : favoris ×3, wishlist/en cours ×2, terminés ×1, cachés ×−2).
    const tracked = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, media: { type: 'game' } },
      select: { status: true, isFavorite: true, isHidden: true, media: { select: { igdbId: true, genres: true } } },
    });
    const weights = igdbGenreWeights(
      genreProfile(
        tracked.map((t) => ({ status: t.status, isFavorite: t.isFavorite, isHidden: t.isHidden, genres: t.media.genres })),
      ),
    );
    // 1-2 genres préférés tirés au hasard pondéré → viviers IGDB dédiés.
    const genreIds = pickWeighted(weights, 2).map(Number);
    const allowAdult = await allowsAdultContent(request.userId);
    // Offsets aléatoires : fenêtre glissante dans les classements IGDB, le
    // vivier change à chaque appel (la clé ApiCache = corps Apicalypse exact,
    // offset, genres ET clause thème compris — le cache ne fige pas le hasard
    // et ne mélange pas comptes 18+ / standards).
    const randOffset = (max: number) => Math.floor(Math.random() * (max + 1));
    const [popular, upcoming, recent, seenRecently, byGenre] = await Promise.all([
      igdbPopular({ offset: randOffset(200), allowAdult }),
      igdbUpcoming(allowAdult),
      igdbRecent({ offset: randOffset(100), allowAdult }),
      // Mémoire du flux : items servis < 3 jours exclus (garde anti-famine plus bas).
      loadRecentImpressions(request.userId),
      Promise.all(genreIds.map((gid) => igdbByGenres([gid], { offset: randOffset(150), allowAdult }))),
    ]);
    const trackedIds = new Set(tracked.map((t) => t.media.igdbId).filter((x): x is string => Boolean(x)));
    const seen = new Set<number>();
    const candidates = [...popular, ...recent, ...byGenre.flat(), ...upcoming]
      .filter((g) => !trackedIds.has(String(g.id)) && (seen.has(g.id) ? false : (seen.add(g.id), true)))
      // Mélange PAR REQUÊTE : le pull-to-refresh / nouveau tirage propose un
      // ordre et un échantillon différents à chaque fois.
      .sort(() => Math.random() - 0.5);
    // Anti-répétition (impressions < 3 jours) avec garde anti-famine : si le
    // vivier restant est trop maigre, les items les plus anciens repassent.
    const GAMES_TARGET = 60;
    const itemKey = (g: { id: number }) => `game:igdb:${g.id}`;
    const pool = filterSeenWithFallback(candidates, itemKey, seenRecently, GAMES_TARGET).slice(0, GAMES_TARGET);
    const feed = pool.map((g) => ({
      id: null,
      igdbId: String(g.id),
      tmdbId: null,
      tvdbId: null,
      type: 'game' as const,
      category: 'jeux' as const,
      title: g.name,
      year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
      // Jaquette en t_1080p : t_cover_big (264 px) affichée plein écran était
      // très pixélisée — 1080p est le maximum servi par IGDB.
      posterPath: g.cover ? igdbImageUrl(g.cover.image_id, 't_1080p') : null,
      backdropPath: g.artworks?.length
        ? igdbImageUrl(g.artworks[0]!.image_id, 't_1080p')
        : g.cover
          ? igdbImageUrl(g.cover.image_id, 't_1080p')
          : null,
      overview: g.summary ?? null,
      voteAverage: typeof g.total_rating === 'number' ? g.total_rating / 10 : null,
      inLibrary: false,
      stats: { likes: 0, watched: 0, comments: 0 },
      me: { liked: false, watched: false },
    }));
    // Mémorise ce qui vient d'être servi (exclu des tirages pendant 3 jours).
    await recordImpressions(request.userId, pool.map(itemKey));
    return { feed };
  });

  // Sorties + DLC à venir des jeux SUIVIS, groupés par date (miroir de /api/shows/upcoming).
  app.get('/api/games/upcoming', async (request) => {
    const rows = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, media: { type: 'game' }, isHidden: false },
      include: { media: { include: { game: true } } },
    });
    const now = Date.now();
    const upcoming = rows
      .map((r) => r.media)
      .filter((m) => m.releaseDate && m.releaseDate.getTime() > now)
      .sort((a, b) => (a.releaseDate!.getTime() - b.releaseDate!.getTime()));
    // Groupage simple par mois (JJ/MM/AAAA détaillé côté client).
    const groups = new Map<string, { id: string; title: string; posterPath: string | null; releaseDate: string }[]>();
    for (const m of upcoming) {
      const d = m.releaseDate!;
      const label = `${d.toLocaleString('fr-FR', { month: 'long' })} ${d.getFullYear()}`;
      const arr = groups.get(label) ?? [];
      arr.push({ id: m.id, title: m.title, posterPath: m.posterPath, releaseDate: d.toISOString() });
      groups.set(label, arr);
    }
    return { groups: [...groups.entries()].map(([label, items]) => ({ label, items })) };
  });

  // Import bibliothèque Steam (jeux possédés + temps de jeu). Ne remplace jamais un statut déjà posé
  // par l'utilisateur : l'upsert `update` ne touche que playtimeMinutes.
  app.post('/api/games/steam/import', async (request) => {
    const { steamId } = z.object({ steamId: z.string().min(2) }).parse(request.body);
    const { steamResolveVanity, steamOwnedGames, steamGameToMedia } = await import('../../services/steam/steam.js');
    const id64 = await steamResolveVanity(steamId);
    if (!id64) return { imported: 0, error: 'steam_id_invalide' };
    const owned = await steamOwnedGames(id64);
    let imported = 0;
    for (const g of owned) {
      const mapped = steamGameToMedia(g);
      // Un jeu par steamAppId (via Game). Cherche l'existant, sinon crée.
      const existingGame = await prisma.game.findFirst({ where: { steamAppId: mapped.game.steamAppId } });
      let mediaId = existingGame?.mediaId ?? null;
      if (!mediaId) {
        const created = await prisma.media.create({ data: { ...mapped.media, game: { create: mapped.game } } });
        mediaId = created.id;
      }
      await prisma.userMediaStatus.upsert({
        where: { userId_mediaId: { userId: request.userId, mediaId } },
        create: { userId: request.userId, mediaId, status: mapped.status, playtimeMinutes: mapped.playtimeMinutes },
        update: { playtimeMinutes: mapped.playtimeMinutes },
      });
      imported += 1;
    }
    return { imported };
  });
}
