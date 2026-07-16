import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Mémoire du flux Explorer (ExploreImpression) : un item servi est exclu du
// tirage suivant (3 jours), avec garde anti-famine si le vivier est minuscule.
// Réseau intégralement mocké (vi.stubGlobal('fetch') — pattern language.test.ts).
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-impressions-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'impressions.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = 'test-key';
process.env.TMDB_READ_ACCESS_TOKEN = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';
// IGDB actif pour tester /api/explore/games (token Twitch + requêtes mockés).
process.env.IGDB_ENABLED = 'true';
process.env.TWITCH_CLIENT_ID = 'client-id-test';
process.env.TWITCH_CLIENT_SECRET = 'client-secret-test';

let app: FastifyInstance;
let prismaClient: (typeof import('../db/client.js'))['prisma'];
let token = '';
let userId = '';

const auth = () => ({ authorization: `Bearer ${token}` });

// Chaque URL TMDb distincte (endpoint + page + tri…) renvoie 20 résultats aux
// ids UNIQUES et stables (mêmes ids si la même URL est rappelée — comme le
// vrai TMDb) : le vivier est assez large pour que le 2e appel puisse servir
// 100 % d'items jamais vus.
const tmdbBases = new Map<string, number>();
function tmdbResults(url: string) {
  const u = new URL(url);
  const key = `${u.pathname}?${u.searchParams.toString()}`;
  if (!tmdbBases.has(key)) tmdbBases.set(key, 100_000 + tmdbBases.size * 100);
  const base = tmdbBases.get(key)!;
  const isTv = /\/(trending|discover)\/tv/.test(u.pathname);
  return Array.from({ length: 20 }, (_, i) => ({
    id: base + i,
    ...(isTv ? { name: `Show ${base + i}` } : { title: `Film ${base + i}` }),
    ...(isTv ? { first_air_date: '2020-05-01' } : { release_date: '2020-05-01' }),
    overview: 'Résumé',
    poster_path: '/p.jpg',
    backdrop_path: '/b.jpg',
    vote_average: 7.5,
    genre_ids: [18],
    original_language: 'en',
  }));
}

// Vivier IGDB MINUSCULE (5 jeux, identiques pour toutes les requêtes) : le 2e
// appel n'a plus rien de frais → la garde anti-famine doit resservir les items.
const IGDB_GAMES = Array.from({ length: 5 }, (_, i) => ({
  id: 9000 + i,
  name: `Jeu ${9000 + i}`,
  summary: 'Un jeu',
  first_release_date: 1_600_000_000,
  cover: { image_id: `cov${i}` },
  total_rating: 85,
}));

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith('https://id.twitch.tv/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'twitch-token', expires_in: 3600 }), { status: 200 });
      }
      if (u.startsWith('https://api.igdb.com/v4/games')) {
        return new Response(JSON.stringify(IGDB_GAMES), { status: 200 });
      }
      if (u.includes('api.themoviedb.org/3/')) {
        return new Response(JSON.stringify({ results: tmdbResults(u) }), { status: 200 });
      }
      throw new Error(`fetch inattendu en test : ${u}`);
    }),
  );

  const { buildApp } = await import('../app.js');
  app = await buildApp();
  const { prisma } = await import('../db/client.js');
  prismaClient = prisma;

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName: 'Zappeur', email: 'zap@example.com', password: 'secret123' },
  });
  expect(res.statusCode).toBe(200);
  token = res.json().token;
  userId = res.json().user.id;
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await app?.close();
});

type Card = { tmdbId: string | null; type: string; title: string };

describe('GET /api/explore/feed — mémoire des impressions', () => {
  it('un item servi au 1er appel est absent du 2e (vivier large)', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/explore/feed', headers: auth() });
    expect(first.statusCode).toBe(200);
    const feed1: Card[] = first.json().feed;
    expect(feed1.length).toBeGreaterThan(0);

    // Les impressions des items servis sont en base, au bon format de clé.
    const impressions = await prismaClient.exploreImpression.findMany({ where: { userId } });
    expect(impressions.length).toBe(feed1.length);
    for (const imp of impressions) expect(imp.itemKey).toMatch(/^(show|movie):tmdb:\d+$/);

    const second = await app.inject({ method: 'GET', url: '/api/explore/feed', headers: auth() });
    expect(second.statusCode).toBe(200);
    const feed2: Card[] = second.json().feed;
    expect(feed2.length).toBeGreaterThan(0);

    const key = (c: Card) => `${c.type}:tmdb:${c.tmdbId}`;
    const served1 = new Set(feed1.map(key));
    // Vivier largement suffisant → AUCUNE répétition entre les deux appels.
    expect(feed2.filter((c) => served1.has(key(c)))).toEqual([]);
  });
});

describe('GET /api/explore/games — impressions + garde anti-famine', () => {
  it('mémorise les jeux servis puis les ressert quand tout le vivier a été vu', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/explore/games', headers: auth() });
    expect(first.statusCode).toBe(200);
    const feed1: { igdbId: string }[] = first.json().feed;
    // Tout le vivier mocké (5 jeux) est servi.
    expect(feed1.map((g) => g.igdbId).sort()).toEqual(['9000', '9001', '9002', '9003', '9004']);

    const gameImpressions = await prismaClient.exploreImpression.findMany({
      where: { userId, itemKey: { startsWith: 'game:igdb:' } },
    });
    expect(gameImpressions.length).toBe(5);

    // 2e appel : tout a déjà été vu il y a < 3 jours → la garde anti-famine
    // ressert les items (jamais de flux vide à cause du filtre).
    const second = await app.inject({ method: 'GET', url: '/api/explore/games', headers: auth() });
    expect(second.statusCode).toBe(200);
    const feed2: { igdbId: string }[] = second.json().feed;
    expect(feed2.length).toBe(5);
  });

  it('un jeu suivi est exclu du flux', async () => {
    const media = await prismaClient.media.create({
      data: { type: 'game', igdbId: '9000', title: 'Jeu 9000', genres: 'Shooter' },
    });
    await prismaClient.userMediaStatus.create({ data: { userId, mediaId: media.id, status: 'playing' } });

    const res = await app.inject({ method: 'GET', url: '/api/explore/games', headers: auth() });
    expect(res.statusCode).toBe(200);
    const feed: { igdbId: string }[] = res.json().feed;
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.map((g) => g.igdbId)).not.toContain('9000');
  });
});
