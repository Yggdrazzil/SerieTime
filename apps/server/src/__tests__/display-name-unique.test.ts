import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Base SQLite temporaire, définie AVANT tout import qui charge `config/env.ts`
// (même mécanique que les autres tests).
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-test-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'displayname.sqlite')}`;
process.env.NODE_ENV = 'test';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let tokenA = '';
let tokenB = '';

async function register(displayName: string, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName, email, password: 'secret123' },
  });
  return res.json().token as string;
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
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('nom d’affichage unique (POST /api/profile)', () => {
  it('refuse un pseudo déjà porté par un autre compte (409, insensible à la casse)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/profile',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { displayName: 'aLiCe' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('display_name_taken');
  });

  it('accepte un pseudo libre, avec chiffres et caractères spéciaux', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/profile',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { displayName: 'Bob_42 ⭐️ !' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.displayName).toBe('Bob_42 ⭐️ !');
  });

  it('accepte de reprendre son PROPRE pseudo (changement de casse)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/profile',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { displayName: 'ALICE' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.displayName).toBe('ALICE');
  });
});
