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
let token = '';

function buildTvtimeZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'followed_tv_show.csv',
    Buffer.from(
      'tv_show_name,status,is_favorite,created_at,tvdb_id\n' +
        'Dark,watching,true,2020-05-01 10:00:00,297621\n' +
        'Silo,up_to_date,false,2023-05-05 10:00:00,335275\n' +
        'Obscure Show Without Year,,,,\n',
    ),
  );
  zip.addFile(
    'seen_episode.csv',
    Buffer.from(
      'tv_show_name,episode_season_number,episode_number,watched_at,tvdb_id\n' +
        'Dark,1,1,2020-05-02 21:00:00,297621\n' +
        'Dark,1,2,2020-05-03 21:00:00,297621\n' +
        'Dark,1,2,2020-05-03 21:00:00,297621\n' + // doublon volontaire
        'Silo,1,1,2023-05-06 21:00:00,335275\n',
    ),
  );
  zip.addFile(
    'watched_movie.json',
    Buffer.from(
      JSON.stringify([
        { movie_title: 'Mickey 17', release_date: '2025-03-05', is_watched: true, watched_at: '2025-03-10 20:00:00', tmdb_id: '696506', rating: 8 },
        { movie_title: 'Suzume', release_date: '2022-11-11', is_watched: false, list: 'Films anime' },
      ]),
    ),
  );
  zip.addFile('user_profile.json', Buffer.from(JSON.stringify({ name: 'Etienne' })));
  zip.addFile('readme.pdf', Buffer.from('not parsed'));
  return zip.toBuffer();
}

function multipart(buffer: Buffer, filename: string): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----serietime-test-boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/zip\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, buffer, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
  const { buildApp } = await import('../app.js');
  app = await buildApp();
}, 120_000);

