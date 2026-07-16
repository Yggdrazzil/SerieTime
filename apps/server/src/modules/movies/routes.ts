import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { serializeMedia } from '../media/serialize.js';
import { getUserLang } from '../media/userLang.js';
import { createWatchEvent } from '../media/actions.js';
import { scheduleRecompute } from '../gamification/service.js';
import { isAllowedImageUrl } from '../media/imageUrl.js';
import { nextFavoriteOrder } from '../media/favorites.js';
import {
  ensureMediaFromTmdb,
  parseTranslations,
  syncCreditsFromTmdb,
  syncProvidersFromTmdb,
  syncTranslationsFromTmdb,
  orderProvidersForMedia,
  tmdbVideos,
  tmdbRecommendations,
} from '../../services/tmdb/index.js';

export async function movieRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // Films de l'utilisateur : à voir (watchlist/non vus) et à venir.
  app.get('/api/movies', async (request) => {
    const lang = await getUserLang(request.userId);
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, media: { type: 'movie' }, isHidden: false },
      include: { media: true },
      orderBy: { addedAt: 'desc' },
    });
    const now = new Date();
    const toWatch = statuses
      .filter((s) => s.status !== 'completed')
      .filter((s) => !s.media.releaseDate || s.media.releaseDate <= now)
      .map((s) => serializeMedia(s.media, s, lang));
    const upcoming = statuses
      .filter((s) => s.media.releaseDate && s.media.releaseDate > now)
      .sort((a, b) => a.media.releaseDate!.getTime() - b.media.releaseDate!.getTime())
      .map((s) => ({ media: serializeMedia(s.media, s, lang), releaseDate: s.media.releaseDate!.toISOString() }));
    return { toWatch, upcoming };
  });

  // Spec §23 : Profil > Films — VU / PAS VU avec tri et filtres.
  app.get('/api/movies/profile', async (request) => {
    const query = z
      .object({
        sort: z.enum(['last_watched', 'last_added', 'alpha']).default('last_watched'),
        filter: z.enum(['all', 'seen', 'unseen']).default('all'),
        hidden: z.coerce.boolean().default(false),
      })
      .parse(request.query ?? {});
    const lang = await getUserLang(request.userId);
    const statuses = await prisma.userMediaStatus.findMany({
      where: {
        userId: request.userId,
        media: { type: 'movie' },
        ...(query.hidden ? {} : { isHidden: false }),
      },
      include: { media: true },
    });
    const sorted = [...statuses].sort((a, b) => {
      if (query.sort === 'alpha') return a.media.title.localeCompare(b.media.title, 'fr');
      if (query.sort === 'last_added') return b.addedAt.getTime() - a.addedAt.getTime();
      return (b.lastWatchedAt?.getTime() ?? 0) - (a.lastWatchedAt?.getTime() ?? 0);
    });
    const seen = sorted.filter((s) => s.status === 'completed').map((s) => serializeMedia(s.media, s, lang));
    const unseen = sorted.filter((s) => s.status !== 'completed').map((s) => serializeMedia(s.media, s, lang));
    return {
      seen: query.filter === 'unseen' ? [] : seen,
      unseen: query.filter === 'seen' ? [] : unseen,
    };
  });

  app.get('/api/movies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const lang = await getUserLang(request.userId);
    const media = await prisma.media.findFirst({
      where: { id, type: 'movie' },
      include: { statuses: { where: { userId: request.userId } }, movie: true },
    });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await syncProvidersFromTmdb(media.id).catch(() => undefined);
    await syncCreditsFromTmdb(media.id).catch(() => undefined);
    // Langue de contenu ≠ fr et traduction absente : récupérée à la volée
    // (une requête TMDb, cache 7 j) — même pattern que providers/credits.
    if (lang !== 'fr' && !parseTranslations(media.translationsJson)[lang]?.title) {
      const json = await syncTranslationsFromTmdb(media).catch(() => null);
      if (json) media.translationsJson = json;
    }
    const [providers, credits] = await Promise.all([
      prisma.provider.findMany({ where: { mediaId: media.id } }),
      prisma.credit.findMany({
        where: { mediaId: media.id },
        include: { person: true },
        orderBy: { orderIndex: 'asc' },
      }),
    ]);
    let trailerUrl: string | null = null;
    if (media.tmdbId) {
      const videos = await tmdbVideos('movie', media.tmdbId).catch(() => null);
      const trailer = videos?.results?.find((v) => v.site === 'YouTube' && v.type === 'Trailer');
      trailerUrl = trailer?.key ? `https://www.youtube.com/watch?v=${trailer.key}` : null;
    }
    // Recommandations (« Les utilisateurs ont également regardé ») + marquage
    // bibliothèque + « Film ajouté par N personnes » — parité fiche série.
    type RecItem = {
      id: string; type: 'movie'; title: string; posterPath: string | null; backdropPath: string | null;
      year: number | null; tmdbId: string; localId: string | null; inLibrary: boolean;
    };
    let recommendations: RecItem[] = [];
    if (media.tmdbId) {
      const recs = await tmdbRecommendations('movie', media.tmdbId, lang).catch(() => []);
      const ids = recs.slice(0, 10).map((r) => String(r.id));
      const locals = await prisma.media.findMany({
        where: { type: 'movie', tmdbId: { in: ids } },
        select: { id: true, tmdbId: true, statuses: { where: { userId: request.userId }, select: { id: true } } },
      });
      const byTmdb = new Map(locals.map((l) => [l.tmdbId, l]));
      recommendations = recs.slice(0, 10).map((r) => {
        const local = byTmdb.get(String(r.id));
        return {
          id: `tmdb:movie:${r.id}`,
          type: 'movie' as const,
          title: r.title ?? r.name ?? '',
          posterPath: r.poster_path ?? null,
          backdropPath: r.backdrop_path ?? null,
          year: r.release_date ? new Date(r.release_date).getFullYear() : null,
          tmdbId: String(r.id),
          localId: local?.id ?? null,
          inLibrary: (local?.statuses.length ?? 0) > 0,
        };
      });
    }
    const addedByCount = await prisma.userMediaStatus.count({ where: { mediaId: media.id } });
    return {
      media: serializeMedia(media, media.statuses[0] ?? null, lang),
      addedByCount,
      recommendations,
      providers: orderProvidersForMedia(providers, media).map((p) => ({
        name: p.providerName,
        logoPath: p.providerLogoPath,
        offerType: p.offerType,
        url: p.url,
      })),
      cast: credits.map((c) => ({
        name: c.person.name,
        character: c.characterName,
        profilePath: c.person.profilePath,
        tmdbId: c.person.tmdbId,
      })),
      trailerUrl,
    };
  });

  // Spec §32.3 : marquer film vu.
  app.post('/api/movies/:id/watched', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ watchedAt: z.string().datetime().optional() }).parse(request.body ?? {});
    const media = await prisma.media.findFirst({ where: { id, type: 'movie' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    const watchedAt = body.watchedAt ? new Date(body.watchedAt) : new Date();
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status: 'completed', lastWatchedAt: watchedAt, completedAt: watchedAt },
      update: { status: 'completed', lastWatchedAt: watchedAt, completedAt: watchedAt },
    });
    await prisma.watchEvent.create({
      data: { userId: request.userId, mediaId: id, eventType: 'watched', eventDate: watchedAt, source: 'app' },
    });
    scheduleRecompute(request.userId); // gamification : film vu
    return { ok: true };
  });

  app.post('/api/movies/:id/unwatched', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'movie' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status: 'watchlist' },
      update: { status: 'watchlist', completedAt: null },
    });
    await createWatchEvent(request.userId, id, 'marked_unwatched');
    scheduleRecompute(request.userId); // gamification : recompute idempotent après dé-coche
    return { ok: true };
  });

  app.post('/api/movies/:id/favorite', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'movie' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    const existing = await prisma.userMediaStatus.findUnique({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
    });
    const isFavorite = !(existing?.isFavorite ?? false);
    // Nouvel ajout : horodaté et placé en fin de l'ordre personnalisé ;
    // retrait : on libère sa place dans l'ordre.
    const fav = isFavorite
      ? { isFavorite, favoritedAt: new Date(), favoriteOrder: await nextFavoriteOrder(request.userId, 'movie') }
      : { isFavorite, favoritedAt: null, favoriteOrder: null };
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status: 'watchlist', ...fav },
      update: fav,
    });
    await createWatchEvent(request.userId, id, isFavorite ? 'favorited' : 'unfavorited');
    if (isFavorite) {
      // Notification des abonnés en arrière-plan : ne retarde pas la réponse.
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

  app.post('/api/movies/:id/watchlist', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'movie' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status: 'watchlist' },
      update: { status: 'watchlist' },
    });
    await createWatchEvent(request.userId, id, 'added_to_watchlist');
    return { ok: true };
  });

  // Personnalisation de l'affiche et de la bannière (même API que les séries).
  app.post('/api/movies/:id/poster', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { posterPath } = z.object({ posterPath: z.string().refine(isAllowedImageUrl) }).parse(request.body);
    const media = await prisma.media.findFirst({ where: { id, type: 'movie' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.media.update({ where: { id }, data: { posterPath } });
    return { ok: true };
  });

  app.post('/api/movies/:id/banner', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { backdropPath } = z.object({ backdropPath: z.string().refine(isAllowedImageUrl) }).parse(request.body);
    const media = await prisma.media.findFirst({ where: { id, type: 'movie' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.media.update({ where: { id }, data: { backdropPath } });
    return { ok: true };
  });

  // Images disponibles pour la personnalisation (TMDb + valeurs actuelles).
  app.get('/api/movies/:id/images', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'movie' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    let posters: string[] = media.posterPath ? [media.posterPath] : [];
    let backdrops: string[] = media.backdropPath ? [media.backdropPath] : [];
    if (media.tmdbId) {
      const { tmdbImages } = await import('../../services/tmdb/images.js');
      const images = await tmdbImages('movie', media.tmdbId).catch(() => null);
      if (images) {
        posters = [...new Set([...posters, ...images.posters])].slice(0, 30);
        backdrops = [...new Set([...backdrops, ...images.backdrops])].slice(0, 30);
      }
    }
    return {
      posters,
      backdrops,
      selectedPoster: media.posterPath,
      selectedBackdrop: media.backdropPath,
    };
  });

  // Supprimer le film du suivi (équivalent « Supprimer » du menu, spec §32.7).
  app.delete('/api/movies/:id/tracking', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'movie' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.userMediaStatus.deleteMany({ where: { userId: request.userId, mediaId: id } });
    scheduleRecompute(request.userId); // gamification : retrait du suivi (recompute idempotent, parité jeux)
    return { ok: true };
  });

  // `follow: false` : consultation de la fiche sans ajout à la watchlist.
  app.post('/api/movies/add-from-tmdb', async (request, reply) => {
    const { tmdbId, follow } = z
      .object({ tmdbId: z.string(), follow: z.boolean().default(true) })
      .parse(request.body);
    const media = await ensureMediaFromTmdb('movie', tmdbId);
    if (!media) return reply.code(502).send({ error: 'tmdb_unavailable' });
    if (follow) {
      await prisma.userMediaStatus.upsert({
        where: { userId_mediaId: { userId: request.userId, mediaId: media.id } },
        create: { userId: request.userId, mediaId: media.id, status: 'watchlist' },
        update: {},
      });
    }
    return { mediaId: media.id };
  });
}
