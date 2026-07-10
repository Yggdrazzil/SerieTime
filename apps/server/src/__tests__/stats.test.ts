import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Stats détaillées (/api/stats/detailed) : compte vide → zéros propres ;
// compte avec visionnages → totaux, hebdo, genres, chaînes, marathons corrects.
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-stats-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'stats.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let app: FastifyInstance;
let token = '';
const auth = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
  const { buildApp } = await import('../app.js');
  app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName: 'Stats', email: 'stats@example.com', password: 'secret123' },
  });
  token = res.json().token;
});

describe('stats détaillées', () => {
  it('compte vide : zéros et listes vides, pas de crash', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/detailed', headers: auth() });
    expect(res.statusCode).toBe(200);
    const { series, movies } = res.json();
    expect(series.episodesWatched).toBe(0);
    expect(series.showsAdded).toBe(0);
    expect(series.genres).toEqual([]);
    expect(series.networks).toEqual([]);
    expect(series.marathons).toEqual([]);
    expect(series.weekly).toHaveLength(12);
    expect(series.weekly.every((w: { episodes: number }) => w.episodes === 0)).toBe(true);
    expect(movies.moviesWatched).toBe(0);
    expect(movies.genres).toEqual([]);
  });

  it('agrège épisodes vus, genres, chaînes, marathons et films', async () => {
    const { prisma } = await import('../db/client.js');
    const me = await prisma.user.findFirstOrThrow({ where: { email: 'stats@example.com' } });

    // Série suivie : 2 genres, une chaîne, 3 épisodes vus AUJOURD'HUI (même jour
    // → marathon de 3), runtime 30 min chacun.
    const media = await prisma.media.create({
      data: {
        type: 'show',
        title: 'Dark',
        genres: 'Drame, Science-Fiction',
        runtime: 30,
        show: { create: { network: 'Netflix', inProduction: true } },
      },
      include: { show: true },
    });
    await prisma.userMediaStatus.create({ data: { userId: me.id, mediaId: media.id, status: 'watching' } });
    const now = new Date();
    for (let n = 1; n <= 3; n++) {
      const ep = await prisma.episode.create({
        data: { showId: media.show!.id, seasonNumber: 1, episodeNumber: n, title: `Ep ${n}` },
      });
      await prisma.userEpisodeStatus.create({
        data: { userId: me.id, episodeId: ep.id, status: 'watched', watchedAt: now },
      });
    }

    // Film vu (runtime 120), complété aujourd'hui.
    const movie = await prisma.media.create({
      data: { type: 'movie', title: 'Inception', genres: 'Action', runtime: 120, movie: { create: {} } },
    });
    await prisma.userMediaStatus.create({
      data: { userId: me.id, mediaId: movie.id, status: 'completed', completedAt: now, lastWatchedAt: now },
    });

    const res = await app.inject({ method: 'GET', url: '/api/stats/detailed', headers: auth() });
    expect(res.statusCode).toBe(200);
    const { series, movies } = res.json();

    expect(series.episodesWatched).toBe(3);
    expect(series.episodesLast7d).toBe(3);
    expect(series.minutes).toBe(90); // 3 × 30
    expect(series.showsAdded).toBe(1);
    expect(series.showsInProduction).toBe(1);
    // Genres éclatés depuis la chaîne « Drame, Science-Fiction ».
    expect(series.genres).toEqual(
      expect.arrayContaining([
        { name: 'Drame', count: 1 },
        { name: 'Science-Fiction', count: 1 },
      ]),
    );
    expect(series.networks).toEqual([{ name: 'Netflix', count: 1 }]);
    expect(series.marathons[0]).toMatchObject({ title: 'Dark', episodes: 3 });
    // La semaine courante (dernière barre) porte les 3 épisodes.
    expect(series.weekly.at(-1).episodes).toBe(3);
    expect(series.weekly.at(-1).hours).toBe(2); // 90 min arrondi → 2 h

    expect(movies.moviesWatched).toBe(1);
    expect(movies.minutes).toBe(120);
    expect(movies.weekly.at(-1).count).toBe(1);
    expect(movies.genres).toEqual([{ name: 'Action', count: 1 }]);
  });

  it('classement : moi + mes abonnements, triés par temps', async () => {
    const { prisma } = await import('../db/client.js');
    // Ami avec 1 épisode vu (30 min) — moi j'en ai 3 (90 min) → je suis 1er.
    const friendRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { displayName: 'Ami', email: 'ami@example.com', password: 'secret123' },
    });
    const friendId = friendRes.json().user.id as string;
    const me = await prisma.user.findFirstOrThrow({ where: { email: 'stats@example.com' } });
    await prisma.follow.create({ data: { followerId: me.id, followingId: friendId } });
    const ep = await prisma.episode.findFirstOrThrow({ where: { episodeNumber: 1 } });
    await prisma.userEpisodeStatus.create({
      data: { userId: friendId, episodeId: ep.id, status: 'watched', watchedAt: new Date() },
    });

    const res = await app.inject({ method: 'GET', url: '/api/stats/leaderboard', headers: auth() });
    expect(res.statusCode).toBe(200);
    const { series, movies } = res.json();
    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ isMe: true, minutes: 90, episodes: 3 });
    expect(series[1]).toMatchObject({ displayName: 'Ami', isMe: false, minutes: 30, episodes: 1 });
    // Films : l'ami n'en a pas vu → 0 minute, moi 120.
    expect(movies[0]).toMatchObject({ isMe: true, minutes: 120 });
    expect(movies[1]).toMatchObject({ isMe: false, minutes: 0 });
  });

  it('badges : débloqués + progression cohérents', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats/badges', headers: auth() });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.total).toBeGreaterThan(15);
    const all = data.sections.flatMap((s: { badges: unknown[] }) => s.badges) as {
      id: string; earned: boolean; progress: { current: number; target: number };
    }[];
    const byId = Object.fromEntries(all.map((b) => [b.id, b]));
    expect(byId['first-episode'].earned).toBe(true); // 3 épisodes vus
    expect(byId['serial-100']).toMatchObject({ earned: false, progress: { current: 3, target: 100 } });
    expect(byId['movie-1'].earned).toBe(true); // 1 film vu
    expect(byId['marathon-10']).toMatchObject({ earned: false, progress: { current: 3, target: 10 } });
    expect(byId['follow-1'].earned).toBe(true); // je suis « Ami »
    expect(byId['comment-1'].earned).toBe(false);
    // Le compteur global correspond au détail.
    expect(data.earned).toBe(all.filter((b) => b.earned).length);
  });
});
