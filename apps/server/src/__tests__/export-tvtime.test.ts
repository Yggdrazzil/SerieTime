import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-test-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'test.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TMDB_READ_ACCESS_TOKEN = '';
process.env.TVMAZE_ENABLED = 'false';

let app: FastifyInstance;
let prisma: (typeof import('../db/client.js'))['prisma'];
let tokenA = ''; // compte source (exporte)
let tokenB = ''; // compte cible (ré-importe le zip)
let userA = '';
let userB = '';

// Mécanique multipart identique à api.test.ts (upload du zip via app.inject).
function multipart(buffer: Buffer, filename: string): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----plottime-export-test-boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/zip\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, buffer, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const WATCHED_E1 = new Date('2020-05-02T21:00:00Z');
const WATCHED_E2 = new Date('2020-05-03T21:00:00Z');

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
  const { buildApp } = await import('../app.js');
  app = await buildApp();
  ({ prisma } = await import('../db/client.js'));

  const register = async (name: string, email: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { displayName: name, email, password: 'secret123' },
    });
    return { token: res.json().token as string, id: res.json().user.id as string };
  };
  ({ token: tokenA, id: userA } = await register('Exporteur', 'export@example.com'));
  ({ token: tokenB, id: userB } = await register('Importeur', 'import@example.com'));

  // ————— Seed du compte A —————
  // 1 série suivie (2 épisodes vus + notes), 1 série abandonnée,
  // 1 série favorite en watchlist, 1 film vu, 1 film à voir.
  const dark = await prisma.media.create({
    data: { type: 'show', title: 'Dark', year: 2017, tvdbId: '297621', show: { create: {} } },
    include: { show: true },
  });
  const e1 = await prisma.episode.create({
    data: { showId: dark.show!.id, seasonNumber: 1, episodeNumber: 1, title: 'Secrets', tvdbId: '6108214' },
  });
  const e2 = await prisma.episode.create({
    data: { showId: dark.show!.id, seasonNumber: 1, episodeNumber: 2, title: 'Mensonges', tvdbId: '6108215' },
  });
  const stopped = await prisma.media.create({
    data: { type: 'show', title: 'Vieille Série, arrêtée', year: 2010, tvdbId: '424242', show: { create: {} } },
  });
  const later = await prisma.media.create({
    data: { type: 'show', title: 'Future Pépite', year: 2024, tvdbId: '555555', show: { create: {} } },
  });
  const movieSeen = await prisma.media.create({
    data: { type: 'movie', title: 'Mickey 17', year: 2025, tmdbId: '696506', releaseDate: new Date('2025-03-05'), movie: { create: {} } },
  });
  const movieLater = await prisma.media.create({
    data: { type: 'movie', title: 'Suzume', year: 2022, releaseDate: new Date('2022-11-11'), movie: { create: {} } },
  });

  await prisma.userMediaStatus.createMany({
    data: [
      { userId: userA, mediaId: dark.id, status: 'watching', rating: 9, addedAt: new Date('2020-05-01T10:00:00Z') },
      { userId: userA, mediaId: stopped.id, status: 'abandoned', addedAt: new Date('2021-01-01T10:00:00Z') },
      {
        userId: userA,
        mediaId: later.id,
        status: 'watchlist',
        isFavorite: true,
        favoritedAt: new Date('2024-06-01T10:00:00Z'),
        addedAt: new Date('2024-06-01T10:00:00Z'),
      },
      {
        userId: userA,
        mediaId: movieSeen.id,
        status: 'completed',
        completedAt: new Date('2025-03-10T20:00:00Z'),
        lastWatchedAt: new Date('2025-03-10T20:00:00Z'),
      },
      { userId: userA, mediaId: movieLater.id, status: 'watchlist' },
    ],
  });
  await prisma.userEpisodeStatus.createMany({
    data: [
      { userId: userA, episodeId: e1.id, status: 'watched', watchedAt: WATCHED_E1, rating: 8 },
      { userId: userA, episodeId: e2.id, status: 'watched', watchedAt: WATCHED_E2 },
    ],
  });
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('Export au format TV Time', () => {
  let zipBuffer: Buffer;

  it('produit un ZIP avec les 4 fichiers calqués TV Time', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/backup/export-tvtime', headers: auth(tokenA) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('plottime-export-tvtime.zip');
    zipBuffer = res.rawPayload;
    const zip = new AdmZip(zipBuffer);
    const names = zip.getEntries().map((e) => e.entryName).sort();
    expect(names).toEqual([
      'followed_tv_show.csv',
      'seen_episode.csv',
      'tracking-prod-records-v2.csv',
      'user_show_special_status.csv',
    ]);
  });

  it('écrit les colonnes attendues (celles que notre normaliseur sait relire)', () => {
    const zip = new AdmZip(zipBuffer);
    const read = (name: string) => zip.getEntry(name)!.getData().toString('utf-8').trim().split('\n');

    const seen = read('seen_episode.csv');
    expect(seen[0]).toBe('tv_show_name,tvdb_id,tmdb_id,episode_season_number,episode_number,episode_id,watched_at,rating');
    expect(seen).toHaveLength(3); // en-tête + 2 épisodes vus
    expect(seen[1]).toBe('Dark,297621,,1,1,6108214,2020-05-02 21:00:00,8');
    expect(seen[2]).toBe('Dark,297621,,1,2,6108215,2020-05-03 21:00:00,');

    const followed = read('followed_tv_show.csv');
    expect(followed[0]).toBe('tv_show_name,tvdb_id,tmdb_id,active,created_at,rating');
    // Titre avec virgule échappé + série arrêtée → active=0 (la convention TV Time).
    expect(followed.find((l) => l.includes('Vieille'))).toBe('"Vieille Série, arrêtée",424242,,0,2021-01-01 10:00:00,');
    expect(followed.find((l) => l.startsWith('Dark'))).toBe('Dark,297621,,1,2020-05-01 10:00:00,9');

    const special = read('user_show_special_status.csv');
    expect(special[0]).toBe('tv_show_name,tv_show_id,tmdb_id,status,created_at');
    expect(special.filter((l) => l.endsWith('favorite,2024-06-01 10:00:00') && l.startsWith('Future Pépite'))).toHaveLength(1);
    expect(special.filter((l) => l.includes(',for_later,') && l.startsWith('Future Pépite'))).toHaveLength(1);

    const tracking = read('tracking-prod-records-v2.csv');
    expect(tracking[0]).toBe('entity_type,movie_name,release_date,type,tmdb_id,created_at');
    expect(tracking.find((l) => l.includes('Mickey 17'))).toBe('movie,Mickey 17,2025-03-05,watch,696506,2025-03-10 20:00:00');
    expect(tracking.find((l) => l.includes('Suzume'))).toContain('movie,Suzume,2022-11-11,towatch');
  });

  it('aller-retour : notre propre analyse d’import relit tout le zip', async () => {
    const { payload, headers } = multipart(zipBuffer, 'plottime-export-tvtime.zip');
    const up = await app.inject({
      method: 'POST',
      url: '/api/import/tvtime/upload',
      payload,
      headers: { ...headers, ...auth(tokenB) },
    });
    expect(up.statusCode).toBe(200);
    const importId = up.json().importId as string;

    const res = await app.inject({ method: 'POST', url: `/api/import/tvtime/${importId}/analyze`, headers: auth(tokenB) });
    expect(res.statusCode).toBe(200);
    const { summary } = res.json();
    expect(summary.showsDetected).toBe(3);
    expect(summary.moviesDetected).toBe(2);
    expect(summary.episodesWatchedDetected).toBe(2);
    expect(summary.favoritesDetected).toBe(1);
    expect(summary.ratingsDetected).toBe(1); // la note de série (Dark, 9)
    // Toutes les entrées portent un id externe ou titre+année : rien à résoudre à la main.
    expect(summary.unresolved).toBe(0);
    expect(summary.autoImport).toBe(5);

    // Confirmation : l'import (tâche de fond) doit aboutir.
    const confirm = await app.inject({ method: 'POST', url: `/api/import/tvtime/${importId}/confirm`, headers: auth(tokenB) });
    expect(confirm.statusCode).toBe(200);
    let status = '';
    for (let i = 0; i < 200 && status !== 'imported'; i++) {
      const s = await app.inject({ method: 'GET', url: `/api/import/tvtime/${importId}`, headers: auth(tokenB) });
      status = s.json().status;
      if (status !== 'imported') await new Promise((r) => setTimeout(r, 20));
    }
    expect(status).toBe('imported');
  });

  it('le compte cible retrouve les épisodes vus (dates et note comprises)', async () => {
    const statuses = await prisma.userEpisodeStatus.findMany({
      where: { userId: userB, status: 'watched' },
      include: { episode: true },
      orderBy: { episode: { episodeNumber: 'asc' } },
    });
    expect(statuses).toHaveLength(2);
    expect(statuses.map((s) => s.episode.episodeNumber)).toEqual([1, 2]);
    // Les dates ne dérivent pas de plus d'un jour (l'export écrit l'heure UTC,
    // l'import la relit dans le fuseau du serveur — comme un vrai export TV Time).
    const DAY = 24 * 3600 * 1000;
    expect(Math.abs(statuses[0]!.watchedAt!.getTime() - WATCHED_E1.getTime())).toBeLessThan(DAY);
    expect(Math.abs(statuses[1]!.watchedAt!.getTime() - WATCHED_E2.getTime())).toBeLessThan(DAY);
    expect(statuses[0]!.rating).toBe(8);
  });

  it('le compte cible retrouve statuts, favori, watchlist, note de série', async () => {
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId: userB },
      include: { media: true },
    });
    const byTitle = new Map(statuses.map((s) => [s.media.title, s]));

    expect(byTitle.get('Vieille Série, arrêtée')?.status).toBe('abandoned');
    expect(byTitle.get('Future Pépite')?.status).toBe('watchlist');
    expect(byTitle.get('Future Pépite')?.isFavorite).toBe(true);
    expect(byTitle.get('Dark')?.rating).toBe(9);
    expect(byTitle.get('Mickey 17')?.status).toBe('completed');
    expect(byTitle.get('Suzume')?.status).toBe('watchlist');
  });

  it('ré-importe sur les médias existants sans créer de doublon catalogue', async () => {
    // L'analyse doit auto-résoudre sur les médias déjà en base (id externe ou
    // titre+année) : aucun doublon « Dark » / « Mickey 17 » n'est créé.
    expect(await prisma.media.count({ where: { title: 'Dark' } })).toBe(1);
    expect(await prisma.media.count({ where: { title: 'Mickey 17' } })).toBe(1);
  });
});
