import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ProfileStatsDto } from '@serietime/types';
import { episodesWatchTimeMinutes, moviesWatchTimeMinutes } from '@serietime/core';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { serializeMedia } from '../media/serialize.js';

async function computeStats(userId: string): Promise<ProfileStatsDto> {
  const [showsCount, moviesCount, ratingsCount, watchedEpisodes, watchedMovies, gamesCount, gamesPlayed] = await Promise.all([
    prisma.userMediaStatus.count({ where: { userId, media: { type: 'show' } } }),
    prisma.userMediaStatus.count({ where: { userId, media: { type: 'movie' } } }),
    prisma.userEpisodeStatus.count({ where: { userId, rating: { not: null } } }).then(async (episodeRatings) => {
      const mediaRatings = await prisma.userMediaStatus.count({ where: { userId, rating: { not: null } } });
      return episodeRatings + mediaRatings;
    }),
    prisma.userEpisodeStatus.findMany({
      where: { userId, status: 'watched' },
      select: { episode: { select: { runtime: true, show: { select: { media: { select: { runtime: true } } } } } } },
    }),
    prisma.userMediaStatus.findMany({
      where: { userId, status: 'completed', media: { type: 'movie' } },
      select: { media: { select: { runtime: true } } },
    }),
    prisma.userMediaStatus.count({ where: { userId, media: { type: 'game' }, isHidden: false } }),
    // « Joués » = en cours ou terminés (les « Voulus » n'ont pas été lancés).
    prisma.userMediaStatus.count({
      where: { userId, media: { type: 'game' }, isHidden: false, status: { in: ['playing', 'completed'] } },
    }),
  ]);
  const showMinutes = episodesWatchTimeMinutes(
    watchedEpisodes.map((e) => e.episode.runtime ?? e.episode.show.media.runtime),
  );
  const movieMinutes = moviesWatchTimeMinutes(watchedMovies.map((m) => m.media.runtime));
  return {
    showsCount,
    moviesCount,
    ratingsCount,
    episodesWatched: watchedEpisodes.length,
    moviesWatched: watchedMovies.length,
    showMinutes,
    movieMinutes,
    gamesCount,
    gamesPlayed,
  };
}

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // Profil complet pour l'écran /profile.
  app.get('/api/profile', async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.userId } });
    const [stats, lists, shows, favoriteShows, movies, favoriteMovies, games, favoriteGames, followingCount, followersCount, commentsCount] = await Promise.all([
      computeStats(request.userId),
      prisma.mediaList.findMany({
        where: { userId: request.userId },
        include: { items: { include: { media: true }, orderBy: { position: 'asc' }, take: 4 } },
        orderBy: { updatedAt: 'desc' },
      }),
      // Sections « Séries »/« Films » du profil : la bibliothèque suivie/vue.
      // On EXCLUT les éléments seulement « à regarder plus tard » (status
      // 'watchlist') : ils vivent dans l'onglet « À voir », pas dans le profil.
      prisma.userMediaStatus.findMany({
        where: { userId: request.userId, media: { type: 'show' }, isHidden: false, status: { not: 'watchlist' } },
        include: { media: true },
        orderBy: { lastWatchedAt: 'desc' },
        take: 12,
      }),
      prisma.userMediaStatus.findMany({
        where: { userId: request.userId, media: { type: 'show' }, isFavorite: true },
        include: { media: true },
        orderBy: [{ favoriteOrder: { sort: 'asc', nulls: 'last' } }, { favoritedAt: 'asc' }],
        take: 12,
      }),
      prisma.userMediaStatus.findMany({
        where: { userId: request.userId, media: { type: 'movie' }, isHidden: false, status: { not: 'watchlist' } },
        include: { media: true },
        orderBy: { lastWatchedAt: 'desc' },
        take: 12,
      }),
      prisma.userMediaStatus.findMany({
        where: { userId: request.userId, media: { type: 'movie' }, isFavorite: true },
        include: { media: true },
        orderBy: [{ favoriteOrder: { sort: 'asc', nulls: 'last' } }, { favoritedAt: 'asc' }],
        take: 12,
      }),
      // Sections « Jeux »/« Jeux préférés » : mêmes règles que séries/films
      // (les « Voulus » restent dans l'onglet Jeux, pas dans le profil).
      prisma.userMediaStatus.findMany({
        where: { userId: request.userId, media: { type: 'game' }, isHidden: false, status: { not: 'wishlist' } },
        include: { media: true },
        orderBy: { updatedAt: 'desc' },
        take: 12,
      }),
      prisma.userMediaStatus.findMany({
        where: { userId: request.userId, media: { type: 'game' }, isFavorite: true },
        include: { media: true },
        orderBy: [{ favoriteOrder: { sort: 'asc', nulls: 'last' } }, { favoritedAt: 'asc' }],
        take: 12,
      }),
      // Compteurs sociaux de l'en-tête (façon TV Time : abonnements / abonnés / commentaires).
      prisma.follow.count({ where: { followerId: request.userId } }),
      prisma.follow.count({ where: { followingId: request.userId } }),
      prisma.comment.count({ where: { userId: request.userId } }),
    ]);
    return {
      social: { followingCount, followersCount, commentsCount },
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl,
        coverUrl: user.coverUrl,
        birthYear: user.birthYear,
        gender: user.gender,
        countryCode: user.countryCode,
        isPrivate: user.isPrivate,
      },
      stats,
      lists: lists.map((l) => ({
        id: l.id,
        title: l.title,
        posterPaths: l.items.map((i) => i.media.posterPath).filter((p): p is string => !!p),
        itemCount: l.items.length,
      })),
      shows: shows.map((s) => serializeMedia(s.media, s)),
      favoriteShows: favoriteShows.map((s) => serializeMedia(s.media, s)),
      movies: movies.map((s) => serializeMedia(s.media, s)),
      favoriteMovies: favoriteMovies.map((s) => serializeMedia(s.media, s)),
      games: games.map((s) => serializeMedia(s.media, s)),
      favoriteGames: favoriteGames.map((s) => serializeMedia(s.media, s)),
    };
  });

  app.post('/api/profile', async (request) => {
    const body = z
      .object({
        displayName: z.string().min(1).max(80).optional(),
        email: z.string().email().nullable().optional(),
        avatarUrl: z.string().max(800_000).nullable().optional(),
        coverUrl: z.string().max(800_000).nullable().optional(),
        birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
        gender: z.string().nullable().optional(),
        countryCode: z.string().length(2).optional(),
        // Vie privée (Paramètres, façon TV Time) : profil visible des seuls abonnés.
        isPrivate: z.boolean().optional(),
      })
      .parse(request.body);
    const user = await prisma.user.update({ where: { id: request.userId }, data: body });
    return { user: { id: user.id, displayName: user.displayName } };
  });

  app.get('/api/profile/stats', async (request) => {
    return { stats: await computeStats(request.userId) };
  });

  app.get('/api/profile/favorites', async (request) => {
    const query = z.object({ type: z.enum(['show', 'movie', 'game']).optional() }).parse(request.query ?? {});
    const statuses = await prisma.userMediaStatus.findMany({
      where: {
        userId: request.userId,
        isFavorite: true,
        ...(query.type ? { media: { type: query.type } } : {}),
      },
      include: { media: true },
      // « Ordre de l'utilisateur » (drag & drop) ; les favoris jamais ordonnés
      // (données antérieures à la fonctionnalité) arrivent en fin de liste.
      orderBy: [{ favoriteOrder: { sort: 'asc', nulls: 'last' } }, { favoritedAt: 'asc' }],
    });
    return { favorites: statuses.map((s) => serializeMedia(s.media, s)) };
  });

  // Réordonnancement des favoris (drag & drop façon TV Time) : reçoit la liste
  // complète des ids dans le nouvel ordre et réécrit les positions.
  app.post('/api/profile/favorites/reorder', async (request, reply) => {
    const body = z
      .object({ type: z.enum(['show', 'movie']), ids: z.array(z.string()).max(1000) })
      .parse(request.body);
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, isFavorite: true, media: { type: body.type } },
      select: { mediaId: true },
    });
    const known = new Set(statuses.map((s) => s.mediaId));
    if (!body.ids.every((id) => known.has(id))) return reply.code(400).send({ error: 'unknown_favorite' });
    await prisma.$transaction(
      body.ids.map((mediaId, index) =>
        prisma.userMediaStatus.update({
          where: { userId_mediaId: { userId: request.userId, mediaId } },
          data: { favoriteOrder: index },
        }),
      ),
    );
    return { ok: true };
  });
}
