import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';

// Runtimes de repli quand la donnée manque (mêmes hypothèses que le calcul du profil).
const EP_FALLBACK_MIN = 42;
const MOVIE_FALLBACK_MIN = 115;

const DAY = 86_400_000;
const WEEKS = 12;

// Clé de semaine (lundi) pour regrouper les visionnages.
function weekStart(d: Date): number {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  const day = (t.getDay() + 6) % 7; // lundi = 0
  return t.getTime() - day * DAY;
}
function dayKey(d: Date): string {
  const t = new Date(d);
  return `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`;
}
function topCounts(items: string[], limit: number): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const it of items) {
    const name = it.trim();
    if (!name) continue;
    m.set(name, (m.get(name) ?? 0) + 1);
  }
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, limit);
}
// Genres stockés en chaîne séparée par virgules → on éclate et on compte chaque genre.
function splitGenres(raw: string | null | undefined): string[] {
  return (raw ?? '').split(',').map((g) => g.trim()).filter(Boolean);
}

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // Stats détaillées (Bloc 1) : totaux, graphiques hebdo, genres, chaînes,
  // marathons, projection « quand tu rattraperas ». Séries + films.
  app.get('/api/stats/detailed', async (request) => {
    const userId = request.userId;
    const now = new Date();
    const since = new Date(now.getTime() - WEEKS * 7 * DAY);

    const [watchedEps, showLib, movieLib, watchedMovies] = await Promise.all([
      // Épisodes vus (dates + runtime + série) pour totaux, hebdo, marathons.
      prisma.userEpisodeStatus.findMany({
        where: { userId, status: 'watched', watchedAt: { not: null } },
        select: {
          watchedAt: true,
          episode: { select: { runtime: true, showId: true, show: { select: { media: { select: { runtime: true, title: true, localizedTitle: true } } } } } },
        },
      }),
      // Bibliothèque séries : genres, chaîne, en production.
      prisma.userMediaStatus.findMany({
        where: { userId, media: { type: 'show' } },
        select: { media: { select: { genres: true } }, },
      }),
      // Bibliothèque films : genres.
      prisma.userMediaStatus.findMany({
        where: { userId, media: { type: 'movie' } },
        select: { media: { select: { genres: true } } },
      }),
      // Films vus (date + runtime) pour totaux + hebdo.
      prisma.userMediaStatus.findMany({
        where: { userId, status: 'completed', media: { type: 'movie' } },
        select: { completedAt: true, lastWatchedAt: true, media: { select: { runtime: true } } },
      }),
    ]);

    // --- Réseaux/chaînes séries : via le show lié (requête légère séparée) ---
    const showRows = await prisma.userMediaStatus.findMany({
      where: { userId, media: { type: 'show' } },
      select: { media: { select: { show: { select: { network: true, platform: true, inProduction: true } } } } },
    });

    // ===== SÉRIES =====
    const epWeekly = new Map<number, { episodes: number; minutes: number }>();
    const marathonByShow = new Map<string, { title: string; perDay: Map<string, number>; minutes: number }>();
    let epLast7d = 0;
    let showMinutesTotal = 0;
    for (const e of watchedEps) {
      const min = e.episode.runtime ?? e.episode.show.media.runtime ?? EP_FALLBACK_MIN;
      showMinutesTotal += min;
      const w = e.watchedAt as Date;
      if (now.getTime() - w.getTime() < 7 * DAY) epLast7d += 1;
      if (w >= since) {
        const k = weekStart(w);
        const cur = epWeekly.get(k) ?? { episodes: 0, minutes: 0 };
        cur.episodes += 1;
        cur.minutes += min;
        epWeekly.set(k, cur);
      }
      const showId = e.episode.showId;
      const title = e.episode.show.media.localizedTitle ?? e.episode.show.media.title;
      const m = marathonByShow.get(showId) ?? { title, perDay: new Map(), minutes: 0 };
      const dk = dayKey(w);
      m.perDay.set(dk, (m.perDay.get(dk) ?? 0) + 1);
      m.minutes += min;
      marathonByShow.set(showId, m);
    }

    // Marathons : max d'épisodes d'une série vus le même jour.
    const marathons = [...marathonByShow.values()]
      .map((m) => ({ title: m.title, episodes: Math.max(0, ...m.perDay.values()), hours: Math.round(m.minutes / 60) }))
      .sort((a, b) => b.episodes - a.episodes)
      .slice(0, 5);

    const showGenres = topCounts(showLib.flatMap((s) => splitGenres(s.media.genres)), 6);
    const showNetworks = topCounts(
      showRows.map((r) => r.media.show?.network ?? r.media.show?.platform ?? '').filter(Boolean),
      6,
    );
    const showsInProduction = showRows.filter((r) => r.media.show?.inProduction).length;

    // ===== FILMS =====
    const mvWeekly = new Map<number, { count: number; minutes: number }>();
    let mvLast7d = 0;
    let movieMinutesTotal = 0;
    for (const m of watchedMovies) {
      const min = m.media.runtime ?? MOVIE_FALLBACK_MIN;
      movieMinutesTotal += min;
      const w = (m.completedAt ?? m.lastWatchedAt) as Date | null;
      if (!w) continue;
      if (now.getTime() - w.getTime() < 7 * DAY) mvLast7d += 1;
      if (w >= since) {
        const k = weekStart(w);
        const cur = mvWeekly.get(k) ?? { count: 0, minutes: 0 };
        cur.count += 1;
        cur.minutes += min;
        mvWeekly.set(k, cur);
      }
    }

    // Séries de semaines continues (même vides) pour un graphique régulier.
    const weeks: number[] = [];
    const base = weekStart(now);
    for (let i = WEEKS - 1; i >= 0; i--) weeks.push(base - i * 7 * DAY);
    const label = (ts: number) => {
      const d = new Date(ts);
      return `${d.getDate()}/${d.getMonth() + 1}`;
    };

    return {
      series: {
        episodesWatched: watchedEps.length,
        episodesLast7d: epLast7d,
        minutes: showMinutesTotal,
        showsAdded: showLib.length,
        showsInProduction,
        weekly: weeks.map((ts) => ({ label: label(ts), episodes: epWeekly.get(ts)?.episodes ?? 0, hours: Math.round((epWeekly.get(ts)?.minutes ?? 0) / 60) })),
        genres: showGenres,
        networks: showNetworks,
        marathons,
      },
      movies: {
        moviesWatched: watchedMovies.length,
        moviesLast7d: mvLast7d,
        minutes: movieMinutesTotal,
        moviesAdded: movieLib.length,
        weekly: weeks.map((ts) => ({ label: label(ts), count: mvWeekly.get(ts)?.count ?? 0, hours: Math.round((mvWeekly.get(ts)?.minutes ?? 0) / 60) })),
        genres: topCounts(movieLib.flatMap((m) => splitGenres(m.media.genres)), 6),
      },
    };
  });
}
