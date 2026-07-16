import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Lot de correctifs d'audit : validation d'URL d'affiche, réglages PAR
// utilisateur, completedAt sur les jeux, contrôle d'audience OAuth.
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-audit-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'audit.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TMDB_READ_ACCESS_TOKEN = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';
// Identifiants d'app configurés → le contrôle d'audience OAuth est ACTIF.
process.env.FACEBOOK_APP_ID = 'our-fb-app';
process.env.FACEBOOK_APP_SECRET = 'fb-secret';
process.env.DISCORD_CLIENT_ID = 'our-discord-app';

let app: FastifyInstance;
let prismaClient: (typeof import('../db/client.js'))['prisma'];
let tokenA = '';
let tokenB = '';
let showId = '';
let gameId = '';

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

// Réponses OAuth mockées (mutables par test).
let fbDebug: Record<string, unknown> = {};
let fbProfile: Record<string, unknown> = {};
let discordAppId = '';
let discordProfile: Record<string, unknown> = {};

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
  const { prisma } = await import('../db/client.js');
  prismaClient = prisma;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith('https://graph.facebook.com/debug_token')) {
        return new Response(JSON.stringify({ data: fbDebug }), { status: 200 });
      }
      if (u.startsWith('https://graph.facebook.com/me')) {
        return new Response(JSON.stringify(fbProfile), { status: 200 });
      }
      if (u.startsWith('https://discord.com/api/oauth2/@me')) {
        return new Response(JSON.stringify({ application: { id: discordAppId } }), { status: 200 });
      }
      if (u.startsWith('https://discord.com/api/users/@me')) {
        return new Response(JSON.stringify(discordProfile), { status: 200 });
      }
      throw new Error(`fetch inattendu en test : ${u}`);
    }),
  );

  tokenA = await register('Alice', 'alice@example.com');
  tokenB = await register('Bob', 'bob@example.com');

  const show = await prisma.media.create({ data: { type: 'show', title: 'Série Test', show: { create: {} } } });
  showId = show.id;
  const game = await prisma.media.create({ data: { type: 'game', title: 'Jeu Test', game: { create: {} } } });
  gameId = game.id;
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await app?.close();
});

describe('Validation des URLs d’affiche / bannière', () => {
  it('rejette une URL de host non autorisé (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/shows/${showId}/poster`,
      payload: { posterPath: 'https://evil.example.com/pwn.jpg' },
      headers: bearer(tokenA),
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejette une URL http (non https)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/shows/${showId}/banner`,
      payload: { backdropPath: 'http://image.tmdb.org/t/p/x.jpg' },
      headers: bearer(tokenA),
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepte un chemin TMDb relatif', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/shows/${showId}/poster`,
      payload: { posterPath: '/abc123.jpg' },
      headers: bearer(tokenA),
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepte les hosts connus (image.tmdb.org, images.igdb.com, *.thetvdb.com)', async () => {
    for (const url of [
      'https://image.tmdb.org/t/p/original/x.jpg',
      'https://images.igdb.com/igdb/image/upload/t_1080p/y.jpg',
      'https://artworks.thetvdb.com/banners/v4/series/1/posters/z.jpg',
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/games/${gameId}/poster`,
        payload: { posterPath: url },
        headers: bearer(tokenA),
      });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('Réglages PAR utilisateur (isolation)', () => {
  it('les réglages d’Alice n’affectent pas ceux de Bob', async () => {
    const save = await app.inject({
      method: 'POST',
      url: '/api/settings',
      payload: { theme: 'dark', titlesInUserLanguage: false },
      headers: bearer(tokenA),
    });
    expect(save.statusCode).toBe(200);
    expect(save.json().settings.theme).toBe('dark');

    const alice = await app.inject({ method: 'GET', url: '/api/settings', headers: bearer(tokenA) });
    expect(alice.json().settings.theme).toBe('dark');
    expect(alice.json().settings.titlesInUserLanguage).toBe(false);

    // Bob garde les valeurs par défaut.
    const bob = await app.inject({ method: 'GET', url: '/api/settings', headers: bearer(tokenB) });
    expect(bob.json().settings.theme).toBe('light');
    expect(bob.json().settings.titlesInUserLanguage).toBe(true);
  });

  it('ignore les clés inconnues sans erreur', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings',
      payload: { theme: 'sunset', clefBidon: 'valeur-arbitraire' },
      headers: bearer(tokenA),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.theme).toBe('sunset');
    expect('clefBidon' in res.json().settings).toBe(false);
  });
});

describe('completedAt sur les jeux', () => {
  it('pose completedAt quand le jeu passe à « completed », le retire sinon', async () => {
    const done = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/status`,
      payload: { status: 'completed' },
      headers: bearer(tokenA),
    });
    expect(done.statusCode).toBe(200);
    const aliceUser = await prismaClient.user.findFirstOrThrow({ where: { email: 'alice@example.com' } });
    const status = await prismaClient.userMediaStatus.findUniqueOrThrow({
      where: { userId_mediaId: { userId: aliceUser.id, mediaId: gameId } },
    });
    expect(status.completedAt).not.toBeNull();

    const playing = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/status`,
      payload: { status: 'playing' },
      headers: bearer(tokenA),
    });
    expect(playing.statusCode).toBe(200);
    const after = await prismaClient.userMediaStatus.findUniqueOrThrow({
      where: { userId_mediaId: { userId: aliceUser.id, mediaId: gameId } },
    });
    expect(after.completedAt).toBeNull();
  });
});

describe('Contrôle d’audience OAuth', () => {
  it('Facebook : refuse un jeton émis pour une AUTRE app (401)', async () => {
    fbDebug = { app_id: 'attacker-app', is_valid: true };
    fbProfile = { id: 'fb-victim', name: 'Victime' };
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/oauth',
      payload: { provider: 'facebook', token: 'jeton-vole' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_oauth_token');
  });

  it('Facebook : accepte un jeton de NOTRE app', async () => {
    fbDebug = { app_id: 'our-fb-app', is_valid: true };
    fbProfile = { id: 'fb-legit', name: 'Légitime', email: 'legit@fb.com' };
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/oauth',
      payload: { provider: 'facebook', token: 'jeton-valide' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
  });

  it('Discord : refuse un jeton émis pour une AUTRE app (401)', async () => {
    discordAppId = 'attacker-app';
    discordProfile = { id: 'discord-victim', username: 'victime' };
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/oauth',
      payload: { provider: 'discord', token: 'jeton-vole' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_oauth_token');
  });

  it('Discord : accepte un jeton de NOTRE app', async () => {
    discordAppId = 'our-discord-app';
    discordProfile = { id: 'discord-legit', username: 'legitime', verified: true, email: 'legit@discord.com' };
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/oauth',
      payload: { provider: 'discord', token: 'jeton-valide' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
  });
});
