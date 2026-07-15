import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { igdbGame, igdbSearch, igdbToMedia, igdbImageUrl } from '../../services/igdb/index.js';

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

  app.get('/api/games/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'game' }, include: { game: true } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    // Enrichissement paresseux : si jamais synchronisé, on complète via IGDB.
    if (media.igdbId && !media.lastSyncedAt) await ensureGameFromIgdb(media.igdbId);
    const fresh = await prisma.media.findUnique({ where: { id }, include: { game: true } });
    const status = await prisma.userMediaStatus.findUnique({ where: { userId_mediaId: { userId: request.userId, mediaId: id } } });
    return {
      ...serializeGame(fresh!, status),
      overview: fresh!.overview, backdropPath: fresh!.backdropPath,
      developer: fresh!.game?.developer ?? null, publisher: fresh!.game?.publisher ?? null,
      gameModes: fresh!.game?.gameModes ?? null, releaseDate: fresh!.releaseDate?.toISOString() ?? null,
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
