import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-reports-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'reports.sqlite')}`;
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

describe('Signalement d’œuvre — POST /api/report', () => {
  it('crée un signalement (status pending par défaut)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/report',
      payload: { mediaType: 'movie', tmdbId: '550', title: 'Contenu douteux', reason: 'adult' },
      headers: bearer('Alice'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    const { prisma } = await import('../db/client.js');
    const rows = await prisma.report.findMany({ where: { reporterId: acc('Alice').id, tmdbId: '550' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
    expect(rows[0]!.reason).toBe('adult');
    expect(rows[0]!.mediaType).toBe('movie');
  });

  it('ne duplique pas un signalement identique déjà en attente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/report',
      payload: { mediaType: 'movie', tmdbId: '550', title: 'Contenu douteux' },
      headers: bearer('Alice'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    const { prisma } = await import('../db/client.js');
    const rows = await prisma.report.findMany({ where: { reporterId: acc('Alice').id, tmdbId: '550' } });
    expect(rows).toHaveLength(1);
  });
});
