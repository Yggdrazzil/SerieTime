import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { QueueItemDto, UpcomingItemDto } from '@serietime/types';
import { nextEpisodeToWatch, remainingAiredCount, upcomingGroupLabel, pastGroupLabel } from '@serietime/core';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { mediaTitle, serializeEpisode, serializeMedia } from '../media/serialize.js';
import { getUserLang } from '../media/userLang.js';
import { createWatchEvent, markEpisodeWatched, recalculateShowStatus } from '../media/actions.js';
import { scheduleRecompute } from '../gamification/service.js';
import { isAllowedImageUrl } from '../media/imageUrl.js';
import { nextFavoriteOrder } from '../media/favorites.js';
import { refreshStaleContinuingShows, resyncAllUserShows, isResyncRunning } from './refresh.js';
import { getEpisodeOrders, episodeIdsForEffectiveSeason } from './episodeOrders.js';
import {
  parseTranslations,
  syncCreditsFromTmdb,
  syncProvidersFromTmdb,
  syncTranslationsFromTmdb,
  orderProvidersForMedia,
  syncShowEpisodesFromTmdb,
  tmdbVideos,
  tmdbRecommendations,
} from '../../services/tmdb/index.js';

const NOT_WATCHED_FOR_A_WHILE_DAYS = 30;
// Un prochain épisode diffusé il y a moins de N jours garde la série dans
// « À voir » (nouvelle saison, nouvel épisode) malgré la règle des 30 jours.
const FRESH_NEXT_DAYS = 7;

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
    const lang = await getUserLang(request.userId);
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, media: { type: 'show' } },
      include: { media: true },
      orderBy: { lastWatchedAt: 'desc' },
    });
    return { shows: statuses.map((s) => serializeMedia(s.media, s, lang)) };
  });

  // Spec §17 : file "À voir" groupée.
  // « Resynchroniser ma bibliothèque » : rattrape d'un coup les dates de diffusion
  // manquantes (l'import crée les épisodes sans dates → séries absentes de « À voir »
  // tant qu'on n'a pas ouvert leur fiche). Lancé en fond, la réponse n'attend pas.
  app.post('/api/shows/resync-all', async (request) => {
    const already = isResyncRunning(request.userId);
    if (!already) void resyncAllUserShows(request.userId).catch(() => undefined);
    return { started: true, alreadyRunning: already };
  });

  app.get('/api/shows/queue', async (request) => {
    const userId = request.userId;
    const lang = await getUserLang(userId);
    // Balayage d'arrière-plan (fire-and-forget) : les séries en cours périmées
    // sont resynchronisées pour que les nouvelles saisons rejoignent « À voir ».
    void refreshStaleContinuingShows(userId).catch(() => undefined);
    // Séries suivies SANS leurs épisodes : charger les lignes complètes
    // (résumés, titres…) de dizaines de milliers d'épisodes rendait la requête
    // inutilisable (>60 s constatés sur une grosse bibliothèque importée).
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId, media: { type: 'show' }, isHidden: false },
      include: {
        media: {
          include: { show: { select: { id: true, mediaId: true, network: true, platform: true } } },
        },
      },
    });
    // Épisodes en colonnes MINIMALES (5 champs) : suffisant pour calculer le
    // prochain épisode / restants / badges. Les fiches complètes des seuls
    // « prochains épisodes » retenus sont chargées ensuite (≤ 1 par série).
    const showIds = statuses.map((s) => s.media.show?.id).filter((x): x is string => Boolean(x));
    const lightEpisodes = await prisma.episode.findMany({
      where: { showId: { in: showIds } },
      select: { id: true, showId: true, seasonNumber: true, episodeNumber: true, airDate: true },
    });
    const episodesByShow = new Map<string, typeof lightEpisodes>();
    for (const e of lightEpisodes) {
      const arr = episodesByShow.get(e.showId);
      if (arr) arr.push(e);
      else episodesByShow.set(e.showId, [e]);
    }

    const episodeStatuses = await prisma.userEpisodeStatus.findMany({
      where: { userId, status: 'watched' },
      select: { episodeId: true, watchedAt: true },
    });
    const watchedSet = new Set(episodeStatuses.map((e) => e.episodeId));

    // Ordres d'épisodes alternatifs : les numéros émis (et l'ordre de visionnage
    // qui en découle) suivent l'ordre effectif de chaque série (batch, 2-3 req).
    const orders = await getEpisodeOrders(userId, statuses.map((s) => s.media.id));

    const now = new Date();
    type PendingItem = {
      status: (typeof statuses)[number];
      group: QueueItemDto['group'];
      nextId: string | null;
      remaining: number;
      refs: { id: string; seasonNumber: number; episodeNumber: number; airDate: string | null; watched: boolean }[];
    };
    const pendings: PendingItem[] = [];
    for (const status of statuses) {
      const show = status.media.show;
      if (!show) continue;
      const refs = (episodesByShow.get(show.id) ?? []).map((e) => {
        const m = orders.remap(status.media.id, e);
        return {
          id: m.id,
          seasonNumber: m.seasonNumber,
          episodeNumber: m.episodeNumber,
          airDate: m.airDate?.toISOString() ?? null,
          watched: watchedSet.has(m.id),
        };
      });
      const next = nextEpisodeToWatch(refs, now);
      const remaining = remainingAiredCount(refs, now);

      let group: QueueItemDto['group'];
      // « Regarder plus tard » (watchlist) : affiché dans « À voir » avec les
      // séries, dans le groupe « Pas commencé » (comme une série suivie mais pas
      // encore démarrée). Reste exclu de « À venir » (voir /upcoming).
      if (status.status === 'watchlist') group = 'pas_commence';
      else if (status.status === 'abandoned') group = 'abandonne';
      else if (status.status === 'not_started') group = 'pas_commence';
      else if (status.status === 'watching' || status.status === 'paused' || status.status === 'completed') {
        // « Terminée » incluse : si une NOUVELLE saison / de nouveaux épisodes
        // ont été diffusés depuis (remaining > 0), la série revient dans
        // « À voir » avec son prochain épisode, comme TV Time (ex. Clevatess
        // S2 après une S1 terminée). À jour → pas dans la file.
        if (remaining === 0) continue;
        // Prochain épisode fraîchement diffusé (< 7 j) : la série reste dans
        // « À voir » même sans visionnage récent. Sinon une nouvelle saison
        // (S1 finie il y a des mois) serait enfouie dans « Pas regardé depuis
        // un moment » — invisible au milieu d'une grosse bibliothèque.
        const nextAiredAgo = next?.airDate ? now.getTime() - new Date(next.airDate).getTime() : null;
        const freshNext = nextAiredAgo !== null && nextAiredAgo >= 0 && nextAiredAgo < FRESH_NEXT_DAYS * 86_400_000;
        const last = status.lastWatchedAt;
        group =
          !freshNext && last && now.getTime() - last.getTime() > NOT_WATCHED_FOR_A_WHILE_DAYS * 86_400_000
            ? 'pas_regarde_depuis_un_moment'
            : 'a_voir';
      } else continue;

      if ((group === 'pas_commence' || group === 'abandonne') && refs.length > 0 && remaining === 0) continue;

      pendings.push({ status, group, nextId: next?.id ?? null, remaining, refs });
    }

    // Fiches complètes des seuls « prochains épisodes » retenus (une requête).
    const nextIds = pendings.map((p) => p.nextId).filter((x): x is string => Boolean(x));
    const fullNext = await prisma.episode.findMany({ where: { id: { in: nextIds } } });
    const fullById = new Map(fullNext.map((e) => [e.id, e]));

    const items: QueueItemDto[] = [];
    for (const { status, group, nextId, remaining, refs } of pendings) {
      const show = status.media.show!;
      const fetched = nextId ? fullById.get(nextId) ?? null : null;
      // Numérotation de l'ordre effectif (les badges PREMIERE/… s'évaluent dessus).
      const nextEpisode = fetched ? orders.remap(status.media.id, fetched) : null;
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

      // Progression de la série (barres de la file « À voir ») : mêmes règles
      // que la bibliothèque (/api/shows) — épisodes diffusés, spéciaux exclus.
      const aired = refs.filter(
        (e) => e.seasonNumber > 0 && (!e.airDate || new Date(e.airDate).getTime() <= now.getTime()),
      );

      items.push({
        group,
        media: serializeMedia(status.media, status, lang),
        nextEpisode: nextEpisode
          ? serializeEpisode(nextEpisode, show, mediaTitle(status.media, lang), null)
          : null,
        remainingCount: Math.max(0, remaining - 1),
        badges,
        progress: { watched: aired.filter((e) => e.watched).length, total: aired.length },
      });
    }

    const order: QueueItemDto['group'][] = ['a_voir', 'pas_regarde_depuis_un_moment', 'pas_commence', 'abandonne'];
    // Tri DANS chaque groupe : les nouveautés d'abord (NOUVEAU > PREMIERE >
    // PLUS_RECENT), puis par date de diffusion du prochain épisode (le plus
    // récent en premier). Sans ça, une nouvelle saison était noyée au milieu
    // de centaines de séries dans un ordre arbitraire (cas post-import TV Time).
    const badgeRank = (b: QueueItemDto['badges']) =>
      b.includes('NOUVEAU') ? 0 : b.includes('PREMIERE') ? 1 : b.includes('PLUS_RECENT') ? 2 : 3;
    const airTs = (i: QueueItemDto) => (i.nextEpisode?.airDate ? Date.parse(i.nextEpisode.airDate) : 0);
    items.sort((a, b) => {
      const g = order.indexOf(a.group) - order.indexOf(b.group);
      if (g !== 0) return g;
      const br = badgeRank(a.badges) - badgeRank(b.badges);
      if (br !== 0) return br;
      return airTs(b) - airTs(a);
    });
    return { items };
  });

  // Historique de visionnage (façon TV Time) : derniers épisodes cochés,
  // affiché au-dessus de la file « À voir » quand on fait défiler vers le haut.
  app.get('/api/shows/history', async (request) => {
    const lang = await getUserLang(request.userId);
    const rows = await prisma.userEpisodeStatus.findMany({
      where: { userId: request.userId, status: 'watched', watchedAt: { not: null } },
      orderBy: { watchedAt: 'desc' },
      take: 10,
      include: { episode: { include: { show: { include: { media: true } } } } },
    });
    // Numéros remappés selon l'ordre effectif de chaque série (batch).
    const orders = await getEpisodeOrders(request.userId, rows.map((r) => r.episode.show.media.id));
    return {
      items: rows.map((r) => ({
        media: serializeMedia(r.episode.show.media, null, lang),
        episode: serializeEpisode(
          orders.remap(r.episode.show.media.id, r.episode),
          r.episode.show,
          mediaTitle(r.episode.show.media, lang),
          r,
        ),
        watchedAt: r.watchedAt?.toISOString() ?? null,
      })),
    };
  });

  // Spec §18 : épisodes à venir groupés par date.
  app.get('/api/shows/upcoming', async (request) => {
    const userId = request.userId;
    const lang = await getUserLang(userId);
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId, media: { type: 'show' }, isHidden: false, status: { notIn: ['abandoned', 'watchlist'] } },
      include: { media: { include: { show: true } } },
    });
    const showIds = statuses.map((s) => s.media.show?.id).filter((id): id is string => !!id);
    // 14 jours d'historique : les sorties passées NON VUES sont renvoyées dans
    // `past` (révélées en défilant vers le haut, comme l'historique de « À voir »),
    // pour rattraper une sortie manquée.
    const horizonStart = new Date(Date.now() - 14 * 86_400_000);
    const episodes = await prisma.episode.findMany({
      where: { showId: { in: showIds }, airDate: { gte: horizonStart } },
      include: { show: true },
      orderBy: { airDate: 'asc' },
      take: 500,
    });
    const watched = await prisma.userEpisodeStatus.findMany({
      where: { userId, status: 'watched', episodeId: { in: episodes.map((e) => e.id) } },
      select: { episodeId: true },
    });
    const watchedSet = new Set(watched.map((w) => w.episodeId));
    const mediaByShowId = new Map(statuses.map((s) => [s.media.show?.id, s]));
    // Numéros remappés selon l'ordre effectif de chaque série (batch).
    const orders = await getEpisodeOrders(userId, statuses.map((s) => s.media.id));

    const groups = new Map<string, UpcomingItemDto[]>();
    const past = new Map<string, UpcomingItemDto[]>();
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    for (const ep of episodes) {
      if (!ep.airDate || watchedSet.has(ep.id)) continue;
      const status = mediaByShowId.get(ep.showId);
      if (!status) continue;
      const isPast = ep.airDate < startOfToday;
      const label = isPast ? pastGroupLabel(ep.airDate, now) : upcomingGroupLabel(ep.airDate, now);
      const target = isPast ? past : groups;
      const dto = serializeEpisode(orders.remap(status.media.id, ep), ep.show, mediaTitle(status.media, lang), null);
      const list = target.get(label) ?? [];
      const sameShow = list.find((i) => i.media.id === status.media.id);
      if (sameShow) sameShow.episodes.push(dto);
      else
        list.push({
          media: serializeMedia(status.media, status, lang),
          episodes: [dto],
          date: ep.airDate.toISOString(),
        });
      target.set(label, list);
    }
    return {
      groups: [...groups.entries()].map(([label, items]) => ({ label, items })),
      // Du plus ancien au plus récent : « HIER » finit juste au-dessus
      // d'« AUJOURD'HUI » (les épisodes étant triés airDate asc, l'ordre
      // d'insertion des groupes est déjà chronologique).
      past: [...past.entries()].map(([label, items]) => ({ label, items })),
    };
  });

  // Spec §22 : Profil > Séries groupées par statut.
  app.get('/api/shows/profile', async (request) => {
    const lang = await getUserLang(request.userId);
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
      const media = serializeMedia(s.media, s, lang);
      if (s.status === 'abandoned') groups.abandonne!.push(media);
      else if (s.status === 'completed') groups.termine!.push(media);
      else if (s.status === 'not_started' || s.status === 'watchlist') groups.pas_commence!.push(media);
      else if (s.lastWatchedAt && now - s.lastWatchedAt.getTime() > NOT_WATCHED_FOR_A_WHILE_DAYS * 86_400_000)
        groups.pas_regarde_depuis_un_moment!.push(media);
      else groups.en_cours!.push(media);
    }
    return { groups };
  });

  // Bibliothèque « Séries » du profil (page dédiée façon TV Time) : liste à plat
  // avec statut, dates et progression (épisodes DIFFUSÉS vus / diffusés). Le tri
  // et les filtres (Progress) sont appliqués côté client.
  app.get('/api/shows/library', async (request) => {
    const lang = await getUserLang(request.userId);
    const now = Date.now();
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, media: { type: 'show' }, isHidden: false },
      include: {
        media: { include: { show: { include: { episodes: { select: { id: true, seasonNumber: true, airDate: true } } } } } },
      },
      orderBy: { lastWatchedAt: 'desc' },
    });
    const watched = await prisma.userEpisodeStatus.findMany({
      where: { userId: request.userId, status: 'watched' },
      select: { episodeId: true },
    });
    const watchedSet = new Set(watched.map((w) => w.episodeId));
    const items = statuses.map((s) => {
      const eps = s.media.show?.episodes ?? [];
      const aired = eps.filter((e) => e.seasonNumber > 0 && (!e.airDate || e.airDate.getTime() <= now));
      const watchedCount = aired.filter((e) => watchedSet.has(e.id)).length;
      return {
        ...serializeMedia(s.media, s, lang),
        progress: { watched: watchedCount, total: aired.length },
        addedAt: s.addedAt.toISOString(),
        lastWatchedAt: s.lastWatchedAt?.toISOString() ?? null,
      };
    });
    return { items };
  });

  // Fiche série.
  app.get('/api/shows/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const lang = await getUserLang(request.userId);
    let media = await getShowWithUserData(request.userId, id);
    if (!media) return reply.code(404).send({ error: 'not_found' });

    // Refresh épisodes/métadonnées si stale. Fenêtre COURTE (6 h) pour une
    // série en cours — une saison qui démarre doit apparaître sans attendre —
    // longue (3 j) pour une série terminée. NB : l'ancienne garde exigeait un
    // tmdbId, ce qui excluait à tort les séries ajoutées via TheTVDB seul
    // (animés) : leurs nouvelles saisons n'arrivaient jamais.
    const ended = media.status ? /ended|canceled|cancelled/i.test(media.status) : false;
    const staleMs = ended ? 3 * 86_400_000 : 6 * 3_600_000;
    if ((media.tvdbId || media.tmdbId) && (!media.lastSyncedAt || Date.now() - media.lastSyncedAt.getTime() > staleMs)) {
      // Les animés dont les épisodes viennent de TheTVDB (saisons correctes) sont
      // rafraîchis depuis TheTVDB pour ne pas réintroduire les saisons fusionnées TMDb.
      if (media.sourcePriority === 'tvdb' && media.tvdbId) {
        const { syncEpisodesFromTvdb } = await import('../../services/tvdb/index.js');
        await syncEpisodesFromTvdb(media.id).catch(() => undefined);
      } else if (media.tmdbId) {
        await syncShowEpisodesFromTmdb(media.id).catch(() => undefined);
      }
      media = await getShowWithUserData(request.userId, id);
      if (!media) return reply.code(404).send({ error: 'not_found' });
    }
    // Animé ajouté via TheTVDB seul : retrouve l'id TMDb (une fois) pour
    // débloquer distribution, recommandations, bande-annonce et plateformes.
    if (!media.tmdbId && media.tvdbId) {
      const { ensureTmdbIdFromTvdb } = await import('../../services/tmdb/index.js');
      const found = await ensureTmdbIdFromTvdb(media.id).catch(() => false);
      if (found) {
        media = await getShowWithUserData(request.userId, id);
        if (!media) return reply.code(404).send({ error: 'not_found' });
      }
    }
    await syncProvidersFromTmdb(media.id).catch(() => undefined);
    await syncCreditsFromTmdb(media.id).catch(() => undefined);
    // Ordre d'épisodes AUTO (Disney+…) : résolu paresseusement au premier
    // affichage de la fiche (après la sync providers, dont dépend
    // l'heuristique), marqué même si le résultat est null. JAMAIS bloquant :
    // en cas d'échec TheTVDB la fiche est servie normalement en officiel.
    if (media.show && media.tvdbId && !media.show.episodeOrderCheckedAt) {
      const { resolveDefaultOrder } = await import('../../services/tvdb/index.js');
      await resolveDefaultOrder(media.id).catch(() => undefined);
    }
    const episodeOrders = await getEpisodeOrders(request.userId, [media.id]);
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
      const videos = await tmdbVideos('tv', media.tmdbId).catch(() => null);
      const trailer = videos?.results?.find((v) => v.site === 'YouTube' && v.type === 'Trailer');
      trailerUrl = trailer?.key ? `https://www.youtube.com/watch?v=${trailer.key}` : null;
    }

    type RecItem = {
      id: string; type: 'show'; title: string; posterPath: string | null; backdropPath: string | null;
      year: number | null; tmdbId: string; localId: string | null; inLibrary: boolean;
    };
    let recommendations: RecItem[] = [];
    if (media.tmdbId) {
      const recs = await tmdbRecommendations('tv', media.tmdbId, lang).catch(() => []);
      const ids = recs.slice(0, 10).map((r) => String(r.id));
      // Marquage « déjà dans ma bibliothèque » (coche jaune façon TV Time).
      const locals = await prisma.media.findMany({
        where: { type: 'show', tmdbId: { in: ids } },
        select: { id: true, tmdbId: true, statuses: { where: { userId: request.userId }, select: { id: true } } },
      });
      const byTmdb = new Map(locals.map((l) => [l.tmdbId, l]));
      recommendations = recs.slice(0, 10).map((r) => {
        const local = byTmdb.get(String(r.id));
        return {
          id: `tmdb:show:${r.id}`,
          type: 'show' as const,
          title: r.name ?? r.title ?? '',
          posterPath: r.poster_path ?? null,
          backdropPath: r.backdrop_path ?? null,
          year: r.first_air_date ? new Date(r.first_air_date).getFullYear() : null,
          tmdbId: String(r.id),
          localId: local?.id ?? null,
          inLibrary: (local?.statuses.length ?? 0) > 0,
        };
      });
    }

    const status = media.statuses[0] ?? null;
    // « Série ajoutée par N personnes » + année de fin (« 2002 - 2007 »).
    const addedByCount = await prisma.userMediaStatus.count({ where: { mediaId: media.id } });
    const airTimes = (media.show?.episodes ?? [])
      .filter((e) => e.seasonNumber > 0 && e.airDate)
      .map((e) => e.airDate!.getTime());
    const endYear = airTimes.length ? new Date(Math.max(...airTimes)).getFullYear() : null;
    return {
      media: serializeMedia(media, status, lang),
      addedByCount,
      endYear,
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
      recommendations,
      personalNote: status?.personalNote ?? null,
      // Légende discrète côté mobile : quel ordre d'épisodes est appliqué et
      // pourquoi ('auto' = heuristique plateforme, 'user' = override).
      episodeOrder: episodeOrders.info(media.id),
    };
  });

  // Notes de la communauté (façon TV Time) : moyenne des notes d'épisodes de
  // TOUS les utilisateurs, par saison — alimente le graphe de la fiche.
  app.get('/api/shows/:id/community-ratings', async (request, reply) => {
    const { id } = request.params as { id: string };
    const episodes = await prisma.episode.findMany({
      where: { show: { mediaId: id }, seasonNumber: { gt: 0 } },
      select: { id: true, seasonNumber: true, episodeNumber: true },
      orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }],
    });
    if (episodes.length === 0) return reply.code(404).send({ error: 'not_found' });
    const ratings = await prisma.userEpisodeStatus.findMany({
      where: { episodeId: { in: episodes.map((e) => e.id) }, rating: { not: null } },
      select: { episodeId: true, rating: true },
    });
    const byEpisode = new Map<string, number[]>();
    for (const r of ratings) byEpisode.set(r.episodeId, [...(byEpisode.get(r.episodeId) ?? []), r.rating!]);
    const seasons = new Map<number, { episodeNumber: number; avg: number; count: number }[]>();
    for (const e of episodes) {
      const values = byEpisode.get(e.id);
      if (!values?.length) continue;
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      seasons.set(e.seasonNumber, [
        ...(seasons.get(e.seasonNumber) ?? []),
        { episodeNumber: e.episodeNumber, avg: Math.round(avg * 10) / 10, count: values.length },
      ]);
    }
    return {
      seasons: [...seasons.entries()].map(([seasonNumber, points]) => ({ seasonNumber, points })),
    };
  });

  // Saisons + épisodes + progression.
  app.get('/api/shows/:id/episodes', async (request, reply) => {
    const { id } = request.params as { id: string };
    const lang = await getUserLang(request.userId);
    const media = await getShowWithUserData(request.userId, id);
    if (!media?.show) return reply.code(404).send({ error: 'not_found' });
    const statuses = await prisma.userEpisodeStatus.findMany({
      where: { userId: request.userId, episode: { showId: media.show.id } },
    });
    const statusMap = new Map(statuses.map((s) => [s.episodeId, s]));
    const title = mediaTitle(media, lang);

    // Ordre d'épisodes effectif (override user ?? défaut série ?? officiel) :
    // les saisons sont REGROUPÉES selon la numérotation de cet ordre (tri S
    // puis E) — mêmes lignes Episode, seuls les numéros affichés changent.
    const orders = await getEpisodeOrders(request.userId, [id]);
    const { effective, source } = orders.info(id);
    const mappedEpisodes = media.show.episodes.map((e) => orders.remap(id, e));

    type SeasonDto = {
      id: string;
      seasonNumber: number;
      title: string;
      posterPath: string | null;
      watchedCount: number;
      totalCount: number;
      episodes: ReturnType<typeof serializeEpisode>[];
    };
    const seasons: SeasonDto[] = [];

    if (effective === 'official') {
      for (const season of media.show.seasons) {
        const episodes = mappedEpisodes
          .filter((e) => e.seasonNumber === season.seasonNumber)
          .sort((a, b) => a.episodeNumber - b.episodeNumber)
          .map((e) => serializeEpisode(e, media.show!, title, statusMap.get(e.id)));
        seasons.push({
          id: season.id,
          seasonNumber: season.seasonNumber,
          title: season.title ?? `Saison ${season.seasonNumber}`,
          posterPath: season.posterPath,
          watchedCount: episodes.filter((e) => e.watched).length,
          totalCount: episodes.length,
          episodes,
        });
      }
    }

    // Ordre alternatif OU séries importées sans saisons synchronisées :
    // saisons reconstruites depuis les (numéros de) épisodes eux-mêmes.
    if (effective !== 'official' || (seasons.length === 0 && mappedEpisodes.length > 0)) {
      seasons.length = 0;
      const seasonRows = new Map(media.show.seasons.map((s) => [s.seasonNumber, s]));
      const bySeason = new Map<number, typeof mappedEpisodes>();
      for (const e of mappedEpisodes) {
        bySeason.set(e.seasonNumber, [...(bySeason.get(e.seasonNumber) ?? []), e]);
      }
      for (const [num, eps] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
        const row = seasonRows.get(num);
        const dtos = eps
          .sort((a, b) => a.episodeNumber - b.episodeNumber)
          .map((e) => serializeEpisode(e, media.show!, title, statusMap.get(e.id)));
        seasons.push({
          id: row?.id ?? `virtual-${num}`,
          seasonNumber: num,
          title: row?.title ?? `Saison ${num}`,
          posterPath: row?.posterPath ?? null,
          watchedCount: dtos.filter((e) => e.watched).length,
          totalCount: dtos.length,
          episodes: dtos,
        });
      }
    }

    // Le « prochain épisode » suit lui aussi l'ordre effectif (c'est tout
    // l'intérêt : la numérotation plateforme EST l'ordre de visionnage).
    const refs = mappedEpisodes.map((e) => ({
      id: e.id,
      seasonNumber: e.seasonNumber,
      episodeNumber: e.episodeNumber,
      airDate: e.airDate?.toISOString() ?? null,
      watched: statusMap.get(e.id)?.status === 'watched',
    }));
    const next = nextEpisodeToWatch(refs);
    const nextEpisode = next ? mappedEpisodes.find((e) => e.id === next.id) : null;

    return {
      seasons,
      nextEpisode: nextEpisode
        ? serializeEpisode(nextEpisode, media.show, title, statusMap.get(nextEpisode.id))
        : null,
      episodeOrder: { effective, source },
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
    // Nouvel ajout : horodaté et placé en fin de l'ordre personnalisé ;
    // retrait : on libère sa place dans l'ordre.
    const fav = isFavorite
      ? { isFavorite, favoritedAt: new Date(), favoriteOrder: await nextFavoriteOrder(request.userId, 'show') }
      : { isFavorite, favoritedAt: null, favoriteOrder: null };
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId: id } },
      create: { userId: request.userId, mediaId: id, status: 'not_started', ...fav },
      update: fav,
    });
    await createWatchEvent(request.userId, id, isFavorite ? 'favorited' : 'unfavorited');
    if (isFavorite) {
      // Notification des abonnés en arrière-plan : ne retarde pas la réponse
      // (la latence perçue du bouton Favoris venait en partie d'ici).
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
    const { posterPath } = z.object({ posterPath: z.string().refine(isAllowedImageUrl) }).parse(request.body);
    const media = await prisma.media.findFirst({ where: { id, type: 'show' } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    await prisma.media.update({ where: { id }, data: { posterPath } });
    return { ok: true };
  });

  app.post('/api/shows/:id/banner', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { backdropPath } = z.object({ backdropPath: z.string().refine(isAllowedImageUrl) }).parse(request.body);
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
    // Fiche regroupée en ordre alternatif : le seasonNumber reçu désigne la
    // saison AFFICHÉE — on la traduit en ids d'épisodes réels.
    const altSeasonIds =
      body.seasonNumber !== undefined
        ? await episodeIdsForEffectiveSeason(request.userId, id, media.show.id, body.seasonNumber)
        : null;
    const episodes = await prisma.episode.findMany({
      where: {
        showId: media.show.id,
        ...(altSeasonIds ? { id: { in: altSeasonIds } } : { seasonNumber: body.seasonNumber ?? { gt: 0 } }),
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
    scheduleRecompute(request.userId); // gamification : coche de masse (upserts directs, hors markEpisodeWatched)
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
    // Même traduction saison affichée → ids réels que pour « tout marquer ».
    const altSeasonIds =
      body.seasonNumber !== undefined
        ? await episodeIdsForEffectiveSeason(request.userId, id, media.show.id, body.seasonNumber)
        : null;
    const episodes = await prisma.episode.findMany({
      where: {
        showId: media.show.id,
        ...(altSeasonIds ? { id: { in: altSeasonIds } } : { seasonNumber: body.seasonNumber ?? { gt: 0 } }),
      },
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
    scheduleRecompute(request.userId); // gamification : dé-coche de masse (recompute idempotent)
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
    scheduleRecompute(request.userId); // gamification : retrait du suivi (recompute idempotent)
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
