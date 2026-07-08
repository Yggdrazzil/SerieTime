import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Épisodes spéciaux (saison 0) : « tout marquer » les ignore, la série est
// « à jour » sans eux, et « tout démarquer » ne les touche pas non plus.
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-specials-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'specials.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let app: FastifyInstance;
let token = '';
let mediaId = '';
let showId = '';

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
    payload: { displayName: 'Spécial', email: 'specials@example.com', password: 'secret123' },
  });
  token = res.json().token;

  // Série close (« Ended ») : 2 épisodes réguliers en saison 1 + 3 spéciaux (saison 0).
  const { prisma } = await import('../db/client.js');
  const media = await prisma.media.create({
    data: { type: 'show', title: 'Tokyo Ghoul', status: 'Ended', show: { create: {} } },
    include: { show: true },
  });
  mediaId = media.id;
  showId = media.show!.id;
  await prisma.season.createMany({
    data: [
      { showId, seasonNumber: 0, title: 'Spéciaux' },
      { showId, seasonNumber: 1, title: 'Saison 1' },
    ],
  });
  await prisma.episode.createMany({
    data: [
      { showId, seasonNumber: 1, episodeNumber: 1, title: 'Ep 1' },
      { showId, seasonNumber: 1, episodeNumber: 2, title: 'Ep 2' },
      { showId, seasonNumber: 0, episodeNumber: 1, title: 'OVA 1' },
      { showId, seasonNumber: 0, episodeNumber: 2, title: 'OVA 2' },
      { showId, seasonNumber: 0, episodeNumber: 3, title: 'OVA 3' },
    ],
  });
  await app.inject({ method: 'POST', url: `/api/shows/${mediaId}/follow`, headers: auth() });
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('Épisodes spéciaux (façon TV Time)', () => {
  it('« tout marquer » coche les saisons régulières mais pas les spéciaux', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/shows/${mediaId}/mark-all-watched`, headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(2); // seulement la saison 1

    const eps = await app.inject({ method: 'GET', url: `/api/shows/${mediaId}/episodes`, headers: auth() });
    const seasons = eps.json().seasons as { seasonNumber: number; watchedCount: number; totalCount: number }[];
    const s1 = seasons.find((s) => s.seasonNumber === 1)!;
    const s0 = seasons.find((s) => s.seasonNumber === 0)!;
    expect(s1.watchedCount).toBe(2);
    expect(s0.watchedCount).toBe(0);
  });

  it('la série est « à jour » (terminée) même sans les spéciaux', async () => {
    const detail = await app.inject({ method: 'GET', url: `/api/shows/${mediaId}`, headers: auth() });
    expect(detail.json().media.userStatus).toBe('completed');
    // Série à jour → absente de la file « À voir ».
    const queue = await app.inject({ method: 'GET', url: '/api/shows/queue', headers: auth() });
    expect(queue.json().items).toHaveLength(0);
  });

  it('« tout démarquer » enlève les saisons régulières sans toucher aux spéciaux', async () => {
    // On coche d'abord un spécial à la main.
    const eps0 = await app.inject({ method: 'GET', url: `/api/shows/${mediaId}/episodes`, headers: auth() });
    const specialEp = (eps0.json().seasons as { seasonNumber: number; episodes: { id: string }[] }[])
      .find((s) => s.seasonNumber === 0)!.episodes[0]!.id;
    await app.inject({ method: 'POST', url: `/api/episodes/${specialEp}/watched`, headers: auth() });

    const res = await app.inject({ method: 'POST', url: `/api/shows/${mediaId}/mark-all-unwatched`, headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(2);

    const eps = await app.inject({ method: 'GET', url: `/api/shows/${mediaId}/episodes`, headers: auth() });
    const seasons = eps.json().seasons as { seasonNumber: number; watchedCount: number }[];
    expect(seasons.find((s) => s.seasonNumber === 1)!.watchedCount).toBe(0);
    // Le spécial coché à la main reste vu.
    expect(seasons.find((s) => s.seasonNumber === 0)!.watchedCount).toBe(1);
  });
});
