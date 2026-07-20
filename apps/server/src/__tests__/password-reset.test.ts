import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Réinitialisation du mot de passe par ré-authentification SSO (sans ancien
// mot de passe) : l'identité est prouvée par le provider (Discord ici, mocké),
// le serveur délivre un jeton de reset à usage unique (10 min) stocké en DB.
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-pwreset-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'pwreset.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';
// OAuth fail closed : sans DISCORD_CLIENT_ID le provider serait refusé
// (provider_not_configured) — on configure l'app Discord mockée.
process.env.DISCORD_CLIENT_ID = 'our-discord-app';

let app: FastifyInstance;
let prismaClient: (typeof import('../db/client.js'))['prisma'];
let userId = '';

// Profil Discord renvoyé par le fetch mocké (mutable par test).
let discordProfile: Record<string, unknown> = {};

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

  // Le serveur vérifie le jeton Discord via fetch → on mocke l'API Discord.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      if (String(url).startsWith('https://discord.com/api/oauth2/@me')) {
        // Contrôle d'audience : le jeton mocké appartient bien à NOTRE app.
        return new Response(JSON.stringify({ application: { id: 'our-discord-app' } }), { status: 200 });
      }
      if (String(url).startsWith('https://discord.com/api/users/@me')) {
        return new Response(JSON.stringify(discordProfile), { status: 200 });
      }
      throw new Error(`fetch inattendu en test : ${String(url)}`);
    }),
  );

  // Compte e-mail/mot de passe avec une identité Discord liée.
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName: 'Oublieux', email: 'oubli@example.com', password: 'ancien-mdp-123' },
  });
  expect(res.statusCode).toBe(200);
  userId = res.json().user.id;
  await prisma.user.update({ where: { id: userId }, data: { discordId: 'discord-1234' } });
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await app?.close();
});

async function initReset() {
  return app.inject({
    method: 'POST',
    url: '/api/auth/reset-password/init',
    payload: { provider: 'discord', token: 'jeton-discord-quelconque' },
  });
}

describe('réinitialisation du mot de passe via SSO', () => {
  it('refuse un jeton OAuth invalide (Discord répond sans id)', async () => {
    discordProfile = {};
    const res = await initReset();
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_oauth_token');
  });

  it("refuse une identité SSO qui n'est liée à aucun compte (jamais par e-mail)", async () => {
    // Même e-mail vérifié que le compte, mais un id Discord inconnu : refus —
    // l'identité doit correspondre par (provider, id), jamais par e-mail.
    discordProfile = { id: 'discord-inconnu', username: 'x', email: 'oubli@example.com', verified: true };
    const res = await initReset();
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('no_account_for_identity');
  });

  it('flux complet : ré-auth Discord → jeton → nouveau mot de passe → login', async () => {
    discordProfile = { id: 'discord-1234', username: 'oublieux', email: 'oubli@example.com', verified: true };
    const init = await initReset();
    expect(init.statusCode).toBe(200);
    const { resetToken } = init.json();
    expect(typeof resetToken).toBe('string');
    expect(resetToken.length).toBeGreaterThanOrEqual(32);

    const before = await prismaClient.user.findUniqueOrThrow({ where: { id: userId } });

    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { resetToken, newPassword: 'nouveau-mdp-456' },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().ok).toBe(true);

    // L'ancien mot de passe ne passe plus, le nouveau oui.
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'oubli@example.com', password: 'ancien-mdp-123' },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'oubli@example.com', password: 'nouveau-mdp-456' },
    });
    expect(newLogin.statusCode).toBe(200);

    // Seul le hash change : les autres champs du compte restent intacts.
    const after = await prismaClient.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.email).toBe(before.email);
    expect(after.displayName).toBe(before.displayName);
    expect(after.discordId).toBe(before.discordId);
    expect(after.provider).toBe(before.provider);
    expect(after.isPrivate).toBe(before.isPrivate);
  });

  it('refuse un jeton déjà utilisé (usage unique)', async () => {
    discordProfile = { id: 'discord-1234', username: 'oublieux', verified: true };
    const init = await initReset();
    const { resetToken } = init.json();
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { resetToken, newPassword: 'encore-un-mdp-789' },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { resetToken, newPassword: 'pirate-mdp-000' },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe('reset_token_expired');
    // Le mot de passe posé au 2e appel ne fonctionne pas.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'oubli@example.com', password: 'pirate-mdp-000' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('refuse un jeton expiré (10 minutes dépassées)', async () => {
    const expired = await prismaClient.passwordResetToken.create({
      data: { token: 'jeton-expire-test', userId, expiresAt: new Date(Date.now() - 60_000) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { resetToken: expired.token, newPassword: 'trop-tard-123' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('reset_token_expired');
  });

  it('refuse un jeton inconnu', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { resetToken: 'nimporte-quoi', newPassword: 'mdp-valide-123' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_reset_token');
  });

  it('valide le nouveau mot de passe (8 caractères minimum, comme le register)', async () => {
    discordProfile = { id: 'discord-1234', username: 'oublieux', verified: true };
    const init = await initReset();
    const { resetToken } = init.json();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { resetToken, newPassword: 'court' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('un nouveau jeton invalide le précédent (un seul jeton actif)', async () => {
    discordProfile = { id: 'discord-1234', username: 'oublieux', verified: true };
    const first = await initReset();
    const second = await initReset();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { resetToken: first.json().resetToken, newPassword: 'mdp-perime-123' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_reset_token');
    // Le dernier jeton, lui, fonctionne.
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { resetToken: second.json().resetToken, newPassword: 'mdp-final-999' },
    });
    expect(ok.statusCode).toBe(200);
  });
});
