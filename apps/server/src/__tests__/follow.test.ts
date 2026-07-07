import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Régression : consulter une fiche ne doit jamais l'ajouter au suivi ;
// seul le + (follow) le fait, et le statut suit les épisodes cochés.
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-follow-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'follow.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let app: FastifyInstance;
let token = '';
let mediaId = '';
let episodeId = '';

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
    payload: { displayName: 'Suiveur', email: 'follow@example.com', password: 'secret123' },
  });
  token = res.json().token;

  // Série locale avec un épisode (sans passer par TheTVDB, désactivé en test).
  const { prisma } = await import('../db/client.js');
  const media = await prisma.media.create({
    data: {
      type: 'show',
      title: 'Bleach',
      show: { create: {} },
    },
    include: { show: true },
  });
  mediaId = media.id;
  const episode = await prisma.episode.create({
    data: {
      showId: media.show!.id,
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Le jour où je suis devenu Shinigami',
    },
  });
  episodeId = episode.id;
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('Consultation vs suivi (façon TV Time)', () => {
  it('consulter la fiche ne l’ajoute pas à la bibliothèque', async () => {
    const detail = await app.inject({ method: 'GET', url: `/api/shows/${mediaId}`, headers: auth() });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().media.userStatus).toBeNull();

    const mine = await app.inject({ method: 'GET', url: '/api/shows', headers: auth() });
    expect(mine.json().shows).toHaveLength(0);
  });

  it('le + suit la série avec le statut « Pas commencé »', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/shows/${mediaId}/follow`, headers: auth() });
    expect(res.json().following).toBe(true);
    const detail = await app.inject({ method: 'GET', url: `/api/shows/${mediaId}`, headers: auth() });
    expect(detail.json().media.userStatus).toBe('not_started');
  });

  it('cocher un épisode passe la série « En cours », le décocher la ramène « Pas commencé »', async () => {
    await app.inject({ method: 'POST', url: `/api/episodes/${episodeId}/watched`, headers: auth() });
    let detail = await app.inject({ method: 'GET', url: `/api/shows/${mediaId}`, headers: auth() });
    expect(detail.json().media.userStatus).toBe('watching');

    await app.inject({ method: 'POST', url: `/api/episodes/${episodeId}/unwatched`, headers: auth() });
    detail = await app.inject({ method: 'GET', url: `/api/shows/${mediaId}`, headers: auth() });
    expect(detail.json().media.userStatus).toBe('not_started');
  });

  it('« Regarder plus tard » retire la série des files À voir et À venir', async () => {
    await app.inject({ method: 'POST', url: `/api/shows/${mediaId}/watchlater`, headers: auth() });
    const detail = await app.inject({ method: 'GET', url: `/api/shows/${mediaId}`, headers: auth() });
    expect(detail.json().media.userStatus).toBe('watchlist');
    const queue = await app.inject({ method: 'GET', url: '/api/shows/queue', headers: auth() });
    expect(queue.json().items).toHaveLength(0);
    const upcoming = await app.inject({ method: 'GET', url: '/api/shows/upcoming', headers: auth() });
    expect(upcoming.json().groups).toHaveLength(0);
  });

  it('« Supprimer la série » (tracking) retire la série et son historique', async () => {
    await app.inject({ method: 'DELETE', url: `/api/shows/${mediaId}/tracking`, headers: auth() });
    const mine = await app.inject({ method: 'GET', url: '/api/shows', headers: auth() });
    expect(mine.json().shows).toHaveLength(0);
    const detail = await app.inject({ method: 'GET', url: `/api/shows/${mediaId}`, headers: auth() });
    expect(detail.json().media.userStatus).toBeNull();
  });
});
