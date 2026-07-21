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
const WATCHED_P1 = new Date('2019-02-01T20:00:00Z'); // épisode de la série en pause
const MOVIE_SEEN_AT = new Date('2025-03-10T20:00:00Z');

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
  // 1 série suivie (2 épisodes vus + notes), 1 série abandonnée, 1 série EN
  // PAUSE (avec 1 épisode vu : le statut doit être restitué, pas déduit),
  // 1 série PAS COMMENCÉE, 1 série favorite en watchlist,
  // 1 film vu (noté + favori), 1 film à voir.
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
  const paused = await prisma.media.create({
    data: { type: 'show', title: 'Pause Café', year: 2019, tvdbId: '313131', show: { create: {} } },
    include: { show: true },
  });
  const p1 = await prisma.episode.create({
    data: { showId: paused.show!.id, seasonNumber: 1, episodeNumber: 1, title: 'Pilote', tvdbId: '7000001' },
  });
  const fresh = await prisma.media.create({
    data: { type: 'show', title: 'Jamais Commencée', year: 2023, tvdbId: '646464', show: { create: {} } },
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
      { userId: userA, mediaId: paused.id, status: 'paused', addedAt: new Date('2019-01-15T10:00:00Z') },
      { userId: userA, mediaId: fresh.id, status: 'not_started', addedAt: new Date('2023-09-01T10:00:00Z') },
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
        rating: 7,
        isFavorite: true,
        favoritedAt: new Date('2025-03-11T09:00:00Z'),
        completedAt: MOVIE_SEEN_AT,
        lastWatchedAt: MOVIE_SEEN_AT,
      },
      { userId: userA, mediaId: movieLater.id, status: 'watchlist' },
    ],
  });
  await prisma.userEpisodeStatus.createMany({
    data: [
      { userId: userA, episodeId: e1.id, status: 'watched', watchedAt: WATCHED_E1, rating: 8 },
      { userId: userA, episodeId: e2.id, status: 'watched', watchedAt: WATCHED_E2 },
      { userId: userA, episodeId: p1.id, status: 'watched', watchedAt: WATCHED_P1 },
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
    expect(seen).toHaveLength(4); // en-tête + 3 épisodes vus (tri watched_at asc)
    expect(seen[1]).toBe('Pause Café,313131,,1,1,7000001,2019-02-01 20:00:00,');
    expect(seen[2]).toBe('Dark,297621,,1,1,6108214,2020-05-02 21:00:00,8');
    expect(seen[3]).toBe('Dark,297621,,1,2,6108215,2020-05-03 21:00:00,');

    const followed = read('followed_tv_show.csv');
    expect(followed[0]).toBe('tv_show_name,tvdb_id,tmdb_id,active,status,created_at,rating');
    // Titre avec virgule échappé + série arrêtée → active=0 (convention TV Time)
    // ET status=stopped_watching (notre colonne de statut fin).
    expect(followed.find((l) => l.includes('Vieille'))).toBe('"Vieille Série, arrêtée",424242,,0,stopped_watching,2021-01-01 10:00:00,');
    expect(followed.find((l) => l.startsWith('Dark'))).toBe('Dark,297621,,1,watching,2020-05-01 10:00:00,9');
    expect(followed.find((l) => l.startsWith('Pause Café'))).toBe('Pause Café,313131,,1,paused,2019-01-15 10:00:00,');
    expect(followed.find((l) => l.startsWith('Jamais'))).toBe('Jamais Commencée,646464,,1,not_started,2023-09-01 10:00:00,');
    expect(followed.find((l) => l.startsWith('Future'))).toBe('Future Pépite,555555,,1,for_later,2024-06-01 10:00:00,');

    const special = read('user_show_special_status.csv');
    expect(special[0]).toBe('entity_type,tv_show_name,tv_show_id,tmdb_id,status,created_at');
    expect(special.filter((l) => l.endsWith('favorite,2024-06-01 10:00:00') && l.startsWith('show,Future Pépite'))).toHaveLength(1);
    expect(special.filter((l) => l.includes(',for_later,') && l.startsWith('show,Future Pépite'))).toHaveLength(1);
    // Favori FILM : entity_type=movie + tmdb_id (pas d'id TheTVDB pour un film).
    expect(special.find((l) => l.startsWith('movie,'))).toBe('movie,Mickey 17,,696506,favorite,2025-03-11 09:00:00');

    const tracking = read('tracking-prod-records-v2.csv');
    expect(tracking[0]).toBe('entity_type,movie_name,release_date,type,tmdb_id,created_at,rating');
    expect(tracking.find((l) => l.includes('Mickey 17'))).toBe('movie,Mickey 17,2025-03-05,watch,696506,2025-03-10 20:00:00,7');
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
    expect(summary.showsDetected).toBe(5);
    expect(summary.moviesDetected).toBe(2);
    expect(summary.episodesWatchedDetected).toBe(3);
    expect(summary.favoritesDetected).toBe(2); // 1 série + 1 film
    expect(summary.ratingsDetected).toBe(2); // note de série (Dark, 9) + note de film (Mickey 17, 7)
    // Toutes les entrées portent un id externe ou titre+année : rien à résoudre à la main.
    expect(summary.unresolved).toBe(0);
    expect(summary.autoImport).toBe(7);

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
      include: { episode: { include: { show: { include: { media: true } } } } },
      orderBy: { watchedAt: 'asc' },
    });
    expect(statuses).toHaveLength(3);
    const darkEpisodes = statuses.filter((s) => s.episode.show.media.title === 'Dark');
    expect(darkEpisodes.map((s) => s.episode.episodeNumber)).toEqual([1, 2]);
    // Les dates ne dérivent pas de plus d'un jour (l'export écrit l'heure UTC,
    // l'import la relit dans le fuseau du serveur — comme un vrai export TV Time).
    const DAY = 24 * 3600 * 1000;
    expect(Math.abs(darkEpisodes[0]!.watchedAt!.getTime() - WATCHED_E1.getTime())).toBeLessThan(DAY);
    expect(Math.abs(darkEpisodes[1]!.watchedAt!.getTime() - WATCHED_E2.getTime())).toBeLessThan(DAY);
    expect(darkEpisodes[0]!.rating).toBe(8);
  });

  it('le compte cible retrouve les statuts fins À L’IDENTIQUE (pas déduits)', async () => {
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId: userB },
      include: { media: true },
    });
    const byTitle = new Map(statuses.map((s) => [s.media.title, s]));

    expect(byTitle.get('Dark')?.status).toBe('watching');
    expect(byTitle.get('Vieille Série, arrêtée')?.status).toBe('abandoned');
    // En pause AVEC un épisode vu : sans la colonne status, la recalculation
    // l'aurait déduite « watching » — elle doit revenir « paused ».
    expect(byTitle.get('Pause Café')?.status).toBe('paused');
    expect(byTitle.get('Jamais Commencée')?.status).toBe('not_started');
    expect(byTitle.get('Future Pépite')?.status).toBe('watchlist');
    expect(byTitle.get('Future Pépite')?.isFavorite).toBe(true);
    expect(byTitle.get('Dark')?.rating).toBe(9);
    expect(byTitle.get('Suzume')?.status).toBe('watchlist');
  });

  it('le compte cible retrouve date de visionnage, note et favori du film', async () => {
    const mickey = await prisma.userMediaStatus.findFirst({
      where: { userId: userB, media: { title: 'Mickey 17' } },
    });
    expect(mickey?.status).toBe('completed');
    expect(mickey?.rating).toBe(7);
    expect(mickey?.isFavorite).toBe(true);
    // La date de visionnage vient du created_at du tracking record (fuseau
    // serveur à la relecture, comme pour les épisodes) — pas du favori, ni de « maintenant ».
    const DAY = 24 * 3600 * 1000;
    expect(mickey?.completedAt).toBeTruthy();
    expect(Math.abs(mickey!.completedAt!.getTime() - MOVIE_SEEN_AT.getTime())).toBeLessThan(DAY);
  });

  it('ré-importe sur les médias existants sans créer de doublon catalogue', async () => {
    // L'analyse doit auto-résoudre sur les médias déjà en base (id externe ou
    // titre+année) : aucun doublon « Dark » / « Mickey 17 » n'est créé.
    expect(await prisma.media.count({ where: { title: 'Dark' } })).toBe(1);
    expect(await prisma.media.count({ where: { title: 'Mickey 17' } })).toBe(1);
  });
});
