import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';

// Ordres d'épisodes alternatifs — côté REQUÊTE : ordre EFFECTIF par série
// (override utilisateur ?? Show.defaultEpisodeOrder ?? officiel) et remappage
// des (saison, numéro) affichés via EpisodeAltNumber. Chargements batchés
// (préférences + défauts + mappings en 2-3 requêtes) ; zéro coût de mapping
// quand tout est officiel. Les épisodes restent les mêmes lignes : seuls les
// numéros émis dans les réponses changent.

export type EpisodeOrderInfo = { effective: string; source: 'user' | 'auto' | 'official' };

type NumberedEpisode = { id: string; seasonNumber: number; episodeNumber: number };

export type EpisodeOrders = {
  info: (mediaId: string) => EpisodeOrderInfo;
  remap: <T extends NumberedEpisode>(mediaId: string, episode: T) => T;
};

const OFFICIAL: EpisodeOrderInfo = { effective: 'official', source: 'official' };

export async function getEpisodeOrders(userId: string, mediaIds: string[]): Promise<EpisodeOrders> {
  const unique = [...new Set(mediaIds)].filter(Boolean);
  const infoByMedia = new Map<string, EpisodeOrderInfo & { showId: string }>();

  if (unique.length > 0) {
    const [shows, prefs] = await Promise.all([
      prisma.show.findMany({
        where: { mediaId: { in: unique } },
        select: { id: true, mediaId: true, defaultEpisodeOrder: true },
      }),
      prisma.userMediaStatus.findMany({
        where: { userId, mediaId: { in: unique }, episodeOrder: { not: null } },
        select: { mediaId: true, episodeOrder: true },
      }),
    ]);
    const prefByMedia = new Map(prefs.map((p) => [p.mediaId, p.episodeOrder!]));
    for (const s of shows) {
      const pref = prefByMedia.get(s.mediaId) ?? null;
      const effective = pref ?? s.defaultEpisodeOrder ?? 'official';
      const source: EpisodeOrderInfo['source'] = pref ? 'user' : s.defaultEpisodeOrder ? 'auto' : 'official';
      infoByMedia.set(s.mediaId, { effective, source, showId: s.id });
    }
  }

  // Mappings des seuls couples (série, ordre) non officiels — une requête.
  const pairs = [...infoByMedia.values()].filter((i) => i.effective !== 'official');
  const mapByKey = new Map<string, { seasonNumber: number; episodeNumber: number }>();
  if (pairs.length > 0) {
    const rows = await prisma.episodeAltNumber.findMany({
      where: { OR: pairs.map((p) => ({ showId: p.showId, orderType: p.effective })) },
      select: { orderType: true, episodeId: true, seasonNumber: true, episodeNumber: true },
    });
    for (const r of rows) {
      mapByKey.set(`${r.orderType}:${r.episodeId}`, { seasonNumber: r.seasonNumber, episodeNumber: r.episodeNumber });
    }
  }

  return {
    info(mediaId) {
      const i = infoByMedia.get(mediaId);
      return i ? { effective: i.effective, source: i.source } : OFFICIAL;
    },
    remap(mediaId, episode) {
      const i = infoByMedia.get(mediaId);
      if (!i || i.effective === 'official') return episode;
      const m = mapByKey.get(`${i.effective}:${episode.id}`);
      // Épisode sans correspondance dans l'ordre alternatif : numéros
      // officiels conservés (règle produit).
      return m ? { ...episode, seasonNumber: m.seasonNumber, episodeNumber: m.episodeNumber } : episode;
    },
  };
}

// Ids des épisodes composant la « saison » N telle qu'AFFICHÉE pour cet
// utilisateur (mark-all d'une saison depuis une fiche regroupée en ordre
// alternatif). Renvoie null quand l'ordre effectif est l'officiel — l'appelant
// garde alors sa requête habituelle par seasonNumber officiel.
export async function episodeIdsForEffectiveSeason(
  userId: string,
  mediaId: string,
  showId: string,
  seasonNumber: number,
): Promise<string[] | null> {
  const orders = await getEpisodeOrders(userId, [mediaId]);
  const { effective } = orders.info(mediaId);
  if (effective === 'official') return null;
  const all = await prisma.episodeAltNumber.findMany({
    where: { showId, orderType: effective },
    select: { episodeId: true, seasonNumber: true },
  });
  if (all.length === 0) return null;
  const mappedIds = new Set(all.map((m) => m.episodeId));
  const inSeason = new Set(all.filter((m) => m.seasonNumber === seasonNumber).map((m) => m.episodeId));
  // Les épisodes SANS correspondance restent affichés sous leur saison
  // officielle : on les inclut quand elle coïncide avec la saison demandée.
  const unmapped = await prisma.episode.findMany({
    where: { showId, seasonNumber, id: { notIn: [...mappedIds] } },
    select: { id: true },
  });
  return [...inSeason, ...unmapped.map((e) => e.id)];
}

export async function episodeOrderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // Ordres disponibles + ordre effectif pour CET utilisateur.
  // `current` = son override (null = suivre le défaut de la série).
  app.get('/api/shows/:id/orders', async (request, reply) => {
    const { id } = request.params as { id: string };
    const media = await prisma.media.findFirst({ where: { id, type: 'show' }, include: { show: true } });
    if (!media) return reply.code(404).send({ error: 'not_found' });

    let available: { type: string; label: string; seasons: number }[] = [];
    if (media.tvdbId) {
      const { getAvailableOrders } = await import('../../services/tvdb/index.js');
      available = (await getAvailableOrders(media.tvdbId).catch(() => null)) ?? [];
    }

    const status = await prisma.userMediaStatus.findUnique({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      select: { episodeOrder: true },
    });
    const orders = await getEpisodeOrders(request.userId, [id]);
    const { effective, source } = orders.info(id);
    return { available, effective, source, current: status?.episodeOrder ?? null };
  });

  // Override PAR UTILISATEUR : 'official' force l'ordre de diffusion malgré un
  // défaut auto ; null = revenir au défaut de la série. Les ordres alternatifs
  // sont synchronisés à la demande ; 0 correspondance → 422 order_unavailable.
  app.post('/api/shows/:id/order', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { order } = z
      .object({ order: z.enum(['official', 'dvd', 'absolute', 'alternate', 'regional', 'altdvd']).nullable() })
      .parse(request.body);
    const media = await prisma.media.findFirst({ where: { id, type: 'show' }, include: { show: true } });
    if (!media?.show) return reply.code(404).send({ error: 'not_found' });

    if (order && order !== 'official') {
      if (!media.tvdbId) return reply.code(422).send({ error: 'order_unavailable' });
      const existing = await prisma.episodeAltNumber.count({ where: { showId: media.show.id, orderType: order } });
      let matched = existing;
      if (existing === 0) {
        const { syncAltOrder } = await import('../../services/tvdb/index.js');
        matched = await syncAltOrder(id, order).catch(() => 0);
      }
      if (matched === 0) return reply.code(422).send({ error: 'order_unavailable' });
    }

    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status: 'not_started', episodeOrder: order },
      update: { episodeOrder: order },
    });

    const effective = order ?? media.show.defaultEpisodeOrder ?? 'official';
    return { ok: true, effective };
  });
}
