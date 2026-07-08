import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { QueueItemDto, UpcomingItemDto } from '@serietime/types';
import { nextEpisodeToWatch, remainingAiredCount, upcomingGroupLabel } from '@serietime/core';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { serializeEpisode, serializeMedia } from '../media/serialize.js';
import { createWatchEvent, markEpisodeWatched, recalculateShowStatus } from '../media/actions.js';
import {
  syncCreditsFromTmdb,
  syncProvidersFromTmdb,
  syncShowEpisodesFromTmdb,
  tmdbVideos,
  tmdbRecommendations,
} from '../../services/tmdb/index.js';

const NOT_WATCHED_FOR_A_WHILE_DAYS = 30;

async function getShowWithUserData(userId: string, showMediaId: string) {
  return prisma.media.findFirst({
    where: { id: showMediaId, type: 'show' },
    include: {
      show: { include: { episodes: true, seasons: { orderBy: { seasonNumber: 'asc' } } } },
      statuses: { where: { userId } },
    },
  });
}

export async function showRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // Liste des séries suivies (avec statut utilisateur).
  app.get('/api/shows', async (request) => {
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, media: { type: 'show' } },
      include: { media: true },
      orderBy: { lastWatchedAt: 'desc' },
    });
    return { shows: statuses.map((s) => serializeMedia(s.media, s)) };
  });

  // Spec §17 : file "À voir" groupée.
  app.get('/api/shows/queue', async (request) => {
    const userId = request.userId;
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId, media: { type: 'show' }, isHidden: false },
      include: {
        media: {
          include: { show: { include: { episodes: true } } },
        },
      },
    });

    const episodeStatuses = await prisma.userEpisodeStatus.findMany({
      where: { userId, status: 'watched' },
      select: { episodeId: true, watchedAt: true },
    });
    const watchedSet = new Set(episodeStatuses.map((e) => e.episodeId));

    const now = new Date();
    const items: QueueItemDto[] = [];
    for (const status of statuses) {
      const show = status.media.show;
      if (!show) continue;
      const refs = show.episodes.map((e) => ({
        id: e.id,
        seasonNumber: e.seasonNumber,
        episodeNumber: e.episodeNumber,
        airDate: e.airDate?.toISOString() ?? null,
        watched: watchedSet.has(e.id),
      }));
      const next = nextEpisodeToWatch(refs, now);
      const remaining = remainingAiredCount(refs, now);

      let group: QueueItemDto['group'];
      // « Regarder plus tard » (watchlist) : affiché dans « À voir » avec les
      // séries, dans le groupe « Pas commencé » (comme une série suivie mais pas
      // encore démarrée). Reste exclu de « À venir » (voir /upcoming).
      if (status.status === 'watchlist') group = 'pas_commence';
      else if (status.status === 'abandoned') group = 'abandonne';
      else if (status.status === 'not_started') group = 'pas_commence';
      else if (status.status === 'watching' || status.status === 'paused') {
        if (remaining === 0) continue; // à jour → pas dans la file
        const last = status.lastWatchedAt;
        group =
          last && now.getTime() - last.getTime() > NOT_WATCHED_FOR_A_WHILE_DAYS * 86_400_000
            ? 'pas_regarde_depuis_un_moment'
            : 'a_voir';
      } else continue; // completed

      if ((group === 'pas_commence' || group === 'abandonne') && refs.length > 0 && remaining === 0) continue;

      const nextEpisode = next ? show.episodes.find((e) => e.id === next.id) ?? null : null;
      const badges: QueueItemDto['badges'] = [];
      if (nextEpisode) {
        // PREMIERE : 1er épisode d'une série OU d'une saison (façon TV Time).
        if (nextEpisode.seasonNumber >= 1 && nextEpisode.episodeNumber === 1) badges.push('PREMIERE');
        // NOUVEAU : épisode déjà diffusé depuis moins de 3 jours (fenêtre « découverte »).
        const airedAgo = nextEpisode.airDate ? now.getTime() - nextEpisode.airDate.getTime() : null;
        if (airedAgo !== null && airedAgo >= 0 && airedAgo < 3 * 86_400_000) badges.push('NOUVEAU');
        else {
          const lastAired = refs
            .filter((e) => e.seasonNumber > 0 && e.airDate && new Date(e.airDate) <= now)
            .sort((a, b) => new Date(a.airDate!).getTime() - new Date(b.airDate!).getTime())
            .at(-1);
          if (lastAired && lastAired.id === nextEpisode.id) badges.push('PLUS_RECENT');
        }
      }

      items.push({
        group,
        media: serializeMedia(status.media, status),
        nextEpisode: nextEpisode
          ? serializeEpisode(nextEpisode, show, status.media.localizedTitle ?? status.media.title, null)
          : null,
        remainingCount: Math.max(0, remaining - 1),
        badges,
      });
    }

    const order: QueueItemDto['group'][] = ['a_voir', 'pas_regarde_depuis_un_moment', 'pas_commence', 'abandonne'];
    items.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    return { items };
  });

  // Spec §18 : épisodes à venir groupés par date.
  app.get('/api/shows/upcoming', async (request) => {
    const userId = request.userId;
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId, media: { type: 'show' }, isHidden: false, status: { notIn: ['abandoned', 'watchlist'] } },
      include: { media: { include: { show: true } } },
    });
    const showIds = statuses.map((s) => s.media.show?.id).filter((id): id is string => !!id);
    const horizonStart = new Date(Date.now() - 86_400_000);
    const episodes = await prisma.episode.findMany({
      where: { showId: { in: showIds }, airDate: { gte: horizonStart } },
      include: { show: true },
      orderBy: { airDate: 'asc' },
      take: 300,
    });
    const watched = await prisma.userEpisodeStatus.findMany({
      where: { userId, status: 'watched', episodeId: { in: episodes.map((e) => e.id) } },
      select: { episodeId: true },
    });
    const watchedSet = new Set(watched.map((w) => w.episodeId));
    const mediaByShowId = new Map(statuses.map((s) => [s.media.show?.id, s]));

    const groups = new Map<string, UpcomingItemDto[]>();
    const now = new Date();
    for (const ep of episodes) {
      if (!ep.airDate || watchedSet.has(ep.id)) continue;
      const status = mediaByShowId.get(ep.showId);
      if (!status) continue;
      const label = upcomingGroupLabel(ep.airDate, now);
      const dto = serializeEpisode(ep, ep.show, status.media.localizedTitle ?? status.media.title, null);
      const list = groups.get(label) ?? [];
      const sameShow = list.find((i) => i.media.id === status.media.id);
      if (sameShow) sameShow.episodes.push(dto);
      else
        list.push({
          media: serializeMedia(status.media, status),
          episodes: [dto],
          date: ep.airDate.toISOString(),
        });
      groups.set(label, list);
    }
    return {
      groups: [...groups.entries()].map(([label, items]) => ({ label, items })),
    };
  });

  // Spec §22 : Profil > Séries groupées par statut.
  app.get('/api/shows/profile', async (request) => {
    const includeHidden = (request.query as { hidden?: string }).hidden === 'true';
    const statuses = await prisma.userMediaStatus.findMany({
      where: {
        userId: request.userId,
        media: { type: 'show' },
        ...(includeHidden ? {} : { isHidden: false }),
      },
      include: { media: true },
      orderBy: { lastWatchedAt: 'desc' },
    });
    const now = Date.now();
    const groups: Record<string, ReturnType<typeof serializeMedia>[]> = {
      en_cours: [],
      pas_regarde_depuis_un_moment: [],
      abandonne: [],
      pas_commence: [],
      termine: [],
    };
    for (const s of statuses) {
      const media = serializeMedia(s.media, s);
      if (s.status === 'abandoned') groups.abandonne!.push(media);
      else if (s.status === 'completed') groups.termine!.push(media);
      else if (s.status === 'not_started' || s.status === 'watchlist') groups.pas_commence!.push(media);
      else if (s.lastWatchedAt && now - s.lastWatchedAt.getTime() > NOT_WATCHED_FOR_A_WHILE_DAYS * 86_400_000)
        groups.pas_regarde_depuis_un_moment!.push(media);
      else groups.en_cours!.push(media);
    }
    return { groups };
  });

  // Fiche série.
  app.get('/api/shows/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    let media = await getShowWithUserData(request.userId, id);
    if (!media) return reply.code(404).send({ error: 'not_found' });

    // Refresh métadonnées si stale (cadences spec §16.4 gérées par ApiCache).
    if (media.tmdbId && (!media.lastSyncedAt || Date.now() - media.lastSyncedAt.getTime() > 3 * 86_400_000)) {
      await syncShowEpisodesFromTmdb(media.id).catch(() => undefined);
      media = await getShowWithUserData(request.userId, id);
      if (!media) return reply.code(404).send({ error: 'not_found' });
    }
    await syncProvidersFromTmdb(media.id).catch(() => undefined);
    await syncCreditsFromTmdb(media.id).catch(() => undefined);

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
      const videos = await tmdbVideos('tv', media.tmdbId).catch(() => null);
      const trailer = videos?.results?.find((v) => v.site === 'YouTube' && v.type === 'Trailer');
      trailerUrl = trailer?.key ? `https://www.youtube.com/watch?v=${trailer.key}` : null;
    }

    let recommendations: ReturnType<typeof serializeMedia>[] = [];
    if (media.tmdbId) {
      const recs = await tmdbRecommendations('tv', media.tmdbId).catch(() => []);
      recommendations = recs.slice(0, 10).map((r) => ({
        id: `tmdb:show:${r.id}`,
        type: 'show' as const,
        title: r.name ?? r.title ?? '',
        posterPath: r.poster_path ?? null,
        backdropPath: r.backdrop_path ?? null,
        year: r.first_air_date ? new Date(r.first_air_date).getFullYear() : null,
        tmdbId: String(r.id),
      })) as ReturnType<typeof serializeMedia>[];
    }

    const status = media.statuses[0] ?? null;
    return {
      media: serializeMedia(media, status),
      show: media.show
        ? {
            id: media.show.id,
            numberOfSeasons: media.show.numberOfSeasons,
            numberOfEpisodes: media.show.numberOfEpisodes,
            network: media.show.network,
            platform: media.show.platform,
            airTime: media.show.airTime,
            airDay: media.show.airDay,
            nextEpisodeAirDate: media.show.nextEpisodeAirDate?.toISOString() ?? null,
          }
        : null,
      providers: providers.map((p) => ({
        name: p.providerName,
        logoPath: p.providerLogoPath,
        offerType: p.offerType,
        url: p.url,
      })),
      cast: credits.map((c) => ({
        name: c.person.name,
        character: c.characterName,
        profilePath: c.person.profilePath,
      })),
      trailerUrl,
      recommendations,
      personalNote: status?.personalNote ?? null,
    };
  });

  // Saisons + épisodes + progression.
  app.get('/api/shows/:id/episodes', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await getShowWithUserData(request.userId, id);
    if (!media?.show) return reply.code(404).send({ error: 'not_found' });
    const statuses = await prisma.userEpisodeStatus.findMany({
      where: { userId: request.userId, episode: { showId: media.show.id } },
    });
    const statusMap = new Map(statuses.map((s) => [s.episodeId, s]));
    const title = media.localizedTitle ?? media.title;

    const seasons = media.show.seasons.map((season) => {
      const episodes = media.show!.episodes
        .filter((e) => e.seasonNumber === season.seasonNumber)
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
        .map((e) => serializeEpisode(e, media.show!, title, statusMap.get(e.id)));
      return {
        id: season.id,
        seasonNumber: season.seasonNumber,
        title: season.title ?? `Saison ${season.seasonNumber}`,
        posterPath: season.posterPath,
        watchedCount: episodes.filter((e) => e.watched).length,
        totalCount: episodes.length,
        episodes,
      };
    });

    // Séries importées sans saisons synchronisées : reconstituer depuis les épisodes.
    if (seasons.length === 0 && media.show.episodes.length > 0) {
      const bySeason = new Map<number, typeof media.show.episodes>();
      for (const e of media.show.episodes) {
        bySeason.set(e.seasonNumber, [...(bySeason.get(e.seasonNumber) ?? []), e]);
      }
      for (const [num, eps] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
        const dtos = eps
          .sort((a, b) => a.episodeNumber - b.episodeNumber)
          .map((e) => serializeEpisode(e, media.show!, title, statusMap.get(e.id)));
        seasons.push({
          id: `virtual-${num}`,
          seasonNumber: num,
          title: `Saison ${num}`,
          posterPath: null,
          watchedCount: dtos.filter((e) => e.watched).length,
          totalCount: dtos.length,
          episodes: dtos,
        });
      }
    }

    const refs = media.show.episodes.map((e) => ({
      id: e.id,
      seasonNumber: e.seasonNumber,
      episodeNumber: e.episodeNumber,
      airDate: e.airDate?.toISOString() ?? null,
      watched: statusMap.get(e.id)?.status === 'watched',
    }));
    const next = nextEpisodeToWatch(refs);
    const nextEpisode = next ? media.show.episodes.find((e) => e.id === next.id) : null;

    return {
      seasons,
      nextEpisode: nextEpisode
        ? serializeEpisode(nextEpisode, media.show, title, statusMap.get(nextEpisode.id))
        : null,
    };
  });

  const mediaStatusBody = z.object({
    status: z.enum(['watching', 'completed', 'watchlist', 'paused', 'abandoned', 'not_started']),
  });

  app.post('/api/shows/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = mediaStatusBody.parse(request.body);
    const media = await prisma.media.findFirst({ where: { id, type: 'show' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status },
      update: { status },
    });
    if (status === 'abandoned') await createWatchEvent(request.userId, id, 'abandoned');
    if (status === 'paused') await createWatchEvent(request.userId, id, 'paused');
    return { ok: true };
  });

  app.post('/api/shows/:id/favorite', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'show' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    const existing = await prisma.userMediaStatus.findUnique({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
    });
    const isFavorite = !(existing?.isFavorite ?? false);
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status: 'not_started', isFavorite },
      update: { isFavorite },
    });
    await createWatchEvent(request.userId, id, isFavorite ? 'favorited' : 'unfavorited');
    if (isFavorite) {
      const me = await prisma.user.findUnique({ where: { id: request.userId } });
      const { notifyFollowers } = await import('../social/notify.js');
      await notifyFollowers(request.userId, {
        type: 'friend_favorite',
        title: `${me?.displayName ?? 'Quelqu’un'} a ajouté ${media.localizedTitle ?? media.title} à ses favoris`,
        imageUrl: media.posterPath,
        mediaId: id,
      });
    }
    return { ok: true, isFavorite };
  });

  app.post('/api/shows/:id/watchlater', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'show' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status: 'watchlist' },
      update: { status: 'watchlist' },
    });
    await createWatchEvent(request.userId, id, 'added_to_watchlist');
    return { ok: true };
  });

  app.post('/api/shows/:id/abandon', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'show' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status: 'abandoned' },
      update: { status: 'abandoned' },
    });
    await createWatchEvent(request.userId, id, 'abandoned');
    return { ok: true };
  });

  app.post('/api/shows/:id/poster', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { posterPath } = z.object({ posterPath: z.string() }).parse(request.body);
    const media = await prisma.media.findFirst({ where: { id, type: 'show' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.media.update({ where: { id }, data: { posterPath } });
    return { ok: true };
  });

  app.post('/api/shows/:id/banner', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { backdropPath } = z.object({ backdropPath: z.string() }).parse(request.body);
    const media = await prisma.media.findFirst({ where: { id, type: 'show' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.media.update({ where: { id }, data: { backdropPath } });
    return { ok: true };
  });

  // Marquer tout vu (série entière ou une saison).
  app.post('/api/shows/:id/mark-all-watched', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ seasonNumber: z.number().int().optional() }).parse(request.body ?? {});
    const media = await prisma.media.findFirst({ where: { id, type: 'show' }, include: { show: true } });
    if (!media?.show) return reply.code(404).send({ error: 'not_found' });
    const now = new Date();
    const episodes = await prisma.episode.findMany({
      where: {
        showId: media.show.id,
        seasonNumber: body.seasonNumber ?? { gt: 0 },
        OR: [{ airDate: null }, { airDate: { lte: now } }],
      },
    });
    for (const ep of episodes) {
      await prisma.userEpisodeStatus.upsert({
        where: { userId_episodeId: { userId: request.userId, episodeId: ep.id } },
        create: { userId: request.userId, episodeId: ep.id, status: 'watched', watchedAt: now },
        update: { status: 'watched', watchedAt: now },
      });
    }
    await createWatchEvent(request.userId, id, 'watched', { markAll: true, season: body.seasonNumber });
    await recalculateShowStatus(request.userId, media.show.id, now);
    return { ok: true, count: episodes.length };
  });

  // Marquer tout comme non vu (série entière ou une saison). Comme pour
  // « tout vu », les épisodes spéciaux (saison 0) sont exclus quand aucune
  // saison précise n'est fournie : ils se cochent/décochent toujours à la main.
  app.post('/api/shows/:id/mark-all-unwatched', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ seasonNumber: z.number().int().optional() }).parse(request.body ?? {});
    const media = await prisma.media.findFirst({ where: { id, type: 'show' }, include: { show: true } });
    if (!media?.show) return reply.code(404).send({ error: 'not_found' });
    const episodes = await prisma.episode.findMany({
      where: { showId: media.show.id, seasonNumber: body.seasonNumber ?? { gt: 0 } },
    });
    for (const ep of episodes) {
      await prisma.userEpisodeStatus.upsert({
        where: { userId_episodeId: { userId: request.userId, episodeId: ep.id } },
        create: { userId: request.userId, episodeId: ep.id, status: 'unwatched', watchedAt: null },
        update: { status: 'unwatched', watchedAt: null },
      });
    }
    await createWatchEvent(request.userId, id, 'marked_unwatched', { markAll: true, season: body.seasonNumber });
    await recalculateShowStatus(request.userId, media.show.id, null);
    return { ok: true, count: episodes.length };
  });

  // Spec §32.7 : supprimer la série du suivi (pas le média global).
  app.delete('/api/shows/:id/tracking', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'show' }, include: { show: true } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.userMediaStatus.deleteMany({ where: { userId: request.userId, mediaId: id } });
    if (media.show) {
      await prisma.userEpisodeStatus.deleteMany({
        where: { userId: request.userId, episode: { showId: media.show.id } },
      });
    }
    return { ok: true };
  });

  // Images disponibles pour personnaliser affiche/bannière.
  app.get('/api/shows/:id/images', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'show' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    let posters: string[] = media.posterPath ? [media.posterPath] : [];
    let backdrops: string[] = media.backdropPath ? [media.backdropPath] : [];
    if (media.tmdbId) {
      const { tmdbImages } = await import('../../services/tmdb/images.js');
      const images = await tmdbImages('tv', media.tmdbId).catch(() => null);
      if (images) {
        posters = [...new Set([...posters, ...images.posters])];
        backdrops = [...new Set([...backdrops, ...images.backdrops])];
      }
    }
    // Séries TheTVDB : leurs illustrations alimentent aussi la personnalisation.
    if (media.tvdbId) {
      const { tvdbEnabled, tvdbSeriesArtworks } = await import('../../services/tvdb/index.js');
      if (tvdbEnabled()) {
        const [tvdbPosters, tvdbBackdrops] = await Promise.all([
          tvdbSeriesArtworks(media.tvdbId, 2).catch(() => []),
          tvdbSeriesArtworks(media.tvdbId, 3).catch(() => []),
        ]);
        posters = [...new Set([...posters, ...tvdbPosters])].slice(0, 30);
        backdrops = [...new Set([...backdrops, ...tvdbBackdrops])].slice(0, 30);
      }
    }
    return {
      posters,
      backdrops,
      selectedPoster: media.posterPath,
      selectedBackdrop: media.backdropPath,
    };
  });

  // Ajout d'une série depuis un id TMDb (recherche/explore).
  // `follow: false` crée/retrouve la fiche SANS l'ajouter au suivi de
  // l'utilisateur — pour consulter une série depuis la recherche (façon TV
  // Time : taper une série ouvre sa fiche, seul le + la suit).
  app.post('/api/shows/add-from-tmdb', async (request, reply) => {
    const { tmdbId, follow } = z
      .object({ tmdbId: z.string(), follow: z.boolean().default(true) })
      .parse(request.body);
    const { ensureMediaFromTmdb } = await import('../../services/tmdb/index.js');
    const media = await ensureMediaFromTmdb('show', tmdbId);
    if (!media) return reply.code(502).send({ error: 'tmdb_unavailable' });
    if (follow) {
      await prisma.userMediaStatus.upsert({
        where: { userId_mediaId: { userId: request.userId, mediaId: media.id } },
        create: { userId: request.userId, mediaId: media.id, status: 'not_started' },
        update: {},
      });
    }
    return { mediaId: media.id };
  });

  app.post('/api/shows/add-from-tvdb', async (request, reply) => {
    const { tvdbId, follow } = z
      .object({ tvdbId: z.string(), follow: z.boolean().default(true) })
      .parse(request.body);
    const { ensureShowFromTvdb } = await import('../../services/tvdb/index.js');
    const media = await ensureShowFromTvdb(tvdbId);
    if (!media) return reply.code(502).send({ error: 'tvdb_unavailable' });
    if (follow) {
      await prisma.userMediaStatus.upsert({
        where: { userId_mediaId: { userId: request.userId, mediaId: media.id } },
        create: { userId: request.userId, mediaId: media.id, status: 'not_started' },
        update: {},
      });
    }
    return { mediaId: media.id };
  });

  // Suivre / ne plus suivre une série déjà présente dans le catalogue local.
  // Statut par défaut « not_started » : il ne passera à « watching » qu'au
  // premier épisode coché (recalculateShowStatus).
  app.post('/api/shows/:id/follow', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'show' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status: 'not_started' },
      update: {},
    });
    return { ok: true, following: true };
  });

  // (la suppression du suivi passe par DELETE /api/shows/:id/tracking, qui
  // nettoie aussi les statuts d'épisodes)
}

export { markEpisodeWatched };
