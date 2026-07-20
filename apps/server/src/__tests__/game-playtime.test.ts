import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Base SQLite temporaire, définie AVANT tout import qui charge `config/env.ts`.
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-test-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'playtime.sqlite')}`;
process.env.NODE_ENV = 'test';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let token = '';
let gameId = '';

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
  const { buildApp } = await import('../app.js');
  const { prisma } = await import('../db/client.js');
  app = await buildApp();
  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName: 'Joueur', email: 'joueur@example.com', password: 'secret123' },
  });
  token = reg.json().token as string;
  // Jeu local (sans passer par IGDB — hors ligne dans les tests).
  const media = await prisma.media.create({
    data: { type: 'game', title: 'Jeu Test', game: { create: {} } },
  });
  gameId = media.id;
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('temps de jeu déclaratif (POST /api/games/:id/playtime)', () => {
  it('déclare des heures (converties en minutes) et les renvoie dans les stats', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/playtime`,
      headers: { authorization: `Bearer ${token}` },
      payload: { hours: 12.5 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().playtimeMinutes).toBe(750);

    const stats = await app.inject({
      method: 'GET',
      url: '/api/profile/stats',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(stats.json().stats.gamePlaytimeMinutes).toBe(750);

    const detailed = await app.inject({
      method: 'GET',
      url: '/api/stats/detailed',
      headers: { authorization: `Bearer ${token}` },
    });
    const games = detailed.json().games;
    expect(games.minutes).toBe(750);
    expect(games.topByPlaytime[0]?.minutes).toBe(750);
  });

  it('hours: null efface la déclaration', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/playtime`,
      headers: { authorization: `Bearer ${token}` },
      payload: { hours: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().playtimeMinutes).toBeNull();
  });

  it('refuse les heures négatives (validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/playtime`,
      headers: { authorization: `Bearer ${token}` },
      payload: { hours: -3 },
    });
    expect(res.statusCode).toBe(400);
  });
});
