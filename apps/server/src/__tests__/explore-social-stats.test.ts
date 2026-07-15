import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-social-stats-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'db.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let app: FastifyInstance;
const tok: Record<string, string> = {};

async function register(name: string, email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName: name, email, password: 'secret123' },
  });
  expect(res.statusCode).toBe(200);
  tok[name] = res.json().token;
}

beforeAll(async () => {
  execSync('corepack pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    stdio: 'inherit',
  });
  const { buildApp } = await import('../app.js');
  app = await buildApp();
  await app.ready();
  await register('Alice', 'alice@test.dev');
  await register('Bob', 'bob@test.dev');
});

afterAll(async () => {
  await app.close();
});

describe('attachSocialStats', () => {
  it('agrège likes/watched/comments sur toute l’app + état perso', async () => {
    const { prisma } = await import('../db/client.js');
    const { attachSocialStats } = await import('../modules/search/socialStats.js');

    // Un film local partagé, avec un tmdbId connu.
    const movie = await prisma.media.create({
      data: { type: 'movie', tmdbId: '4242', title: 'Film Test', year: 2020 },
    });
    const alice = await prisma.user.findFirstOrThrow({ where: { email: 'alice@test.dev' } });
    const bob = await prisma.user.findFirstOrThrow({ where: { email: 'bob@test.dev' } });

    // Alice : watchlist (like). Bob : completed (déjà vu). Bob : 1 commentaire.
    await prisma.userMediaStatus.create({ data: { userId: alice.id, mediaId: movie.id, status: 'watchlist' } });
    await prisma.userMediaStatus.create({ data: { userId: bob.id, mediaId: movie.id, status: 'completed' } });
    await prisma.comment.create({ data: { userId: bob.id, mediaId: movie.id, body: 'Top' } });

    const enriched = (await attachSocialStats(
      [{ tmdbId: '4242', type: 'movie' as const, title: 'Film Test' }],
      alice.id,
    ))[0]!;

    expect(enriched.stats).toEqual({ likes: 1, watched: 1, comments: 1 });
    expect(enriched.me).toEqual({ liked: true, watched: false });
  });

  it('renvoie des zéros pour un item sans média local', async () => {
    const { attachSocialStats } = await import('../modules/search/socialStats.js');
    const alice = (await (await import('../db/client.js')).prisma.user.findFirstOrThrow({
      where: { email: 'alice@test.dev' },
    })).id;
    const enriched = (await attachSocialStats([{ tmdbId: '999999', type: 'show' as const }], alice))[0]!;
    expect(enriched.stats).toEqual({ likes: 0, watched: 0, comments: 0 });
    expect(enriched.me).toEqual({ liked: false, watched: false });
  });
});
