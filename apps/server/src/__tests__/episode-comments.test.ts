import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-epcom-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'epcom.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let app: FastifyInstance;
const users: Record<string, { token: string; id: string }> = {};
let mediaId = '';
let epId = '';
const bearer = (n: string) => ({ authorization: `Bearer ${users[n]!.token}` });

async function register(name: string, email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName: name, email, password: 'secret123' },
  });
  expect(res.statusCode).toBe(200);
  users[name] = { token: res.json().token, id: res.json().user.id };
}

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
  const { buildApp } = await import('../app.js');
  app = await buildApp();
  await register('vic', 'vic@example.com'); // a vu l'épisode
  await register('nora', 'nora@example.com'); // ne l'a pas vu
  const { prisma } = await import('../db/client.js');
  const media = await prisma.media.create({
    data: { type: 'show', title: 'Ma série', year: 2021, show: { create: {} } },
  });
  mediaId = media.id;
  const show = await prisma.show.findFirstOrThrow({ where: { mediaId } });
  const ep = await prisma.episode.create({
    data: { showId: show.id, seasonNumber: 1, episodeNumber: 1, title: 'S1E1', airDate: new Date('2021-01-01') },
  });
  epId = ep.id;
  // vic marque l'épisode vu (endpoint réel).
  const w = await app.inject({ method: 'POST', url: `/api/episodes/${epId}/watched`, headers: bearer('vic') });
  expect(w.statusCode).toBe(200);
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('Commentaires par épisode — garde anti-spoiler', () => {
  it('série (sans episodeId) reste ouverte à tous', async () => {
    const get = await app.inject({ method: 'GET', url: `/api/media/${mediaId}/comments`, headers: bearer('nora') });
    expect(get.statusCode).toBe(200);
    const post = await app.inject({
      method: 'POST',
      url: `/api/media/${mediaId}/comments`,
      headers: bearer('nora'),
      payload: { body: 'Avis général' },
    });
    expect(post.statusCode).toBe(200);
  });

  it('lecture épisode : 200 pour qui a vu, 403 sinon', async () => {
    const seen = await app.inject({ method: 'GET', url: `/api/media/${mediaId}/comments?episodeId=${epId}`, headers: bearer('vic') });
    expect(seen.statusCode).toBe(200);
    const unseen = await app.inject({ method: 'GET', url: `/api/media/${mediaId}/comments?episodeId=${epId}`, headers: bearer('nora') });
    expect(unseen.statusCode).toBe(403);
    expect(unseen.json().error).toBe('episode_not_watched');
  });

  it('écriture épisode : autorisée si vu, 403 sinon', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: `/api/media/${mediaId}/comments`,
      headers: bearer('vic'),
      payload: { body: 'Quel épisode !', episodeId: epId },
    });
    expect(ok.statusCode).toBe(200);
    const ko = await app.inject({
      method: 'POST',
      url: `/api/media/${mediaId}/comments`,
      headers: bearer('nora'),
      payload: { body: 'Je veux spoiler', episodeId: epId },
    });
    expect(ko.statusCode).toBe(403);
    expect(ko.json().error).toBe('episode_not_watched');
  });

  it('réponse dans un fil épisode : 403 si non vu', async () => {
    const root = await app.inject({
      method: 'POST',
      url: `/api/media/${mediaId}/comments`,
      headers: bearer('vic'),
      payload: { body: 'Racine', episodeId: epId },
    });
    const rootId = root.json().id as string;
    const reply = await app.inject({
      method: 'POST',
      url: `/api/media/${mediaId}/comments`,
      headers: bearer('nora'),
      payload: { body: 'Réponse interdite', episodeId: epId, parentId: rootId },
    });
    expect(reply.statusCode).toBe(403);
  });

  it("le fil série n'inclut pas les commentaires d'épisode", async () => {
    const series = await app.inject({ method: 'GET', url: `/api/media/${mediaId}/comments`, headers: bearer('vic') });
    expect(series.statusCode).toBe(200);
    const list = series.json().comments as { body: string; episodeId: string | null }[];
    // Les commentaires épisode postés plus haut (« Quel épisode ! », « Racine »)
    // ne polluent pas le fil série (anti-spoiler + séparation des fils).
    const bodies = list.map((c) => c.body);
    expect(bodies).not.toContain('Quel épisode !');
    expect(bodies).not.toContain('Racine');
    // Tout le fil série a episodeId null.
    for (const c of list) expect(c.episodeId).toBeNull();
  });
});
