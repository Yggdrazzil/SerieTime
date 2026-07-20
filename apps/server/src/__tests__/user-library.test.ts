// Bibliothèque intégrale d'un ami — GET /api/users/:id/library : liste paginée
// (curseur) des UserMediaStatus d'un utilisateur pour un type de média, avec
// les mêmes règles de visibilité que le profil public (privé non suivi → 403,
// bloqué par le profil consulté → 404, isHidden exclu).
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-user-library-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'user-library.sqlite')}`;
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
const uid = (name: string) => acc(name).id;

async function register(name: string, email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName: name, email, password: 'secret123' },
  });
  expect(res.statusCode).toBe(200);
  users[name] = { token: res.json().token, id: res.json().user.id };
}

type LibraryItem = {
  media: { id: string; title: string; posterPath: string | null; type: string; year: number | null };
  status: string;
  rating: number | null;
  isFavorite: boolean;
};
type LibraryPage = { items: LibraryItem[]; nextCursor: string | null; total: number };

async function getLibrary(as: string, target: string, qs: string) {
  return app.inject({ method: 'GET', url: `/api/users/${target}/library?${qs}`, headers: bearer(as) });
}

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
  const { buildApp } = await import('../app.js');
  app = await buildApp();

  await register('Alice', 'alice@example.com'); // visiteuse
  await register('Bob', 'bob@example.com'); // profil public avec bibliothèque
  await register('Carol', 'carol@example.com'); // profil privé
  await register('Dave', 'dave@example.com'); // bloque Alice

  const { prisma } = await import('../db/client.js');

  // Bibliothèque de Bob : 3 séries visibles + 1 masquée, 1 film, 1 jeu.
  const day = (n: number) => new Date(Date.UTC(2026, 0, n));
  const mk = (type: string, title: string) => prisma.media.create({ data: { type, title, year: 2020 } });
  const [s1, s2, s3, sHidden, m1, g1, cShow] = await Promise.all([
    mk('show', 'Dark'),
    mk('show', 'Severance'),
    mk('show', 'Fargo'),
    mk('show', 'Série cachée'),
    mk('movie', 'Inception'),
    mk('game', 'Hades'),
    mk('show', 'Utopia'),
  ]);
  await prisma.userMediaStatus.createMany({
    data: [
      // lastWatchedAt décroissant attendu : Dark (10) > Severance (5) > Fargo (null).
      { userId: uid('Bob'), mediaId: s1.id, status: 'watching', lastWatchedAt: day(10), rating: 4.5, isFavorite: true },
      { userId: uid('Bob'), mediaId: s2.id, status: 'completed', lastWatchedAt: day(5) },
      { userId: uid('Bob'), mediaId: s3.id, status: 'watchlist' },
      { userId: uid('Bob'), mediaId: sHidden.id, status: 'watching', lastWatchedAt: day(12), isHidden: true },
      { userId: uid('Bob'), mediaId: m1.id, status: 'completed', lastWatchedAt: day(8), rating: 5 },
      { userId: uid('Bob'), mediaId: g1.id, status: 'watching', lastWatchedAt: day(2) },
      // Carol (privée) suit aussi une série.
      { userId: uid('Carol'), mediaId: cShow.id, status: 'watching', lastWatchedAt: day(3) },
    ],
  });
  await prisma.user.update({ where: { id: uid('Carol') }, data: { isPrivate: true } });
  // Dave bloque Alice : sa bibliothèque doit lui devenir invisible (404).
  await prisma.block.create({ data: { blockerId: uid('Dave'), blockedId: uid('Alice') } });
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('GET /api/users/:id/library', () => {
  it('liste les séries d’un ami public, triées par dernier visionnage, avec statut/note/favori', async () => {
    const res = await getLibrary('Alice', uid('Bob'), 'type=show');
    expect(res.statusCode).toBe(200);
    const body = res.json() as LibraryPage;
    expect(body.total).toBe(3);
    expect(body.nextCursor).toBeNull();
    expect(body.items.map((i) => i.media.title)).toEqual(['Dark', 'Severance', 'Fargo']);
    expect(body.items.every((i) => i.media.type === 'show')).toBe(true);
    expect(body.items[0]).toMatchObject({ status: 'watching', rating: 4.5, isFavorite: true });
    expect(body.items[2]).toMatchObject({ status: 'watchlist', rating: null, isFavorite: false });
  });

  it('filtre par type : films et jeux ont leur propre liste', async () => {
    const movies = (await getLibrary('Alice', uid('Bob'), 'type=movie')).json() as LibraryPage;
    expect(movies.total).toBe(1);
    expect(movies.items.map((i) => i.media.title)).toEqual(['Inception']);
    const games = (await getLibrary('Alice', uid('Bob'), 'type=game')).json() as LibraryPage;
    expect(games.total).toBe(1);
    expect(games.items[0]?.media.type).toBe('game');
  });

  it('pagine par curseur sans doublon ni oubli', async () => {
    const p1 = (await getLibrary('Alice', uid('Bob'), 'type=show&take=2')).json() as LibraryPage;
    expect(p1.items).toHaveLength(2);
    expect(p1.total).toBe(3);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = (await getLibrary('Alice', uid('Bob'), `type=show&take=2&cursor=${p1.nextCursor}`)).json() as LibraryPage;
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    const all = [...p1.items, ...p2.items].map((i) => i.media.title);
    expect(all).toEqual(['Dark', 'Severance', 'Fargo']);
  });

  it('exclut les médias masqués (isHidden)', async () => {
    const res = (await getLibrary('Alice', uid('Bob'), 'type=show&take=60')).json() as LibraryPage;
    expect(res.items.map((i) => i.media.title)).not.toContain('Série cachée');
    expect(res.total).toBe(3);
  });

  it('profil privé non suivi → 403 restricted', async () => {
    const res = await getLibrary('Alice', uid('Carol'), 'type=show');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('restricted');
  });

  it('profil privé suivi → accessible', async () => {
    await app.inject({ method: 'POST', url: `/api/social/follow/${uid('Carol')}`, headers: bearer('Alice') });
    const res = await getLibrary('Alice', uid('Carol'), 'type=show');
    expect(res.statusCode).toBe(200);
    expect((res.json() as LibraryPage).items.map((i) => i.media.title)).toEqual(['Utopia']);
  });

  it('soi-même : toujours accessible, même en profil privé', async () => {
    const res = await getLibrary('Carol', uid('Carol'), 'type=show');
    expect(res.statusCode).toBe(200);
    expect((res.json() as LibraryPage).total).toBe(1);
  });

  it('bloqué par le profil consulté → 404 (comme un id inconnu)', async () => {
    const res = await getLibrary('Alice', uid('Dave'), 'type=show');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
    // L'autre sens (Dave consulte Alice) n'est pas filtré — modèle mute.
    const reverse = await getLibrary('Dave', uid('Alice'), 'type=show');
    expect(reverse.statusCode).toBe(200);
  });

  it('utilisateur inconnu → 404, type invalide → 400', async () => {
    const missing = await getLibrary('Alice', 'inexistant', 'type=show');
    expect(missing.statusCode).toBe(404);
    const bad = await getLibrary('Alice', uid('Bob'), 'type=book');
    expect(bad.statusCode).toBe(400);
  });
});
