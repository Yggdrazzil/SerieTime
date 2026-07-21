// Marquages en masse vs défi hebdo + QG Communauté : un mark-all-watched ou
// un watched-previous upserte N UserEpisodeStatus mais ne crée qu'UN SEUL
// WatchEvent média-niveau (sans episodeId). Le défi hebdo et le compteur
// « Récemment vus » doivent donc se baser sur les STATUTS, pas sur les
// événements — sinon une saison cochée d'un coup vaut ~0 min et « 1 épisode ».
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-weekly-bulk-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'weekly-bulk.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let app: FastifyInstance;
let db: (typeof import('../db/client.js'))['prisma'];
const users: Record<string, { token: string; id: string }> = {};

// Médias de test.
let showAId = ''; // 5 épisodes S1, runtime 24 — cible du mark-all-watched
let showBId = ''; // 6 épisodes S1, runtime 24 — cible du watched-previous
let movieId = ''; // runtime 100
const showAEpisodes: string[] = [];
const showBEpisodes: string[] = [];

function acc(name: string) {
  const u = users[name];
  if (!u) throw new Error(`utilisateur inconnu: ${name}`);
  return u;
}
const bearer = (name: string) => ({ authorization: `Bearer ${acc(name).token}` });
const uid = (name: string) => acc(name).id;

async function register(name: string, email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName: name, email, password: 'secret123' },
  });
  expect(res.statusCode).toBe(200);
  users[name] = { token: res.json().token, id: res.json().user.id };
}

async function weeklyMinutes(viewer: string): Promise<Map<string, number>> {
  const res = await app.inject({ method: 'GET', url: '/api/social/challenge/weekly', headers: bearer(viewer) });
  expect(res.statusCode).toBe(200);
  const entries = res.json().entries as { userId: string; minutes: number }[];
  return new Map(entries.map((e) => [e.userId, e.minutes]));
}

async function overviewRecent(viewer: string) {
  const res = await app.inject({ method: 'GET', url: '/api/social/overview', headers: bearer(viewer) });
  expect(res.statusCode).toBe(200);
  return res.json().recent as {
    user: { id: string };
    media: { id: string; type: string };
    day: string;
    count: number;
    refId: string;
  }[];
}

async function createShow(title: string, episodeCount: number, sink: string[]): Promise<string> {
  const media = await db.media.create({
    data: {
      type: 'show',
      title,
      show: {
        create: {
          episodes: {
            create: Array.from({ length: episodeCount }, (_, i) => ({
              seasonNumber: 1,
              episodeNumber: i + 1,
              title: `Épisode ${i + 1}`,
              runtime: 24,
            })),
          },
        },
      },
    },
    include: { show: { include: { episodes: { orderBy: { episodeNumber: 'asc' } } } } },
  });
  for (const ep of media.show?.episodes ?? []) sink.push(ep.id);
  return media.id;
}

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
  const { buildApp } = await import('../app.js');
  app = await buildApp();
  ({ prisma: db } = await import('../db/client.js'));

  // Alice (observatrice) suit Bob, Carol et Dave (les acteurs).
  await register('Alice', 'alice@example.com');
  await register('Bob', 'bob@example.com');
  await register('Carol', 'carol@example.com');
  await register('Dave', 'dave@example.com');
  await db.follow.createMany({
    data: ['Bob', 'Carol', 'Dave'].map((n) => ({ followerId: uid('Alice'), followingId: uid(n) })),
  });

  showAId = await createShow('Bulk A', 5, showAEpisodes);
  showBId = await createShow('Bulk B', 6, showBEpisodes);
  expect(showAEpisodes).toHaveLength(5);
  expect(showBEpisodes).toHaveLength(6);
  movieId = (await db.media.create({ data: { type: 'movie', title: 'Long Métrage', runtime: 100 } })).id;
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('Défi hebdo — marquages en masse comptés en minutes réelles', () => {
  it('mark-all-watched d’une saison de 5 épisodes (runtime 24) → 120 min', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/shows/${showAId}/mark-all-watched`,
      payload: { seasonNumber: 1 },
      headers: bearer('Bob'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(5);
    // Un seul WatchEvent média-niveau a été créé (pas un par épisode) : c'est
    // précisément le scénario qui sous-comptait avant le correctif.
    expect(
      await db.watchEvent.count({ where: { userId: uid('Bob'), mediaId: showAId, eventType: 'watched' } }),
    ).toBe(1);

    const minutes = await weeklyMinutes('Alice');
    expect(minutes.get(uid('Bob'))).toBe(5 * 24);
  });

  it('watched-previous (5 épisodes précédents, runtime 24) → 120 min', async () => {
    const target = showBEpisodes[5]!; // S1E6 : les 5 précédents sont cochés, pas lui
    const res = await app.inject({
      method: 'POST',
      url: `/api/episodes/${target}/watched-previous`,
      headers: bearer('Carol'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(5);

    const minutes = await weeklyMinutes('Alice');
    expect(minutes.get(uid('Carol'))).toBe(5 * 24);
  });

  it('un film vu → weekly += runtime du film', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/movies/${movieId}/watched`,
      payload: {},
      headers: bearer('Dave'),
    });
    expect(res.statusCode).toBe(200);
    const minutes = await weeklyMinutes('Alice');
    expect(minutes.get(uid('Dave'))).toBe(100);
  });

  it('un épisode coché à l’unité reste correct (pas de double comptage statut + événement)', async () => {
    // Dave coche UN épisode via la route unitaire : elle crée un
    // UserEpisodeStatus ET un WatchEvent avec episodeId — seule la ligne de
    // statut doit compter (24 min, pas 48).
    const res = await app.inject({
      method: 'POST',
      url: `/api/episodes/${showBEpisodes[0]}/watched`,
      headers: bearer('Dave'),
    });
    expect(res.statusCode).toBe(200);
    const minutes = await weeklyMinutes('Alice');
    expect(minutes.get(uid('Dave'))).toBe(100 + 24);
    // Alice n'a rien regardé : 0 min, mais toujours présente au classement.
    expect(minutes.get(uid('Alice'))).toBe(0);
  });
});

