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
  // Catégorie du flux Explorer (filtre côté app) — absent des résultats de recherche.
  category?: 'serie' | 'film' | 'anime';
};

// Animé = animation (genre TMDb 16) d'origine japonaise.
function feedCategory(
  r: { genre_ids?: number[]; original_language?: string; origin_country?: string[] },
  type: 'show' | 'movie',
): 'serie' | 'film' | 'anime' {
  const anime =
    (r.genre_ids ?? []).includes(16) &&
    (r.original_language === 'ja' || (r.origin_country ?? []).includes('JP'));
  return anime ? 'anime' : type === 'show' ? 'serie' : 'film';
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/search', async (request) => {
    const query = z
      .object({ q: z.string().default(''), type: z.enum(['media', 'lists', 'people']).default('media') })
      .parse(request.query ?? {});
    const q = query.q.trim();
    // L'app affiche un message clair si aucune source externe n'est configurée.
    const sources = { tmdb: tmdbEnabled(), tvdb: tvdbEnabled() };
    if (!q) return { results: [], sources };

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
      const lang = tvdbLanguage();
      for (const r of remote.slice(0, 20)) {
        if (knownTvdb.has(r.tvdb_id)) continue;
        // Titre localisé (fra) sinon anglais sinon nom d'origine — évite « ワンピース ».
        const title = r.translations?.[lang] ?? r.translations?.['eng'] ?? r.name;
        if (knownTitles.has(title.toLowerCase())) continue;
        results.push({
          id: null,
          tmdbId: null,
          tvdbId: r.tvdb_id,
          type: 'show',
          title,
          year: r.year ? Number(r.year) : r.first_air_time ? new Date(r.first_air_time).getFullYear() : null,
          posterPath: r.image_url ?? null,
          backdropPath: null,
          overview: r.overviews?.[tvdbLanguage()] ?? r.overview ?? null,
          inLibrary: false,
        });
      }
    }
    return { results, sources };
  });

  // Spec §20.3 : flux personnel de recommandations.
  app.get('/api/explore/feed', async (request) => {
    const watching = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, status: { in: ['watching', 'completed'] } },
      include: { media: true },
      orderBy: { lastWatchedAt: 'desc' },
      take: 5,
    });
    const mediaKeyFields = { tmdbId: true, type: true, title: true, originalTitle: true, year: true } as const;
    const disliked = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, isHidden: true },
      select: { media: { select: mediaKeyFields } },
    });
    const inLibrary = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId },
      select: { media: { select: mediaKeyFields } },
    });
    // Les médias ajoutés via TheTVDB n'ont pas toujours de tmdbId : on compare
    // alors type + titre normalisé (+ année quand elle est connue des deux côtés),
    // sinon une série déjà suivie réapparaît dans les recommandations.
    const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    type MediaKey = { tmdbId: string | null; type: string; title: string; originalTitle: string | null; year: number | null };
    const toEntry = (m: MediaKey) => ({
      tmdbId: m.tmdbId,
      type: m.type,
      titles: [m.title, m.originalTitle].filter((t): t is string => Boolean(t)).map(norm),
      year: m.year,
    });
    const dislikedEntries = disliked.map((d) => toEntry(d.media));
    const libraryEntries = inLibrary.map((d) => toEntry(d.media));
    const isKnown = (type: string, tmdbId: string, title: string, year: number | null) =>
      [...dislikedEntries, ...libraryEntries].some(
        (e) =>
          (e.tmdbId != null && e.tmdbId === tmdbId) ||
          (e.type === type &&
            e.titles.includes(norm(title)) &&
            (e.year == null || year == null || e.year === year)),
      );

    const cards: SearchResult[] = [];
    if (tmdbEnabled()) {
      const { tmdbRecommendations } = await import('../../services/tmdb/index.js');
      for (const status of watching) {
        if (!status.media.tmdbId) continue;
        const recs = await tmdbRecommendations(status.media.type === 'show' ? 'tv' : 'movie', status.media.tmdbId);
        // Échantillon aléatoire : le tirage change à chaque rafraîchissement du flux.
        const picks = [...recs].sort(() => Math.random() - 0.5).slice(0, 3);
        for (const r of picks) {
          const recType = status.media.type === 'show' ? 'show' : 'movie';
          const recTitle = r.name ?? r.title ?? '';
          const recYear = (r.first_air_date ?? r.release_date)
            ? new Date((r.first_air_date ?? r.release_date)!).getFullYear()
            : null;
          if (isKnown(recType, String(r.id), recTitle, recYear)) continue;
          cards.push({
            id: null,
            tmdbId: String(r.id),
            tvdbId: null,
            type: recType,
            category: feedCategory(r, recType),
            title: recTitle,
            year: recYear,
            posterPath: r.poster_path ?? null,
            backdropPath: r.backdrop_path ?? null,
            overview: r.overview ?? null,
            inLibrary: false,
          });
        }
      }
      // Page tirée au hasard : le pull-to-refresh / bouton ↻ renouvelle le flux.
      const page = 1 + Math.floor(Math.random() * 3);
      // Décennie tirée au hasard : le flux n'est pas QUE des sorties récentes,
      // il propose aussi des titres plus anciens (toutes époques).
      const decadeStart = 1980 + Math.floor(Math.random() * 5) * 10; // 1980..2020
      const yGte = decadeStart;
      const yLte = decadeStart + 9;
      // Viviers : tendances (récent) + découverte populaire + CLASSIQUES toutes
      // époques (tri par votes) + une DÉCENNIE aléatoire + un vivier ANIMÉ dédié.
      const { tmdbDiscover } = await import('../../services/tmdb/index.js');
      const [tv, movies, discTv, discMovies, classicTv, classicMovies, oldTv, oldMovies, animeTv, animeMovies, animeOld] =
        await Promise.all([
          tmdbTrending('tv', page),
          tmdbTrending('movie', page),
          tmdbDiscover('tv', { page }),
          tmdbDiscover('movie', { page }),
          tmdbDiscover('tv', { page, sort: 'vote_count.desc' }),
          tmdbDiscover('movie', { page, sort: 'vote_count.desc' }),
          tmdbDiscover('tv', { page, yearGte: yGte, yearLte: yLte, sort: 'vote_count.desc' }),
          tmdbDiscover('movie', { page, yearGte: yGte, yearLte: yLte, sort: 'vote_count.desc' }),
          tmdbDiscover('tv', { genres: [16], language: 'ja', page }),
          tmdbDiscover('movie', { genres: [16], language: 'ja', page }),
          tmdbDiscover('tv', { genres: [16], language: 'ja', page, sort: 'vote_count.desc' }),
        ]);
      const pool = [
        ...tv,
        ...movies,
        ...discTv,
        ...discMovies,
        ...classicTv,
        ...classicMovies,
        ...oldTv,
        ...oldMovies,
        ...animeTv,
        ...animeMovies,
        ...animeOld,
      ].sort(() => Math.random() - 0.5);
      for (const r of pool) {
        const trendType = r.title ? 'movie' : 'show';
        const trendTitle = r.name ?? r.title ?? '';
        const trendYear = (r.first_air_date ?? r.release_date)
          ? new Date((r.first_air_date ?? r.release_date)!).getFullYear()
          : null;
        if (isKnown(trendType, String(r.id), trendTitle, trendYear)) continue;
        cards.push({
          id: null,
          tmdbId: String(r.id),
          tvdbId: null,
          type: trendType,
          category: feedCategory(r, trendType),
          title: trendTitle,
          year: trendYear,
          posterPath: r.poster_path ?? null,
          backdropPath: r.backdrop_path ?? null,
          overview: r.overview ?? null,
          inLibrary: false,
        });
      }
    }
    // Déduplique en conservant l'ordre — par id TMDb ET par titre normalisé
    // (la même œuvre peut exister sous plusieurs ids selon la plateforme).
    const seen = new Set<string>();
    const deduped = cards.filter((c) => {
      const keys = [`${c.type}:${c.tmdbId}`, `${c.type}:${norm(c.title)}`];
      if (keys.some((k) => seen.has(k))) return false;
      keys.forEach((k) => seen.add(k));
      return true;
    });
    // Plafond équilibré : au plus PER_CAT items par catégorie (serie/film/anime),
    // pour que chaque filtre de l'app reste fourni sans renvoyer une liste énorme.
    const PER_CAT = 22;
    const perCat = new Map<string, number>();
    const feed = deduped.filter((c) => {
      const cat = c.category ?? (c.type === 'show' ? 'serie' : 'film');
      const n = perCat.get(cat) ?? 0;
      if (n >= PER_CAT) return false;
      perCat.set(cat, n + 1);
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
