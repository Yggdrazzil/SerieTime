import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-gamesort-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'gamesort.sqlite')}`;
process.env.NODE_ENV = 'test';
// IGDB absent en test (pas de creds Twitch) → igdbSearch renvoie [] : on teste
// l'ordre et l'exposition des champs sur les résultats LOCAUX.
process.env.IGDB_ENABLED = 'false';
process.env.TWITCH_CLIENT_ID = '';
process.env.TWITCH_CLIENT_SECRET = '';

let app: FastifyInstance;
let token = '';

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
    payload: { displayName: 'GameSort', email: 'gamesort@example.com', password: 'secret123' },
  });
  token = res.json().token;

  const { prisma } = await import('../db/client.js');
  const mk = async (title: string, voteCount: number | null, voteAverage: number | null, platforms: string) => {
    await prisma.media.create({
      data: { type: 'game', title, year: 2020, voteCount, voteAverage, game: { create: { platforms } } },
    });
  };
  // Volontairement dans un ordre non trié à l'insertion.
  await mk('Mario Obscur', null, null, 'PC');
  await mk('Mario Party', 800, 7.5, 'Switch');
  await mk('Mario Kart', 5000, 8.9, 'Switch, Wii U');
  await mk('Dr. Mario', 50, 6.0, 'NES');
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('Recherche jeux : ordre par popularité + champs exposés', () => {
  it('renvoie tous les « Mario », notés d’abord et par popularité décroissante', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/games/search?q=Mario',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const { results } = res.json() as {
      results: { title: string; voteAverage: number | null; voteCount: number | null; platforms: string[] }[];
    };
    // Exhaustivité : les 4 jeux contenant « Mario » ressortent.
    expect(results.map((r) => r.title).sort()).toEqual(['Dr. Mario', 'Mario Kart', 'Mario Obscur', 'Mario Party']);
    // Ordre : notés d'abord (par nb de notes desc), non noté en dernier.
    expect(results.map((r) => r.title)).toEqual(['Mario Kart', 'Mario Party', 'Dr. Mario', 'Mario Obscur']);
    // Champs exposés pour le tri/filtre client.
    const kart = results.find((r) => r.title === 'Mario Kart')!;
    expect(kart.voteAverage).toBeCloseTo(8.9);
    expect(kart.platforms).toEqual(['Switch', 'Wii U']);
  });
});
