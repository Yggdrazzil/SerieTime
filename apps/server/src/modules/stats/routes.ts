import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
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

  // Classement (Bloc 2) : moi + les personnes que je suis, triés par temps de
  // visionnage. Agrégation en SQL brut (une requête pour tous les comptes) :
  // indispensable pour rester rapide avec des bibliothèques à 20k épisodes.
  app.get('/api/stats/leaderboard', async (request) => {
    const userId = request.userId;
    const following = await prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    const ids = [userId, ...following.map((f) => f.followingId)];

    const [epRows, mvRows, users] = await Promise.all([
      prisma.$queryRaw<{ userId: string; minutes: bigint | number; count: bigint | number }[]>`
        SELECT ues.userId AS userId,
               SUM(COALESCE(e.runtime, m.runtime, ${EP_FALLBACK_MIN})) AS minutes,
               COUNT(*) AS count
        FROM "UserEpisodeStatus" ues
        JOIN "Episode" e ON e.id = ues.episodeId
        JOIN "Show" s ON s.id = e.showId
        JOIN "Media" m ON m.id = s.mediaId
        WHERE ues.status = 'watched' AND ues.userId IN (${Prisma.join(ids)})
        GROUP BY ues.userId`,
      prisma.$queryRaw<{ userId: string; minutes: bigint | number; count: bigint | number }[]>`
        SELECT ums.userId AS userId,
               SUM(COALESCE(m.runtime, ${MOVIE_FALLBACK_MIN})) AS minutes,
               COUNT(*) AS count
        FROM "UserMediaStatus" ums
        JOIN "Media" m ON m.id = ums.mediaId
        WHERE ums.status = 'completed' AND m.type = 'movie' AND ums.userId IN (${Prisma.join(ids)})
        GROUP BY ums.userId`,
      prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true, avatarUrl: true },
      }),
    ]);

    const ep = new Map(epRows.map((r) => [r.userId, { minutes: Number(r.minutes), count: Number(r.count) }]));
    const mv = new Map(mvRows.map((r) => [r.userId, { minutes: Number(r.minutes), count: Number(r.count) }]));
    const entry = (u: (typeof users)[number]) => ({
      userId: u.id,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      isMe: u.id === userId,
    });
    const series = users
      .map((u) => ({ ...entry(u), minutes: ep.get(u.id)?.minutes ?? 0, episodes: ep.get(u.id)?.count ?? 0 }))
      .sort((a, b) => b.minutes - a.minutes);
    const movies = users
      .map((u) => ({ ...entry(u), minutes: mv.get(u.id)?.minutes ?? 0, movies: mv.get(u.id)?.count ?? 0 }))
      .sort((a, b) => b.minutes - a.minutes);
    return { series, movies };
  });

  // Badges (Bloc 3) : calculés à la volée depuis l'état du compte — pas de table
  // de déblocage, un badge reflète toujours la réalité (et « se répare » seul
  // après un import). Icônes maison (Feather + couleur), pas d'art TV Time.
  app.get('/api/stats/badges', async (request) => {
    const userId = request.userId;
    const [
      episodesWatched,
      moviesWatched,
      showsAdded,
      showsCompleted,
      favorites,
      comments,
      epRatings,
      mediaRatings,
      followingCount,
      followersCount,
      imports,
      minutesRow,
      marathonRow,
    ] = await Promise.all([
      prisma.userEpisodeStatus.count({ where: { userId, status: 'watched' } }),
      prisma.userMediaStatus.count({ where: { userId, status: 'completed', media: { type: 'movie' } } }),
      prisma.userMediaStatus.count({ where: { userId, media: { type: 'show' } } }),
      prisma.userMediaStatus.count({ where: { userId, status: 'completed', media: { type: 'show' } } }),
      prisma.userMediaStatus.count({ where: { userId, isFavorite: true } }),
      prisma.comment.count({ where: { userId } }),
      prisma.userEpisodeStatus.count({ where: { userId, rating: { not: null } } }),
      prisma.userMediaStatus.count({ where: { userId, rating: { not: null } } }),
      prisma.follow.count({ where: { followerId: userId } }),
      prisma.follow.count({ where: { followingId: userId } }),
      prisma.import.count({ where: { userId } }),
      prisma.$queryRaw<{ minutes: bigint | number | null }[]>`
        SELECT SUM(COALESCE(e.runtime, m.runtime, ${EP_FALLBACK_MIN})) AS minutes
        FROM "UserEpisodeStatus" ues
        JOIN "Episode" e ON e.id = ues.episodeId
        JOIN "Show" s ON s.id = e.showId
        JOIN "Media" m ON m.id = s.mediaId
        WHERE ues.status = 'watched' AND ues.userId = ${userId}`,
      prisma.$queryRaw<{ maxRun: bigint | number | null }[]>`
        SELECT MAX(c) AS maxRun FROM (
          SELECT COUNT(*) AS c FROM "UserEpisodeStatus" ues
          JOIN "Episode" e ON e.id = ues.episodeId
          WHERE ues.userId = ${userId} AND ues.status = 'watched' AND ues.watchedAt IS NOT NULL
          GROUP BY e.showId, date(ues.watchedAt / 1000, 'unixepoch')
        )`,
    ]);
    const minutes = Number(minutesRow[0]?.minutes ?? 0);
    const marathon = Number(marathonRow[0]?.maxRun ?? 0);
    const ratings = epRatings + mediaRatings;

    // (id, titre, description, icône Feather, couleur, valeur courante, objectif)
    const def = (
      id: string, title: string, description: string, icon: string, color: string, current: number, target: number,
    ) => ({ id, title, description, icon, color, earned: current >= target, progress: { current: Math.min(current, target), target } });

    const sections = [
      {
        title: 'Badges de visionnage',
        badges: [
          def('first-episode', 'Premier pas', 'Regarder son premier épisode', 'play', '#62D600', episodesWatched, 1),
          def('serial-100', 'Habitué', 'Regarder 100 épisodes', 'tv', '#0075D9', episodesWatched, 100),
          def('serial-1000', 'Accro aux séries', 'Regarder 1 000 épisodes', 'tv', '#7B5CD6', episodesWatched, 1000),
          def('serial-5000', 'Marathonien du canapé', 'Regarder 5 000 épisodes', 'tv', '#E8871E', episodesWatched, 5000),
          def('serial-20000', 'Légende du binge', 'Regarder 20 000 épisodes', 'award', '#FFD400', episodesWatched, 20000),
          def('marathon-10', 'Marathonien', "10 épisodes d'une même série en un jour", 'zap', '#C7222A', marathon, 10),
          def('time-month', 'Un mois de ta vie', "Cumuler 1 mois devant des séries", 'clock', '#0FA47A', minutes, 43_200),
          def('time-year', 'Une année entière', "Cumuler 1 an devant des séries", 'clock', '#B8860B', minutes, 525_600),
        ],
      },
      {
        title: 'Badges de films',
        badges: [
          def('movie-1', 'Cinéphile en herbe', 'Regarder son premier film', 'film', '#62D600', moviesWatched, 1),
          def('movie-50', 'Rat de cinéma', 'Regarder 50 films', 'film', '#0075D9', moviesWatched, 50),
          def('movie-500', 'Encyclopédie vivante', 'Regarder 500 films', 'award', '#FFD400', moviesWatched, 500),
        ],
      },
      {
        title: 'Badges de collection',
        badges: [
          def('shows-10', 'Collectionneur', 'Suivre 10 séries', 'bookmark', '#62D600', showsAdded, 10),
          def('shows-100', 'Grande bibliothèque', 'Suivre 100 séries', 'bookmark', '#0075D9', showsAdded, 100),
          def('shows-500', 'Archiviste', 'Suivre 500 séries', 'archive', '#7B5CD6', showsAdded, 500),
          def('completed-1', 'Finisseur', 'Terminer une série', 'check-circle', '#62D600', showsCompleted, 1),
          def('completed-25', 'Jusqu’au générique', 'Terminer 25 séries', 'check-circle', '#E8871E', showsCompleted, 25),
          def('favorite-1', 'Coup de cœur', 'Ajouter un favori', 'heart', '#C7222A', favorites, 1),
        ],
      },
      {
        title: 'Badges sociaux',
        badges: [
          def('comment-1', 'Bavard', 'Écrire un commentaire', 'message-circle', '#0075D9', comments, 1),
          def('rating-1', 'Critique', 'Noter une série ou un film', 'star', '#FFD400', ratings, 1),
          def('follow-1', 'Connecté', "S'abonner à quelqu'un", 'user-plus', '#62D600', followingCount, 1),
          def('follower-1', 'Populaire', 'Avoir un abonné', 'users', '#7B5CD6', followersCount, 1),
        ],
      },
      {
        title: "Badges d'application",
        badges: [
          def('import-1', 'Migrateur', 'Importer son archive TV Time', 'download', '#0FA47A', imports, 1),
        ],
      },
    ];

    const earned = sections.reduce((n, s) => n + s.badges.filter((b) => b.earned).length, 0);
    const total = sections.reduce((n, s) => n + s.badges.length, 0);
    return { earned, total, sections };
  });
}
