import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { igdbGame, igdbSearch, igdbToMedia, igdbImageUrl } from '../../services/igdb/index.js';
import { nextFavoriteOrder } from '../media/favorites.js';

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

function serializeGame(m: { id: string; title: string; posterPath: string | null; year: number | null; voteAverage: number | null; igdbId: string | null; game?: { platforms: string | null } | null }, status?: { status: string; playtimeMinutes: number | null } | null) {
  return {
    id: m.id, title: m.title, posterPath: m.posterPath, year: m.year,
    voteAverage: m.voteAverage, igdbId: m.igdbId,
    platforms: m.game?.platforms ?? null,
    userStatus: status?.status ?? null,
    playtimeMinutes: status?.playtimeMinutes ?? null,
  };
}

export async function gamesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/games/search', async (request) => {
    const { q } = z.object({ q: z.string().default('') }).parse(request.query ?? {});
    if (q.trim().length < 2) return { results: [] };
    const games = await igdbSearch(q.trim());
    return {
      results: games.map((g) => ({
        igdbId: String(g.id), title: g.name,
        year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
        posterPath: g.cover ? igdbImageUrl(g.cover.image_id) : null,
      })),
    };
  });

  app.post('/api/games/add-from-igdb', async (request) => {
    const { igdbId, status } = z.object({ igdbId: z.string(), status: z.enum(GAME_STATUSES).optional() }).parse(request.body);
    const media = await ensureGameFromIgdb(igdbId);
    if (!media) return { mediaId: null };
    if (status) {
      await prisma.userMediaStatus.upsert({
        where: { userId_mediaId: { userId: request.userId, mediaId: media.id } },
        create: { userId: request.userId, mediaId: media.id, status },
        update: { status },
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
    const groups: Record<string, ReturnType<typeof serializeGame>[]> = { wishlist: [], playing: [], completed: [], abandoned: [] };
    for (const r of rows) {
      const bucket = groups[r.status];
      if (bucket) bucket.push(serializeGame(r.media, r));
    }
    return groups;
  });

  app.post('/api/games/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = z.object({ status: z.enum(GAME_STATUSES) }).parse(request.body);
    const media = await prisma.media.findFirst({ where: { id, type: 'game' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status },
      update: { status },
    });
    return { ok: true };
  });

  app.delete('/api/games/:id/tracking', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.userMediaStatus.deleteMany({ where: { userId: request.userId, mediaId: id } });
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
    const { posterPath } = z.object({ posterPath: z.string() }).parse(request.body);
    const media = await prisma.media.findFirst({ where: { id, type: 'game' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.media.update({ where: { id }, data: { posterPath } });
    return { ok: true };
  });

  app.post('/api/games/:id/banner', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { backdropPath } = z.object({ backdropPath: z.string() }).parse(request.body);
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
    if (fresh!.igdbId) {
      const g = await igdbGame(Number(fresh!.igdbId));
      videoId = g?.videos?.[0]?.video_id ?? null;
      // Note presse agrégée IGDB (0-100) — équivalent le plus proche de Metacritic.
      criticScore = typeof g?.aggregated_rating === 'number' ? Math.round(g.aggregated_rating) : null;
    }
    return {
      ...serializeGame(fresh!, status),
      overview: fresh!.overview, backdropPath: fresh!.backdropPath,
      developer: fresh!.game?.developer ?? null, publisher: fresh!.game?.publisher ?? null,
      gameModes: fresh!.game?.gameModes ?? null, releaseDate: fresh!.releaseDate?.toISOString() ?? null,
      genres: fresh!.genres ?? null,
      isFavorite: status?.isFavorite ?? false,
      videoId,
      criticScore,
    };
  });

  app.get('/api/games/discover', async () => {
    const { igdbPopular, igdbUpcoming, igdbImageUrl } = await import('../../services/igdb/index.js');
    const card = (g: { id: number; name: string; first_release_date?: number; cover?: { image_id: string } }) => ({
      igdbId: String(g.id), title: g.name,
      year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
      posterPath: g.cover ? igdbImageUrl(g.cover.image_id) : null,
    });
    const [popular, upcoming] = await Promise.all([igdbPopular(), igdbUpcoming()]);
    return { popular: popular.map(card), upcoming: upcoming.map(card) };
  });

  // Flux « JEUX » de l'Explorer TikTok : cartes plein écran (mêmes champs que le
  // feed séries/films), alimentées par IGDB (populaires + à venir).
  app.get('/api/explore/games', async (request) => {
    const { igdbPopular, igdbUpcoming, igdbImageUrl } = await import('../../services/igdb/index.js');
    const [popular, upcoming, tracked] = await Promise.all([
      igdbPopular(),
      igdbUpcoming(),
      // Jeux déjà suivis par l'utilisateur : exclus du flux (comme le feed
      // séries/films exclut la bibliothèque) — liker un jeu le fait sortir
      // du tirage au prochain rafraîchissement.
      prisma.userMediaStatus.findMany({
        where: { userId: request.userId, media: { type: 'game' } },
        select: { media: { select: { igdbId: true } } },
      }),
    ]);
    const trackedIds = new Set(tracked.map((t) => t.media.igdbId).filter((x): x is string => Boolean(x)));
    const seen = new Set<number>();
    const pool = [...popular, ...upcoming].filter(
      (g) => !trackedIds.has(String(g.id)) && (seen.has(g.id) ? false : (seen.add(g.id), true)),
    );
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