describe('QG Communauté — « Récemment vus » compte les épisodes réels', () => {
  it('mark-all-watched → count = 5 pour le groupe (ami, série, jour), refId = événement média-niveau', async () => {
    const recent = await overviewRecent('Alice');
    const group = recent.find((r) => r.user.id === uid('Bob') && r.media.id === showAId);
    expect(group).toBeTruthy();
    expect(group?.count).toBe(5);
    // Le refId kudos reste le WatchEvent média-niveau du marquage en masse.
    const event = await db.watchEvent.findUnique({ where: { id: group!.refId } });
    expect(event).toMatchObject({ userId: uid('Bob'), mediaId: showAId, episodeId: null });
  });

  it('watched-previous → count = 5 ; épisode unitaire → count = 1 (pas de double comptage)', async () => {
    const recent = await overviewRecent('Alice');
    const carol = recent.find((r) => r.user.id === uid('Carol') && r.media.id === showBId);
    expect(carol?.count).toBe(5);
    // Dave a coché UN épisode de Bulk B : son groupe compte 1 (le statut),
    // pas 2 (statut + événement).
    const dave = recent.find((r) => r.user.id === uid('Dave') && r.media.id === showBId);
    expect(dave?.count).toBe(1);
    // Le film de Dave reste un groupe count = 1.
    const daveMovie = recent.find((r) => r.user.id === uid('Dave') && r.media.id === movieId);
    expect(daveMovie?.count).toBe(1);
  });
});

describe('Classement entre amis — segment Jeux (temps de jeu déclaratif)', () => {
  it('renvoie games trié par playtimeMinutes, jeux masqués exclus', async () => {
    const gameA = await db.media.create({ data: { type: 'game', title: 'Jeu Alpha' } });
    const gameB = await db.media.create({ data: { type: 'game', title: 'Jeu Bêta' } });
    // Bob : 300 min déclarées (en cours). Carol : 120 min mais jeu MASQUÉ → 0.
    await db.userMediaStatus.create({
      data: { userId: uid('Bob'), mediaId: gameA.id, status: 'playing', playtimeMinutes: 300 },
    });
    await db.userMediaStatus.create({
      data: { userId: uid('Carol'), mediaId: gameB.id, status: 'completed', playtimeMinutes: 120, isHidden: true },
    });
    const res = await app.inject({ method: 'GET', url: '/api/stats/leaderboard', headers: bearer('Alice') });
    expect(res.statusCode).toBe(200);
    const games = res.json().games as { userId: string; minutes: number; games: number }[];
    expect(Array.isArray(games)).toBe(true);
    const bob = games.find((g) => g.userId === uid('Bob'));
    const carol = games.find((g) => g.userId === uid('Carol'));
    expect(bob?.minutes).toBe(300);
    expect(bob?.games).toBe(1);
    expect(carol?.minutes).toBe(0);
    // Tri décroissant : Bob (300) devant tous les 0 min.
    expect(games[0]?.userId).toBe(uid('Bob'));
  });
});
