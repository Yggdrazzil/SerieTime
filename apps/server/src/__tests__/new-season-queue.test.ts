import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-newseason-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'newseason.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let app: FastifyInstance;
let token = '';
let mediaId = '';
let showId = '';

const auth = () => ({ authorization: `Bearer ${token}` });
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

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
    payload: { displayName: 'Queue', email: 'queue@example.com', password: 'secret123' },
  });
  expect(res.statusCode).toBe(200);
  token = res.json().token;

  // Série EN COURS (« Continuing ») dont la saison 1 (2 épisodes diffusés) est
  // entièrement vue — cas Clevatess avant l'arrivée de la saison 2.
  const { prisma } = await import('../db/client.js');
  const media = await prisma.media.create({
    data: { type: 'show', title: 'Clevatess-like', status: 'Continuing', show: { create: {} } },
    include: { show: true },
  });
  mediaId = media.id;
  showId = media.show!.id;
  await prisma.episode.createMany({
    data: [
      { showId, seasonNumber: 1, episodeNumber: 1, title: 'S1E1', airDate: daysAgo(60) },
      { showId, seasonNumber: 1, episodeNumber: 2, title: 'S1E2', airDate: daysAgo(53) },
    ],
  });
  await app.inject({ method: 'POST', url: `/api/shows/${mediaId}/follow`, headers: auth() });
  await app.inject({ method: 'POST', url: `/api/shows/${mediaId}/mark-all-watched`, headers: auth() });
  // Statut « Terminée » hérité (import TV Time / ancienne version) : le cas qui
  // faisait disparaître la série de la file pour toujours.
  await prisma.userMediaStatus.update({
    where: { userId_mediaId: { userId: res.json().user.id, mediaId } },
    data: { status: 'completed' },
  });
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('File « À voir » — nouvelle saison d’une série terminée/à jour', () => {
  it('série à jour (aucun nouvel épisode) : absente de la file', async () => {
    const q = await app.inject({ method: 'GET', url: '/api/shows/queue', headers: auth() });
    expect(q.statusCode).toBe(200);
    expect(q.json().items.map((i: { media: { id: string } }) => i.media.id)).not.toContain(mediaId);
  });

  it('un épisode d’une NOUVELLE saison est diffusé : la série revient dans « À voir » avec badge PREMIERE', async () => {
    const { prisma } = await import('../db/client.js');
    await prisma.episode.createMany({
      data: [
        { showId, seasonNumber: 2, episodeNumber: 1, title: 'S2E1', airDate: daysAgo(2) },
        { showId, seasonNumber: 2, episodeNumber: 2, title: 'S2E2', airDate: new Date(Date.now() + 5 * 86_400_000) },
      ],
    });
    const q = await app.inject({ method: 'GET', url: '/api/shows/queue', headers: auth() });
    expect(q.statusCode).toBe(200);
    const item = q.json().items.find((i: { media: { id: string } }) => i.media.id === mediaId);
    expect(item).toBeTruthy();
    expect(item.group).toBe('a_voir');
    expect(item.nextEpisode.seasonNumber).toBe(2);
    expect(item.nextEpisode.episodeNumber).toBe(1);
    expect(item.badges).toContain('PREMIERE');
  });

  it('l’épisode coché : la série repasse « En cours » et sort de la file (E2 pas encore diffusé)', async () => {
    const q = await app.inject({ method: 'GET', url: '/api/shows/queue', headers: auth() });
    const item = q.json().items.find((i: { media: { id: string } }) => i.media.id === mediaId);
    const mark = await app.inject({
      method: 'POST',
      url: `/api/episodes/${item.nextEpisode.id}/watched`,
      headers: auth(),
    });
    expect(mark.statusCode).toBe(200);
    const q2 = await app.inject({ method: 'GET', url: '/api/shows/queue', headers: auth() });
    expect(q2.json().items.map((i: { media: { id: string } }) => i.media.id)).not.toContain(mediaId);
    const { prisma } = await import('../db/client.js');
    const st = await prisma.userMediaStatus.findFirst({ where: { mediaId } });
    expect(st?.status).toBe('watching'); // série continue non terminée
  });
});
