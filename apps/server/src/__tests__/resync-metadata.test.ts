import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-resync-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'resync.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TMDB_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let prisma: typeof import('../db/client.js')['prisma'];
let refreshMediaMetadata: typeof import('../services/tmdb/enrich.js')['refreshMediaMetadata'];

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
  ({ prisma } = await import('../db/client.js'));
  ({ refreshMediaMetadata } = await import('../services/tmdb/enrich.js'));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('refreshMediaMetadata — garde-fous (sans API)', () => {
  it('ignore les jeux (IGDB, hors périmètre)', async () => {
    const g = await prisma.media.create({ data: { type: 'game', title: 'Jeu test', year: 2025 } });
    expect(await refreshMediaMetadata(g)).toBe('skipped');
    // L'année du jeu n'est pas touchée.
    const after = await prisma.media.findUniqueOrThrow({ where: { id: g.id } });
    expect(after.year).toBe(2025);
  });

  it('ignore une fiche sans identifiant externe', async () => {
    const m = await prisma.media.create({ data: { type: 'movie', title: 'Film local', year: 1 } });
    expect(await refreshMediaMetadata(m)).toBe('skipped');
  });

  it('ignore un film à tmdbId quand TMDb est désactivé (pas de crash)', async () => {
    const m = await prisma.media.create({ data: { type: 'movie', title: 'Film TMDb', year: 1, tmdbId: '123' } });
    expect(await refreshMediaMetadata(m)).toBe('skipped');
  });
});
