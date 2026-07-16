import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-games-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'games.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let app: FastifyInstance;
const users: Record<string, { token: string; id: string }> = {};

function acc(name: string) {
  const u = users[name];
  if (!u) throw new Error(`utilisateur inconnu: ${name}`);
  return u;
}
const bearer = (name: string) => ({ authorization: `Bearer ${acc(name).token}` });

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

  await register('Alice', 'alice@test.dev');
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('Jeux vidéo — bibliothèque groupée par statut', () => {
  it('classe les jeux par statut', async () => {
    const { prisma } = await import('../db/client.js');
    const g = await prisma.media.create({ data: { type: 'game', igdbId: '42', title: 'Halo' } });
    await prisma.game.create({ data: { mediaId: g.id, platforms: 'PC' } });
    const alice = await prisma.user.findFirstOrThrow({ where: { email: 'alice@test.dev' } });
    await prisma.userMediaStatus.create({ data: { userId: alice.id, mediaId: g.id, status: 'playing' } });

    const res = await app.inject({ method: 'GET', url: '/api/games', headers: bearer('Alice') });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.playing.map((m: { title: string }) => m.title)).toContain('Halo');
    expect(body.wishlist).toEqual([]);
  });

  it('change le statut d’un jeu', async () => {
    const { prisma } = await import('../db/client.js');
    const g = await prisma.media.findFirstOrThrow({ where: { igdbId: '42' } });
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${g.id}/status`,
      payload: { status: 'completed' },
      headers: bearer('Alice'),
    });
    expect(res.statusCode).toBe(200);
    const lib = await app.inject({ method: 'GET', url: '/api/games', headers: bearer('Alice') });
    expect(lib.json().completed.map((m: { title: string }) => m.title)).toContain('Halo');
    expect(lib.json().playing).toEqual([]);
  });

  it('« Je possède » : interrupteur indépendant du statut (recoupement des groupes)', async () => {
    const { prisma } = await import('../db/client.js');
    const g = await prisma.media.create({ data: { type: 'game', igdbId: '77', title: 'Celeste' } });
    await prisma.game.create({ data: { mediaId: g.id, platforms: 'PC' } });

    // Statut « En cours » + interrupteur possédé → le jeu apparaît dans les
    // DEUX groupes (playing par statut, owned = vue collection).
    const st = await app.inject({ method: 'POST', url: `/api/games/${g.id}/status`, payload: { status: 'playing' }, headers: bearer('Alice') });
    expect(st.statusCode).toBe(200);
    const on = await app.inject({ method: 'POST', url: `/api/games/${g.id}/owned`, payload: { owned: true }, headers: bearer('Alice') });
    expect(on.statusCode).toBe(200);
    expect(on.json().isOwned).toBe(true);

    let lib = await app.inject({ method: 'GET', url: '/api/games', headers: bearer('Alice') });
    expect(lib.json().playing.map((m: { title: string }) => m.title)).toContain('Celeste');
    expect(lib.json().owned.map((m: { title: string }) => m.title)).toContain('Celeste');

    // La fiche détail expose le booléen.
    const detail = await app.inject({ method: 'GET', url: `/api/games/${g.id}`, headers: bearer('Alice') });
    expect(detail.json().isOwned).toBe(true);
    expect(detail.json().userStatus).toBe('playing');

    // Retirer « possédé » le sort du groupe collection, sans toucher au statut.
    const off = await app.inject({ method: 'POST', url: `/api/games/${g.id}/owned`, payload: { owned: false }, headers: bearer('Alice') });
    expect(off.statusCode).toBe(200);
    lib = await app.inject({ method: 'GET', url: '/api/games', headers: bearer('Alice') });
    expect(lib.json().owned.map((m: { title: string }) => m.title)).not.toContain('Celeste');
    expect(lib.json().playing.map((m: { title: string }) => m.title)).toContain('Celeste');
  });

  it('« Je possède » sans autre interaction crée la ligne en wishlist (fallback documenté)', async () => {
    const { prisma } = await import('../db/client.js');
    const g = await prisma.media.create({ data: { type: 'game', igdbId: '78', title: 'Hades' } });
    await prisma.game.create({ data: { mediaId: g.id, platforms: 'PC' } });

    const on = await app.inject({ method: 'POST', url: `/api/games/${g.id}/owned`, payload: { owned: true }, headers: bearer('Alice') });
    expect(on.statusCode).toBe(200);

    const lib = await app.inject({ method: 'GET', url: '/api/games', headers: bearer('Alice') });
    expect(lib.json().owned.map((m: { title: string }) => m.title)).toContain('Hades');
    expect(lib.json().wishlist.map((m: { title: string }) => m.title)).toContain('Hades');
  });

  it('« owned » n’est plus un statut accepté par POST /status', async () => {
    const { prisma } = await import('../db/client.js');
    const g = await prisma.media.findFirstOrThrow({ where: { igdbId: '42' } });
    const res = await app.inject({ method: 'POST', url: `/api/games/${g.id}/status`, payload: { status: 'owned' }, headers: bearer('Alice') });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('/api/games/upcoming renvoie des groupes (vide si aucun suivi à venir)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games/upcoming', headers: bearer('Alice') });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().groups)).toBe(true);
  });
});

describe('Jeux vidéo — parité fiche (favori, jaquette/bannière)', () => {
  it('bascule le favori d’un jeu (aller-retour) et le reflète sur la fiche détail', async () => {
    const { prisma } = await import('../db/client.js');
    const g = await prisma.media.create({ data: { type: 'game', igdbId: '99', title: 'Portal' } });
    await prisma.game.create({ data: { mediaId: g.id, platforms: 'PC' } });

    const before = await app.inject({ method: 'GET', url: `/api/games/${g.id}`, headers: bearer('Alice') });
    expect(before.statusCode).toBe(200);
    expect(before.json().isFavorite).toBe(false);

    const on = await app.inject({ method: 'POST', url: `/api/games/${g.id}/favorite`, headers: bearer('Alice') });
    expect(on.statusCode).toBe(200);
    expect(on.json().isFavorite).toBe(true);

    const afterOn = await app.inject({ method: 'GET', url: `/api/games/${g.id}`, headers: bearer('Alice') });
    expect(afterOn.json().isFavorite).toBe(true);

    const off = await app.inject({ method: 'POST', url: `/api/games/${g.id}/favorite`, headers: bearer('Alice') });
    expect(off.statusCode).toBe(200);
    expect(off.json().isFavorite).toBe(false);

    const afterOff = await app.inject({ method: 'GET', url: `/api/games/${g.id}`, headers: bearer('Alice') });
    expect(afterOff.json().isFavorite).toBe(false);
  });

  it('modifie l’affiche et la bannière d’un jeu (POST poster/banner)', async () => {
    const { prisma } = await import('../db/client.js');
    const g = await prisma.media.create({ data: { type: 'game', igdbId: '100', title: 'Half-Life' } });
    await prisma.game.create({ data: { mediaId: g.id, platforms: 'PC' } });

    const poster = await app.inject({
      method: 'POST',
      url: `/api/games/${g.id}/poster`,
      payload: { posterPath: 'https://images.igdb.com/igdb/image/upload/t_cover_big/custom.jpg' },
      headers: bearer('Alice'),
    });
    expect(poster.statusCode).toBe(200);

    const banner = await app.inject({
      method: 'POST',
      url: `/api/games/${g.id}/banner`,
      payload: { backdropPath: 'https://images.igdb.com/igdb/image/upload/t_1080p/custom-bg.jpg' },
      headers: bearer('Alice'),
    });
    expect(banner.statusCode).toBe(200);

    const detail = await app.inject({ method: 'GET', url: `/api/games/${g.id}`, headers: bearer('Alice') });
    expect(detail.json().posterPath).toBe('https://images.igdb.com/igdb/image/upload/t_cover_big/custom.jpg');
    expect(detail.json().backdropPath).toBe('https://images.igdb.com/igdb/image/upload/t_1080p/custom-bg.jpg');
  });
});
