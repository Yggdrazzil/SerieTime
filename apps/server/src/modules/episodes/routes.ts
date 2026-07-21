import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { serializeEpisode } from '../media/serialize.js';
import { createWatchEvent, markEpisodeUnwatched, markEpisodeWatched, recalculateShowStatus } from '../media/actions.js';
import { scheduleRecompute } from '../gamification/service.js';
import { getEpisodeOrders } from '../shows/episodeOrders.js';

export async function episodeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/episodes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const episode = await prisma.episode.findUnique({
      where: { id },
      include: { show: { include: { media: true } } },
    });
    if (!episode) return reply.code(404).send({ error: 'not_found' });
    const status = await prisma.userEpisodeStatus.findUnique({
      where: { userId_episodeId: { userId: request.userId, episodeId: id } },
    });
    // Numérotation selon l'ordre effectif de la série pour cet utilisateur.
    const orders = await getEpisodeOrders(request.userId, [episode.show.mediaId]);
    return {
      episode: serializeEpisode(
        orders.remap(episode.show.mediaId, episode),
        episode.show,
        episode.show.media.localizedTitle ?? episode.show.media.title,
        status,
      ),
      backdropPath: episode.stillPath ?? episode.show.media.backdropPath,
      rating: status?.rating ?? null,
      personalNote: status?.personalNote ?? null,
    };
  });

  app.post('/api/episodes/:id/watched', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ watchedAt: z.string().datetime().optional() }).parse(request.body ?? {});
    const exists = await prisma.episode.findUnique({ where: { id } });
    if (!exists) return reply.code(404).send({ error: 'not_found' });
    // Un épisode pas encore diffusé ne peut pas être coché (règle TV Time).
    if (exists.airDate && exists.airDate.getTime() > Date.now())
      return reply.code(400).send({ error: 'not_aired_yet' });
    await markEpisodeWatched(request.userId, id, body.watchedAt ? new Date(body.watchedAt) : new Date());
    return { ok: true };
  });

  // Pop-up « Cocher aussi les épisodes précédents ? » (règle produit) : c'est
  // le SEUL cas où des épisodes sont cochés sans action directe de
  // l'utilisateur — et uniquement après son OUI explicite. Marque comme vus
  // tous les épisodes réguliers DIFFUSÉS situés avant celui-ci (saisons
  // antérieures comprises) ; les spéciaux (saison 0) ne sont jamais touchés.
  app.post('/api/episodes/:id/watched-previous', async (request, reply) => {
    const { id } = request.params as { id: string };
    const target = await prisma.episode.findUnique({ where: { id }, include: { show: true } });
    if (!target) return reply.code(404).send({ error: 'not_found' });
    const now = new Date();
    const episodes = await prisma.episode.findMany({
      where: {
        showId: target.showId,
        seasonNumber: { gt: 0 },
        OR: [{ airDate: null }, { airDate: { lte: now } }],
      },
    });
    // « Précédents » évalués dans l'ordre EFFECTIF de la série (une fiche en
    // numérotation streaming coche les précédents de CET ordre-là).
    const orders = await getEpisodeOrders(request.userId, [target.show.mediaId]);
    const t = orders.remap(target.show.mediaId, target);
    const previous = episodes.filter((e) => {
      const m = orders.remap(target.show.mediaId, e);
      return m.seasonNumber < t.seasonNumber || (m.seasonNumber === t.seasonNumber && m.episodeNumber < t.episodeNumber);
    });
    for (const ep of previous) {
      await prisma.userEpisodeStatus.upsert({
        where: { userId_episodeId: { userId: request.userId, episodeId: ep.id } },
        create: { userId: request.userId, episodeId: ep.id, status: 'watched', watchedAt: now },
        update: { status: 'watched', watchedAt: now },
      });
    }
    await createWatchEvent(request.userId, target.show.mediaId, 'watched', {
      markPrevious: true,
      until: { seasonNumber: target.seasonNumber, episodeNumber: target.episodeNumber },
    });
    await recalculateShowStatus(request.userId, target.showId, now);
    scheduleRecompute(request.userId); // gamification (cette route ne passe pas par markEpisodeWatched)
    return { ok: true, count: previous.length };
  });

  app.post('/api/episodes/:id/unwatched', async (request, reply) => {
    const { id } = request.params as { id: string };
    const exists = await prisma.episode.findUnique({ where: { id } });
    if (!exists) return reply.code(404).send({ error: 'not_found' });
    await markEpisodeUnwatched(request.userId, id);
    return { ok: true };
  });

  app.post('/api/episodes/:id/rating', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ rating: z.number().min(0).max(10).nullable() }).parse(request.body);
    const episode = await prisma.episode.findUnique({ where: { id }, include: { show: true } });
    if (!episode) return reply.code(404).send({ error: 'not_found' });
    await prisma.userEpisodeStatus.upsert({
      where: { userId_episodeId: { userId: request.userId, episodeId: id } },
      create: { userId: request.userId, episodeId: id, status: 'unwatched', rating: body.rating },
      update: { rating: body.rating },
    });
    if (body.rating !== null) {
      await prisma.watchEvent.create({
        data: {
          userId: request.userId,
          mediaId: episode.show.mediaId,
          episodeId: id,
          eventType: 'rated',
          eventDate: new Date(),
          source: 'app',
        },
      });
    }
    return { ok: true };
  });

  app.post('/api/episodes/:id/date', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ watchedAt: z.string() }).parse(request.body);
    const date = new Date(body.watchedAt);
    if (Number.isNaN(date.getTime())) return reply.code(400).send({ error: 'invalid_date' });
    const exists = await prisma.episode.findUnique({ where: { id } });
    if (!exists) return reply.code(404).send({ error: 'not_found' });
    await prisma.userEpisodeStatus.upsert({
      where: { userId_episodeId: { userId: request.userId, episodeId: id } },
      create: { userId: request.userId, episodeId: id, status: 'watched', watchedAt: date },
      update: { watchedAt: date },
    });
    scheduleRecompute(request.userId); // gamification : la date de visionnage change jour J / streaks
    return { ok: true };
  });
}
