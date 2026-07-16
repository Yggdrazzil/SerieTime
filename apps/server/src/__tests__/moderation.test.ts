import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Modération : (A) rejet des commentaires haineux ; (B) exclusion du contenu
// pour adultes des suggestions (TMDb adult / IGDB thème « Erotic » id 42).
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-moderation-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'moderation.sqlite')}`;
process.env.NODE_ENV = 'test';
// TMDb activé (fetch mocké) pour tester le filtrage `adult` dans /api/search.
process.env.TMDB_API_KEY = 'test-key';
process.env.TMDB_READ_ACCESS_TOKEN = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';
// IGDB activé : igdbQuery lit d'abord ApiCache (pré-rempli par les tests) — pas
// de réseau nécessaire tant que le cache est présent et non expiré.
process.env.IGDB_ENABLED = 'true';
process.env.TWITCH_CLIENT_ID = 'test-id';
process.env.TWITCH_CLIENT_SECRET = 'test-secret';

let app: FastifyInstance;
let prismaClient: (typeof import('../db/client.js'))['prisma'];
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
  const { prisma } = await import('../db/client.js');
  prismaClient = prisma;

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName: 'Modo', email: 'modo@example.com', password: 'secret123' },
  });
  expect(res.statusCode).toBe(200);
  token = res.json().token;
}, 120_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await app?.close();
});

describe('Volet A — POST /api/media/:id/comments (modération)', () => {
  it('rejette un commentaire haineux (400 comment_blocked) et l’accepte une fois nettoyé', async () => {
    const media = await prismaClient.media.create({ data: { type: 'show', title: 'Test Show' } });

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/media/${media.id}/comments`,
      headers: auth(),
      payload: { body: 'you are a nigger' },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toBe('comment_blocked');
    expect(typeof blocked.json().message).toBe('string');
    // Rien n'a été créé.
    expect(await prismaClient.comment.count({ where: { mediaId: media.id } })).toBe(0);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/media/${media.id}/comments`,
      headers: auth(),
      payload: { body: 'Cette série est vraiment géniale !' },
    });
    expect(ok.statusCode).toBe(200);
    expect(await prismaClient.comment.count({ where: { mediaId: media.id } })).toBe(1);
  });

  it('applique aussi la modération aux réponses (même route, parentId)', async () => {
    const media = await prismaClient.media.create({ data: { type: 'show', title: 'Reply Show' } });
    const parent = await app.inject({
      method: 'POST',
      url: `/api/media/${media.id}/comments`,
      headers: auth(),
      payload: { body: 'Super épisode.' },
    });
    const parentId = parent.json().id as string;

    const blockedReply = await app.inject({
      method: 'POST',
      url: `/api/media/${media.id}/comments`,
      headers: auth(),
      payload: { body: 'espèce de sale pute', parentId },
    });
    expect(blockedReply.statusCode).toBe(400);
    expect(blockedReply.json().error).toBe('comment_blocked');
    // Seul le commentaire parent existe.
    expect(await prismaClient.comment.count({ where: { mediaId: media.id } })).toBe(1);
  });
});

describe('Volet B — TMDb : exclusion du contenu adult de /api/search', () => {
  it('exclut les résultats dont adult === true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes('/search/multi')) {
          return new Response(
            JSON.stringify({
              results: [
                { id: 111, media_type: 'movie', title: 'Film Familial', adult: false },
                { id: 222, media_type: 'movie', title: 'Film XXX', adult: true },
              ],
            }),
            { status: 200 },
          );
        }
        throw new Error(`fetch inattendu en test : ${u}`);
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=film&type=media',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const titles = (res.json().results as { title: string }[]).map((r) => r.title);
    expect(titles).toContain('Film Familial');
    expect(titles).not.toContain('Film XXX');
  });
});

describe('Volet B — IGDB : exclusion du thème « Erotic » (id 42)', () => {
  it('exclut un jeu portant le thème 42 des résultats de recherche', async () => {
    const { igdbSearch, searchQueryBody, isSafeGame } = await import('../services/igdb/index.js');

    // Garde unitaire.
    expect(isSafeGame({ id: 1, name: 'Safe', themes: [{ id: 31, name: 'Drama' }] })).toBe(true);
    expect(isSafeGame({ id: 2, name: 'Erotic', themes: [{ id: 42, name: 'Erotic' }] })).toBe(false);
    expect(isSafeGame({ id: 3, name: 'ByName', themes: [{ id: 99, name: 'Sexual content' }] })).toBe(false);

    // Pré-remplit le cache IGDB (adressé par le corps Apicalypse exact) → pas de
    // réseau : igdbQuery renvoie ce JSON, puis le filtre isSafeGame s'applique.
    const body = searchQueryBody('witcher');
    await prismaClient.apiCache.upsert({
      where: { source_cacheKey: { source: 'igdb', cacheKey: `games:${body}` } },
      create: {
        source: 'igdb',
        cacheKey: `games:${body}`,
        responseJson: JSON.stringify([
          { id: 10, name: 'Safe Game', game_type: 0 },
          { id: 11, name: 'Erotic Game', game_type: 0, themes: [{ id: 42, name: 'Erotic' }] },
        ]),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
      update: {
        responseJson: JSON.stringify([
          { id: 10, name: 'Safe Game', game_type: 0 },
          { id: 11, name: 'Erotic Game', game_type: 0, themes: [{ id: 42, name: 'Erotic' }] },
        ]),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const results = await igdbSearch('witcher');
    const names = results.map((g) => g.name);
    expect(names).toContain('Safe Game');
    expect(names).not.toContain('Erotic Game');
  });
});