afterAll(async () => {
  await app?.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe('SerieTime API', () => {
  it('GET /health répond avec le nom de l’app', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, app: 'SerieTime', version: '1.0.0' });
  });

  it('register crée un compte et retourne un token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { displayName: 'Etienne', email: 'etienne@example.com', password: 'secret123' },
    });
    expect(res.statusCode).toBe(200);
    token = res.json().token;
    expect(token).toBeTruthy();
    expect(res.json().user.provider).toBe('password');
  });

  it('register refuse un e-mail déjà utilisé', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { displayName: 'Autre', email: 'etienne@example.com', password: 'secret123' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('email_taken');
  });

  it('supporte plusieurs comptes indépendants', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { displayName: 'Bob', email: 'bob@example.com', password: 'secret123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).not.toBe('');
  });

  it('expose les providers SSO configurés', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/providers' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ password: true });
  });

  it('rejette les requêtes non authentifiées', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/shows' });
    expect(res.statusCode).toBe(401);
  });

  it('login fonctionne avec e-mail et mot de passe', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'etienne@example.com', password: 'nope' },
    });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'etienne@example.com', password: 'secret123' },
    });
    expect(ok.statusCode).toBe(200);
  });

  let importId = '';

  it('upload refuse un fichier non-ZIP', async () => {
    const { payload, headers } = multipart(Buffer.from('pas un zip'), 'fake.zip');
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/tvtime/upload',
      payload,
      headers: { ...headers, ...auth() },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('not_a_zip');
  });

  it('upload accepte un ZIP TV Time', async () => {
    const { payload, headers } = multipart(buildTvtimeZip(), 'tvtime-export.zip');
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/tvtime/upload',
      payload,
      headers: { ...headers, ...auth() },
    });
    expect(res.statusCode).toBe(200);
    importId = res.json().importId;
    expect(importId).toBeTruthy();
  });

  it('upload refuse le même ZIP une deuxième fois (sauf force)', async () => {
    const { payload, headers } = multipart(buildTvtimeZip(), 'tvtime-export.zip');
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/tvtime/upload',
      payload,
      headers: { ...headers, ...auth() },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('already_imported');
  });

  it('analyse détecte séries, films, épisodes, doublons', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/import/tvtime/${importId}/analyze`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const { summary } = res.json();
    expect(summary.showsDetected).toBe(3);
    expect(summary.moviesDetected).toBe(2);
    expect(summary.episodesWatchedDetected).toBe(3);
    expect(summary.duplicatesIgnored).toBe(1);
    expect(summary.listsDetected).toBe(1);
    expect(summary.favoritesDetected).toBe(1);
    // Dark et Silo ont un tvdb_id (score 100), Mickey 17 un tmdb_id, Suzume titre+année (90)
    // → tous auto sauf "Obscure Show Without Year" (titre seul, 50)
    expect(summary.autoImport).toBe(4);
    expect(summary.unresolved).toBe(1);
  });

  it('liste les éléments non résolus avec suggestions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/import/tvtime/${importId}/unresolved`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const { items } = res.json();
    expect(items).toHaveLength(1);
    expect(items[0].sourceTitle).toBe('Obscure Show Without Year');
  });

  it('confirme l’import et applique les données', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/import/tvtime/${importId}/confirm`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().applied).toBe(4);
  });

  it('résout manuellement un mapping par création', async () => {
    const unresolved = await app.inject({
      method: 'GET',
      url: `/api/import/tvtime/${importId}/unresolved`,
      headers: auth(),
    });
    const mappingId = unresolved.json().items[0].id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/import/tvtime/${importId}/resolve`,
      payload: { mappingId, create: { title: 'Obscure Show Without Year', type: 'show' } },
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: `/api/import/tvtime/${importId}/unresolved`,
      headers: auth(),
    });
    expect(after.json().items).toHaveLength(0);
  });

  it('les séries importées apparaissent avec leur progression', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/shows', headers: auth() });
    const shows = res.json().shows;
    expect(shows.length).toBeGreaterThanOrEqual(3);
    const dark = shows.find((s: { title: string }) => s.title === 'Dark');
    expect(dark).toBeTruthy();
    expect(dark.isFavorite).toBe(true);
    expect(dark.userStatus).toBe('watching');
  });

  it('les films importés sont vus / à voir', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/movies/profile', headers: auth() });
    const { seen, unseen } = res.json();
    expect(seen.map((m: { title: string }) => m.title)).toContain('Mickey 17');
    expect(unseen.map((m: { title: string }) => m.title)).toContain('Suzume');
  });

  it('la liste personnelle a été créée avec son item', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/lists', headers: auth() });
    const lists = res.json().lists;
    const animeList = lists.find((l: { title: string }) => l.title === 'Films anime');
    expect(animeList).toBeTruthy();
    expect(animeList.itemCount).toBe(1);
  });

  it('marque un épisode vu puis non vu', async () => {
    const shows = await app.inject({ method: 'GET', url: '/api/shows', headers: auth() });
    const dark = shows.json().shows.find((s: { title: string }) => s.title === 'Dark');
    const eps = await app.inject({ method: 'GET', url: `/api/shows/${dark.id}/episodes`, headers: auth() });
    const season1 = eps.json().seasons.find((s: { seasonNumber: number }) => s.seasonNumber === 1);
    expect(season1.watchedCount).toBe(2);
    const epId = season1.episodes[0].id;

    const unwatch = await app.inject({ method: 'POST', url: `/api/episodes/${epId}/unwatched`, headers: auth() });
    expect(unwatch.statusCode).toBe(200);
    const rewatch = await app.inject({ method: 'POST', url: `/api/episodes/${epId}/watched`, headers: auth() });
    expect(rewatch.statusCode).toBe(200);
  });

  it('les stats profil reflètent les visionnages', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/profile/stats', headers: auth() });
    const { stats } = res.json();
    expect(stats.episodesWatched).toBe(3);
    expect(stats.moviesWatched).toBe(1);
    expect(stats.showMinutes).toBeGreaterThan(0);
  });

  it('gère favoris et listes', async () => {
    const shows = await app.inject({ method: 'GET', url: '/api/shows', headers: auth() });
    const silo = shows.json().shows.find((s: { title: string }) => s.title === 'Silo');
    const fav = await app.inject({ method: 'POST', url: `/api/shows/${silo.id}/favorite`, headers: auth() });
    expect(fav.json().isFavorite).toBe(true);

    const created = await app.inject({
      method: 'POST',
      url: '/api/lists',
      payload: { title: 'Ma liste' },
      headers: auth(),
    });
    const listId = created.json().id;
    const added = await app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/items`,
      payload: { mediaId: silo.id },
      headers: auth(),
    });
    expect(added.json().added).toBe(true);
  });

  it('change affiche et bannière', async () => {
    const shows = await app.inject({ method: 'GET', url: '/api/shows', headers: auth() });
    const silo = shows.json().shows.find((s: { title: string }) => s.title === 'Silo');
    const poster = await app.inject({
      method: 'POST',
      url: `/api/shows/${silo.id}/poster`,
      payload: { posterPath: '/custom-poster.jpg' },
      headers: auth(),
    });
    expect(poster.statusCode).toBe(200);
    const banner = await app.inject({
      method: 'POST',
      url: `/api/shows/${silo.id}/banner`,
      payload: { backdropPath: '/custom-banner.jpg' },
      headers: auth(),
    });
    expect(banner.statusCode).toBe(200);
  });

  it('met à jour le profil (avatar, couverture, infos)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/profile',
      payload: {
        displayName: 'Etienne Poupou',
        avatarUrl: 'data:image/jpeg;base64,AAAA',
        coverUrl: 'https://artworks.thetvdb.com/banners/fanart/original/334824-16.jpg',
        birthYear: 1993,
        gender: 'male',
        countryCode: 'FR',
      },
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const profile = await app.inject({ method: 'GET', url: '/api/profile', headers: auth() });
    const u = profile.json().user;
    expect(u.displayName).toBe('Etienne Poupou');
    expect(u.avatarUrl).toBe('data:image/jpeg;base64,AAAA');
    expect(u.coverUrl).toContain('thetvdb.com');
    expect(u.birthYear).toBe(1993);
    expect(u.gender).toBe('male');
  });

  it('change l’affiche et la bannière d’un film', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/movies/profile', headers: auth() });
    const movie = res.json().seen.find((m: { title: string }) => m.title === 'Mickey 17');
    expect(movie).toBeTruthy();

    const poster = await app.inject({
      method: 'POST',
      url: `/api/movies/${movie.id}/poster`,
      payload: { posterPath: '/mickey-poster.jpg' },
      headers: auth(),
    });
    expect(poster.statusCode).toBe(200);
    const banner = await app.inject({
      method: 'POST',
      url: `/api/movies/${movie.id}/banner`,
      payload: { backdropPath: '/mickey-banner.jpg' },
      headers: auth(),
    });
    expect(banner.statusCode).toBe(200);

    const images = await app.inject({ method: 'GET', url: `/api/movies/${movie.id}/images`, headers: auth() });
    expect(images.statusCode).toBe(200);
    expect(images.json().selectedPoster).toBe('/mickey-poster.jpg');
    expect(images.json().selectedBackdrop).toBe('/mickey-banner.jpg');
    expect(images.json().posters).toContain('/mickey-poster.jpg');

    const detail = await app.inject({ method: 'GET', url: `/api/movies/${movie.id}`, headers: auth() });
    expect(detail.json().media.posterPath).toBe('/mickey-poster.jpg');
    expect(detail.json().media.backdropPath).toBe('/mickey-banner.jpg');
  });

  it('exporte une sauvegarde SerieTime', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/backup/export', headers: auth() });
    expect(res.statusCode).toBe(200);
    const backup = res.json();
    expect(backup.app).toBe('SerieTime');
    expect(backup.data.media.length).toBeGreaterThanOrEqual(5);
    expect(backup.data.episodeStatuses.length).toBeGreaterThanOrEqual(3);
  });

  it('la file À voir contient les séries avec épisodes restants', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/shows/queue', headers: auth() });
    expect(res.statusCode).toBe(200);
    // Dark: 2 épisodes vus importés mais pas d'épisodes non vus en base → pas dans la file.
    // Obscure Show / pas commencé: présent dans le groupe pas_commence seulement s'il a des épisodes à voir.
    expect(Array.isArray(res.json().items)).toBe(true);
  });
});
