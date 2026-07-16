// Doit être défini AVANT tout import qui charge `config/env.ts` (parsé au load).
process.env.ALLOW_EMAIL_SIGNUP = 'false';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import('../app.js');
  app = await buildApp();
}, 120_000);

afterAll(async () => {
  await app?.close();
  delete process.env.ALLOW_EMAIL_SIGNUP;
});

describe('inscription e-mail désactivée (ALLOW_EMAIL_SIGNUP=false)', () => {
  it('POST /api/auth/register renvoie 403 email_signup_disabled', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { displayName: 'Nouveau', email: 'nouveau@example.com', password: 'secret123' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('email_signup_disabled');
  });

  it("le login e-mail d'un compte existant reste possible", async () => {
    // Crée le compte directement en base (bcrypt), puis se connecte : la
    // désactivation ne concerne QUE l'inscription, pas la connexion existante.
    const { prisma } = await import('../db/client.js');
    const bcrypt = (await import('bcryptjs')).default;
    await prisma.user.create({
      data: {
        displayName: 'Ancien',
        email: 'ancien@example.com',
        passwordHash: await bcrypt.hash('secret123', 10),
        provider: 'password',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ancien@example.com', password: 'secret123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
  });
});
