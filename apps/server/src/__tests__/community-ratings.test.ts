import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-community-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'community.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let app: FastifyInstance;
let tokenA = '';
let tokenB = '';
let mediaId = '';
let emptyMediaId = '';
const episodeIds: string[] = [];

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
  const { buildApp } = await import('../app.js');
  app = await buildApp();

  for (const [who, setter] of [
    ['a', (t: string) => (tokenA = t)],
    ['b', (t: string) => (tokenB = t)],
  ] as const) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { displayName: `User ${who}`, email: `${who}@example.com`, password: 'secret123' },
    });
    expect(res.statusCode).toBe(200);
    setter(res.json().token);
  }

  const { prisma } = await import('../db/client.js');
  // Série à 2 saisons (+ un spécial qui doit être ignoré par le graphe).
  const media = await prisma.media.create({
    data: { type: 'show', title: 'Notée', year: 2020, show: { create: {} } },
  });
  mediaId = media.id;
  const show = await prisma.show.findFirstOrThrow({ where: { mediaId } });
  for (const [season, episode] of [
    [1, 1],
    [1, 2],
    [2, 1],
    [0, 1],
  ]) {
    const ep = await prisma.episode.create({
      data: {
        showId: show.id,
        seasonNumber: season,
        episodeNumber: episode,
        title: `S${season}E${episode}`,
        airDate: new Date('2020-01-01'),
      },
    });
    episodeIds.push(ep.id);
  }
  const empty = await prisma.media.create({
    data: { type: 'show', title: 'Sans épisodes', year: 2021, show: { create: {} } },
  });
  emptyMediaId = empty.id;
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('Notes de la communauté (graphe de la fiche)', () => {
  it('404 quand la série n’a pas d’épisodes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/shows/${emptyMediaId}/community-ratings`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('moyenne les notes de TOUS les utilisateurs, par saison, spéciaux exclus', async () => {
    // S1E1 : 4 (A) et 2 (B) -> moyenne 3 ; S1E2 : 5 (A seul) ; S2E1 : 1 (B seul).
    const rate = (token: string, episodeId: string, rating: number) =>
      app.inject({
        method: 'POST',
        url: `/api/episodes/${episodeId}/rating`,
        payload: { rating },
        headers: { authorization: `Bearer ${token}` },
      });
    expect((await rate(tokenA, episodeIds[0], 4)).statusCode).toBe(200);
    expect((await rate(tokenB, episodeIds[0], 2)).statusCode).toBe(200);
    expect((await rate(tokenA, episodeIds[1], 5)).statusCode).toBe(200);
    expect((await rate(tokenB, episodeIds[2], 1)).statusCode).toBe(200);
    // Une note sur un épisode spécial ne doit pas apparaître dans le graphe.
    expect((await rate(tokenA, episodeIds[3], 5)).statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: `/api/shows/${mediaId}/community-ratings`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(200);
    const { seasons } = res.json() as {
      seasons: { seasonNumber: number; points: { episodeNumber: number; avg: number; count: number }[] }[];
    };
    expect(seasons.map((s) => s.seasonNumber).sort()).toEqual([1, 2]);
    const s1 = seasons.find((s) => s.seasonNumber === 1)!;
    expect(s1.points).toEqual([
      { episodeNumber: 1, avg: 3, count: 2 },
      { episodeNumber: 2, avg: 5, count: 1 },
    ]);
    const s2 = seasons.find((s) => s.seasonNumber === 2)!;
    expect(s2.points).toEqual([{ episodeNumber: 1, avg: 1, count: 1 }]);
  });

  it('les épisodes jamais notés n’apparaissent pas comme points', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/shows/${mediaId}/community-ratings`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const { seasons } = res.json() as { seasons: { points: unknown[] }[] };
    // 3 épisodes réguliers notés au total (S1E1, S1E2, S2E1) : 3 points.
    expect(seasons.reduce((n, s) => n + s.points.length, 0)).toBe(3);
  });
});
