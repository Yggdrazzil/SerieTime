import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-gameenrich-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'gameenrich.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';
// IGDB « activé » avec identifiants factices : igdbQuery sert le cache ApiCache
// pré-rempli AVANT toute tentative réseau — zéro requête.
process.env.IGDB_ENABLED = 'true';
process.env.TWITCH_CLIENT_ID = 'test-client';
process.env.TWITCH_CLIENT_SECRET = 'test-secret';

let app: FastifyInstance;
let token = '';

const bearer = () => ({ authorization: `Bearer ${token}` });

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
    payload: { displayName: 'Enrich', email: 'enrich@example.com', password: 'secret123' },
  });
  token = res.json().token;

  const { prisma } = await import('../db/client.js');
  // Jeu LOCAL hérité : id IGDB connu mais AUCUNE plateforme/note en cache
  // (données antérieures au stockage des plateformes).
  await prisma.media.create({
    data: { type: 'game', igdbId: '500', title: 'Naruto Legacy', year: 2006, game: { create: {} } },
  });

  // Le résultat IGDB frais pour la même recherche PORTE plateformes + notes.
  const igdbGame = {
    id: 500,
    name: 'Naruto Legacy',
    game_type: 0,
    first_release_date: 1_150_000_000,
    total_rating: 82,
    total_rating_count: 300,
    platforms: [{ name: 'PlayStation 5' }, { name: 'PC (Microsoft Windows)' }],
  };
  const { searchQueryBody, prefixQueryBody } = await import('../services/igdb/index.js');
  const seedCache = (body: string, data: unknown) =>
    prisma.apiCache.create({
      data: {
        source: 'igdb',
        cacheKey: `games:${body}`,
        responseJson: JSON.stringify(data),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
  // igdbSearch interroge les DEUX corps (search plein-texte + joker préfixe).
  await seedCache(searchQueryBody('Naruto'), [igdbGame]);
  await seedCache(prefixQueryBody('Naruto'), [igdbGame]);
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('Recherche jeux : enrichissement des plateformes locales manquantes', () => {
  it('un jeu local sans plateformes récupère celles du résultat IGDB (filtre « Plateforme » exploitable)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games/search?q=Naruto', headers: bearer() });
    expect(res.statusCode).toBe(200);
    const { results } = res.json() as {
      results: { title: string; igdbId: string | null; platforms: string[]; voteAverage: number | null }[];
    };
    // Le doublon IGDB est dédupliqué : une seule entrée « Naruto Legacy ».
    const naruto = results.filter((r) => r.title === 'Naruto Legacy');
    expect(naruto).toHaveLength(1);
    // …mais elle porte désormais les plateformes (et la note) d'IGDB.
    expect(naruto[0]!.platforms.sort()).toEqual(['PC (Microsoft Windows)', 'PlayStation 5']);
    expect(naruto[0]!.voteAverage).toBeCloseTo(8.2);
  });
});
