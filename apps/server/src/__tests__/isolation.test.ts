import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Base isolée pour ce fichier de test.
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-iso-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'iso.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TMDB_READ_ACCESS_TOKEN = '';
process.env.TVMAZE_ENABLED = 'false';

let app: FastifyInstance;
let tokenA = '';
let tokenB = '';
let movieId = '';

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function register(displayName: string, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName, email, password: 'secret123' },
  });
  expect(res.statusCode).toBe(200);
  return res.json().token;
}

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
  const { buildApp } = await import('../app.js');
  app = await buildApp();

  tokenA = await register('Alice', 'alice@example.com');
  tokenB = await register('Bob', 'bob@example.com');

  // Un film dans le catalogue partagé (métadonnées communes, données perso séparées).
  const { prisma } = await import('../db/client.js');
  const media = await prisma.media.create({
    data: { type: 'movie', title: 'Film Partagé', year: 2024 },
  });
  movieId = media.id;
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('Isolation des données par compte', () => {
  it('deux comptes distincts sont bien créés', () => {
    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
    expect(tokenA).not.toBe(tokenB);
  });

  it('Alice ajoute le film à sa watchlist, le met en favori et crée une liste privée', async () => {
    const wl = await app.inject({ method: 'POST', url: `/api/movies/${movieId}/watchlist`, headers: bearer(tokenA) });
    expect(wl.statusCode).toBe(200);
    const fav = await app.inject({ method: 'POST', url: `/api/movies/${movieId}/favorite`, headers: bearer(tokenA) });
    expect(fav.json().isFavorite).toBe(true);
    const list = await app.inject({
      method: 'POST',
      url: '/api/lists',
      payload: { title: 'Liste secrète d’Alice' },
      headers: bearer(tokenA),
    });
    expect(list.statusCode).toBe(200);
  });

  it('Alice retrouve SON film et SA liste', async () => {
    const profile = await app.inject({ method: 'GET', url: '/api/movies/profile', headers: bearer(tokenA) });
    const titles = profile.json().unseen.map((m: { title: string }) => m.title);
    expect(titles).toContain('Film Partagé');

    const lists = await app.inject({ method: 'GET', url: '/api/lists', headers: bearer(tokenA) });
    expect(lists.json().lists.map((l: { title: string }) => l.title)).toContain('Liste secrète d’Alice');
  });

  it('Bob ne voit RIEN des données d’Alice', async () => {
    // Aucun film dans la bibliothèque de Bob.
    const profile = await app.inject({ method: 'GET', url: '/api/movies/profile', headers: bearer(tokenB) });
    expect(profile.json().seen).toHaveLength(0);
    expect(profile.json().unseen).toHaveLength(0);

    // Aucune liste pour Bob.
    const lists = await app.inject({ method: 'GET', url: '/api/lists', headers: bearer(tokenB) });
    expect(lists.json().lists).toHaveLength(0);

    // Le film du catalogue est visible (métadonnées partagées) mais NON favori pour Bob.
    const detail = await app.inject({ method: 'GET', url: `/api/movies/${movieId}`, headers: bearer(tokenB) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().media.title).toBe('Film Partagé');
    expect(detail.json().media.isFavorite).toBe(false);
    expect(detail.json().media.userStatus ?? null).toBeNull();
  });

  it('la sauvegarde exportée par Bob est vide (aucune fuite depuis Alice)', async () => {
    const backup = await app.inject({ method: 'POST', url: '/api/backup/export', headers: bearer(tokenB) });
    const data = backup.json().data;
    expect(data.mediaStatuses).toHaveLength(0);
    expect(data.lists).toHaveLength(0);
  });

  it('Bob peut avoir SES propres données sans impacter Alice', async () => {
    await app.inject({ method: 'POST', url: `/api/movies/${movieId}/watchlist`, headers: bearer(tokenB) });
    const bobProfile = await app.inject({ method: 'GET', url: '/api/movies/profile', headers: bearer(tokenB) });
    expect(bobProfile.json().unseen.map((m: { title: string }) => m.title)).toContain('Film Partagé');

    // Bob n'a pas mis le film en favori : sa vue reste indépendante de celle d'Alice.
    const bobDetail = await app.inject({ method: 'GET', url: `/api/movies/${movieId}`, headers: bearer(tokenB) });
    expect(bobDetail.json().media.isFavorite).toBe(false);
    expect(bobDetail.json().media.userStatus).toBe('watchlist');

    const aliceDetail = await app.inject({ method: 'GET', url: `/api/movies/${movieId}`, headers: bearer(tokenA) });
    expect(aliceDetail.json().media.isFavorite).toBe(true);
  });
});
