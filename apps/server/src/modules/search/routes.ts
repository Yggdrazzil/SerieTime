import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { serializeMedia } from '../media/serialize.js';
import { tmdbEnabled, tmdbSearch, tmdbSearchPerson, tmdbTrending } from '../../services/tmdb/index.js';
import { tvdbEnabled, tvdbLanguage, tvdbSearch } from '../../services/tvdb/index.js';

type SearchResult = {
  id: string | null;
  tmdbId: string | null;
  tvdbId: string | null;
  type: 'show' | 'movie';
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
  inLibrary: boolean;
};

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/search', async (request) => {
    const query = z
      .object({ q: z.string().default(''), type: z.enum(['media', 'lists', 'people']).default('media') })
      .parse(request.query ?? {});
    const q = query.q.trim();
    if (!q) return { results: [] };

    if (query.type === 'lists') {
      const lists = await prisma.mediaList.findMany({
        where: { userId: request.userId, title: { contains: q } },
        include: { items: { include: { media: true }, orderBy: { position: 'asc' }, take: 4 } },
      });
      return {
        results: lists.map((l) => ({
          id: l.id,
          title: l.title,
          posterPaths: l.items.map((i) => i.media.posterPath).filter(Boolean),
        })),
      };
    }

    if (query.type === 'people') {
      const local = await prisma.person.findMany({ where: { name: { contains: q } }, take: 10 });
      const remote = tmdbEnabled() ? await tmdbSearchPerson(q) : [];
      const seen = new Set(local.map((p) => p.tmdbId));
      const people = [
        ...local.map((p) => ({ id: p.id, name: p.name, profilePath: p.profilePath })),
        ...(remote as { id: number; name?: string; profile_path?: string | null }[])
          .filter((p) => !seen.has(String(p.id)))
          .slice(0, 10)
          .map((p) => ({ id: `tmdb:${p.id}`, name: p.name ?? '', profilePath: p.profile_path ?? null })),
      ];
      return { results: people };
    }

    // Séries et films : local + TMDb.
    const local = await prisma.media.findMany({
      where: {
        OR: [
          { title: { contains: q } },
          { originalTitle: { contains: q } },
          { localizedTitle: { contains: q } },
        ],
      },
      include: { statuses: { where: { userId: request.userId } } },
      take: 20,
    });
    const results: SearchResult[] = local.map((m) => ({
      id: m.id,
      tmdbId: m.tmdbId,
      tvdbId: m.tvdbId,
      type: m.type as 'show' | 'movie',
      title: m.localizedTitle ?? m.title,
      year: m.year,
      posterPath: m.posterPath,
      backdropPath: m.backdropPath,
      overview: m.overview,
      inLibrary: m.statuses.length > 0,
    }));

    if (tmdbEnabled()) {
      const remote = await tmdbSearch(q, 'multi');
      const knownTmdb = new Set(local.map((m) => m.tmdbId).filter(Boolean));
      for (const r of remote.slice(0, 20)) {
        if (knownTmdb.has(String(r.id))) continue;
        results.push({
          id: null,
          tmdbId: String(r.id),
          tvdbId: null,
          type: r.media_type === 'movie' ? 'movie' : 'show',
          title: r.name ?? r.title ?? '',
          year: (r.first_air_date ?? r.release_date)
            ? new Date((r.first_air_date ?? r.release_date)!).getFullYear()
            : null,
          posterPath: r.poster_path ?? null,
          backdropPath: r.backdrop_path ?? null,
          overview: r.overview ?? null,
          inLibrary: false,
        });
      }
    }

    // Séries TheTVDB (source alternative, ex. exports TV Time). Ajoutées si activée
    // et non déjà présentes (par tvdb_id local ou titre déjà listé).
    if (tvdbEnabled()) {
      const knownTvdb = new Set(local.map((m) => m.tvdbId).filter(Boolean));
      const knownTitles = new Set(results.map((r) => r.title.toLowerCase()));
      const remote = await tvdbSearch(q);
      for (const r of remote.slice(0, 20)) {
        if (knownTvdb.has(r.tvdb_id)) continue;
        if (knownTitles.has(r.name.toLowerCase())) continue;
        results.push({
          id: null,
          tmdbId: null,
          tvdbId: r.tvdb_id,
          type: 'show',
          title: r.name,
          year: r.year ? Number(r.year) : r.first_air_time ? new Date(r.first_air_time).getFullYear() : null,
          posterPath: r.image_url ?? null,
          backdropPath: null,
          overview: r.overviews?.[tvdbLanguage()] ?? r.overview ?? null,
          inLibrary: false,
        });
      }
    }
    return { results };
  });

  // Spec §20.3 : flux personnel de recommandations.
  app.get('/api/explore/feed', async (request) => {
    const watching = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, status: { in: ['watching', 'completed'] } },
      include: { media: true },
      orderBy: { lastWatchedAt: 'desc' },
      take: 5,
    });
    const disliked = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, isHidden: true },
      select: { media: { select: { tmdbId: true } } },
    });
    const dislikedIds = new Set(disliked.map((d) => d.media.tmdbId).filter(Boolean));
    const inLibrary = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId },
      select: { media: { select: { tmdbId: true } } },
    });
    const libraryIds = new Set(inLibrary.map((d) => d.media.tmdbId).filter(Boolean));

    const cards: SearchResult[] = [];
    if (tmdbEnabled()) {
      const { tmdbRecommendations } = await import('../../services/tmdb/index.js');
      for (const status of watching) {
        if (!status.media.tmdbId) continue;
        const recs = await tmdbRecommendations(status.media.type === 'show' ? 'tv' : 'movie', status.media.tmdbId);
        for (const r of recs.slice(0, 3)) {
          if (dislikedIds.has(String(r.id)) || libraryIds.has(String(r.id))) continue;
          cards.push({
            id: null,
            tmdbId: String(r.id),
            tvdbId: null,
            type: status.media.type === 'show' ? 'show' : 'movie',
            title: r.name ?? r.title ?? '',
            year: (r.first_air_date ?? r.release_date)
              ? new Date((r.first_air_date ?? r.release_date)!).getFullYear()
              : null,
            posterPath: r.poster_path ?? null,
            backdropPath: r.backdrop_path ?? null,
            overview: r.overview ?? null,
            inLibrary: false,
          });
        }
      }
      const [tv, movies] = await Promise.all([tmdbTrending('tv'), tmdbTrending('movie')]);
      for (const r of [...tv.slice(0, 6), ...movies.slice(0, 6)]) {
        if (dislikedIds.has(String(r.id)) || libraryIds.has(String(r.id))) continue;
        cards.push({
          id: null,
          tmdbId: String(r.id),
          tvdbId: null,
          type: r.title ? 'movie' : 'show',
          title: r.name ?? r.title ?? '',
          year: (r.first_air_date ?? r.release_date)
            ? new Date((r.first_air_date ?? r.release_date)!).getFullYear()
            : null,
          posterPath: r.poster_path ?? null,
          backdropPath: r.backdrop_path ?? null,
          overview: r.overview ?? null,
          inLibrary: false,
        });
      }
    }
    // Déduplique en conservant l'ordre.
    const seen = new Set<string>();
    const feed = cards.filter((c) => {
      const key = `${c.type}:${c.tmdbId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { feed };
  });

  app.get('/api/explore/discover', async () => {
    if (!tmdbEnabled()) return { shows: [], movies: [] };
    const [tv, movies] = await Promise.all([tmdbTrending('tv'), tmdbTrending('movie')]);
    const map = (r: Awaited<ReturnType<typeof tmdbTrending>>[number], type: 'show' | 'movie') => ({
      tmdbId: String(r.id),
      type,
      title: r.name ?? r.title ?? '',
      posterPath: r.poster_path ?? null,
      backdropPath: r.backdrop_path ?? null,
    });
    return { shows: tv.map((r) => map(r, 'show')), movies: movies.map((r) => map(r, 'movie')) };
  });

  app.get('/api/recommendations', async (request) => {
    const reply = await app.inject({
      method: 'GET',
      url: '/api/explore/feed',
      headers: { authorization: request.headers.authorization ?? '' },
    });
    return reply.json();
  });

  // Médias non appréciés (settings > recommandations).
  app.get('/api/disliked', async (request) => {
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, isHidden: true },
      include: { media: true },
    });
    return { items: statuses.map((s) => serializeMedia(s.media, s)) };
  });

  app.post('/api/disliked/:mediaId', async (request) => {
    const { mediaId } = request.params as { mediaId: string };
    const { hidden } = z.object({ hidden: z.boolean() }).parse(request.body);
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId } },
      create: { userId: request.userId, mediaId, status: 'not_started', isHidden: hidden },
      update: { isHidden: hidden },
    });
    return { ok: true };
  });
}
