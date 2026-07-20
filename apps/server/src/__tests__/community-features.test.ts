import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-community-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'community.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let app: FastifyInstance;
let db: (typeof import('../db/client.js'))['prisma'];
const users: Record<string, { token: string; id: string }> = {};

// Médias de test.
let movieAId = ''; // runtime null → fallback 115 min
let movieBId = '';
let movieCId = '';
let showMediaId = '';
let episodeId = ''; // runtime 50 min

// État partagé entre tests (suite séquentielle, comme social.test.ts).
let bobWatchEventId = '';
let bobCommentId = '';
let clubId = '';

function acc(name: string) {
  const u = users[name];
  if (!u) throw new Error(`utilisateur inconnu: ${name}`);
  return u;
}
const bearer = (name: string) => ({ authorization: `Bearer ${acc(name).token}` });
const uid = (name: string) => acc(name).id;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  ({ prisma: db } = await import('../db/client.js'));

  await register('Alice', 'alice@example.com');
  await register('Bob', 'bob@example.com');
  await register('Carol', 'carol@example.com');
  await register('Dave', 'dave@example.com');

  const movieA = await db.media.create({ data: { type: 'movie', title: 'Inception', year: 2010 } });
  const movieB = await db.media.create({ data: { type: 'movie', title: 'Interstellar', year: 2014 } });
  const movieC = await db.media.create({ data: { type: 'movie', title: 'Tenet', year: 2020 } });
  movieAId = movieA.id;
  movieBId = movieB.id;
  movieCId = movieC.id;
  const showMedia = await db.media.create({
    data: {
      type: 'show',
      title: 'Dark',
      show: {
        create: { episodes: { create: { seasonNumber: 1, episodeNumber: 1, title: 'Pilote', runtime: 50 } } },
      },
    },
    include: { show: { include: { episodes: true } } },
  });
  showMediaId = showMedia.id;
  episodeId = showMedia.show?.episodes[0]?.id ?? '';
  expect(episodeId).toBeTruthy();

  // Alice suit Bob (le fil d'Alice montre l'activité de Bob).
  const f = await app.inject({ method: 'POST', url: `/api/social/follow/${uid('Bob')}`, headers: bearer('Alice') });
  expect(f.statusCode).toBe(200);
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('Feature 1 — réactions sur le fil', () => {
  it('toggle on : réagir à un visionnage du fil (deux emojis indépendants)', async () => {
    const event = await db.watchEvent.create({
      data: { userId: uid('Bob'), mediaId: movieAId, eventType: 'watched', eventDate: new Date(), source: 'manual' },
    });
    bobWatchEventId = event.id;

    const r1 = await app.inject({
      method: 'POST',
      url: '/api/social/feed/react',
      payload: { kind: 'watch', refId: bobWatchEventId, emoji: '🔥' },
      headers: bearer('Alice'),
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toEqual({ reacted: true, count: 1 });

    const r2 = await app.inject({
      method: 'POST',
      url: '/api/social/feed/react',
      payload: { kind: 'watch', refId: bobWatchEventId, emoji: '👍' },
      headers: bearer('Alice'),
    });
    expect(r2.json()).toEqual({ reacted: true, count: 2 });
  });

  it('le fil expose reactions { total, mine, counts } sur chaque item', async () => {
    const feed = await app.inject({ method: 'GET', url: '/api/social/feed', headers: bearer('Alice') });
    const items = feed.json().items as { id: string; reactions: { total: number; mine: string[]; counts: Record<string, number> } }[];
    expect(items.length).toBeGreaterThanOrEqual(1);
    // Tous les items portent le champ reactions (même sans réaction).
    expect(items.every((i) => i.reactions && Array.isArray(i.reactions.mine))).toBe(true);
    const item = items.find((i) => i.id === bobWatchEventId);
    expect(item).toBeTruthy();
    expect(item?.reactions.total).toBe(2);
    expect(item?.reactions.counts).toEqual({ '🔥': 1, '👍': 1 });
    expect(item?.reactions.mine).toEqual(expect.arrayContaining(['🔥', '👍']));
  });

  it('toggle off : re-poster le même emoji le retire', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/social/feed/react',
      payload: { kind: 'watch', refId: bobWatchEventId, emoji: '🔥' },
      headers: bearer('Alice'),
    });
    expect(res.json()).toEqual({ reacted: false, count: 1 });
  });

  it('404 si la cible du kind n’existe pas', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/social/feed/react',
      payload: { kind: 'badge', refId: 'inexistant', emoji: '🎉' },
      headers: bearer('Alice'),
    });
    expect(res.statusCode).toBe(404);
  });

  it('réaction sur un commentaire du fil (kind comment)', async () => {
    const c = await app.inject({
      method: 'POST',
      url: `/api/media/${movieAId}/comments`,
      payload: { body: 'Quel film !' },
      headers: bearer('Bob'),
    });
    expect(c.statusCode).toBe(200);
    bobCommentId = c.json().id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/social/feed/react',
      payload: { kind: 'comment', refId: bobCommentId, emoji: '❤️' },
      headers: bearer('Alice'),
    });
    expect(res.json()).toEqual({ reacted: true, count: 1 });

    const feed = await app.inject({ method: 'GET', url: '/api/social/feed', headers: bearer('Alice') });
    const item = (feed.json().items as { kind: string; id: string; reactions: { total: number } }[]).find(
      (i) => i.kind === 'comment' && i.id === bobCommentId,
    );
    expect(item?.reactions.total).toBe(1);
  });
});

describe('Feature 4 — streaks visibles', () => {
  it('le fil expose user.streak (et user.level)', async () => {
    // Laisse passer les recomputes gamification différés (750 ms) avant de
    // poser des valeurs connues, sinon ils écraseraient le UserProgress posé.
    await sleep(1000);
    await db.userProgress.upsert({
      where: { userId: uid('Bob') },
      create: { userId: uid('Bob'), xp: 5000, level: 5, currentStreak: 7, bestStreak: 9 },
      update: { level: 5, currentStreak: 7, bestStreak: 9 },
    });
    const feed = await app.inject({ method: 'GET', url: '/api/social/feed', headers: bearer('Alice') });
    const item = (feed.json().items as { id: string; user: { id: string; streak: number; level: number } }[]).find(
      (i) => i.id === bobWatchEventId,
    );
    expect(item?.user.streak).toBe(7);
    expect(item?.user.level).toBe(5);
  });

  it('following et followers exposent streak + level en batch', async () => {
    const following = await app.inject({ method: 'GET', url: '/api/social/following', headers: bearer('Alice') });
    const bob = (following.json().users as { id: string; streak: number; level: number }[]).find(
      (u) => u.id === uid('Bob'),
    );
    expect(bob?.streak).toBe(7);
    expect(bob?.level).toBe(5);

    const followers = await app.inject({ method: 'GET', url: '/api/social/followers', headers: bearer('Bob') });
    const alice = (followers.json().users as { id: string; streak: number; level: number }[]).find(
      (u) => u.id === uid('Alice'),
    );
    // Défauts (0 / 1) même sans UserProgress à valeur particulière.
    expect(typeof alice?.streak).toBe('number');
    expect(alice?.level).toBeGreaterThanOrEqual(1);
  });
});

describe('Feature 2 — « Tes amis ont adoré »', () => {
  it('remonte les médias notés ≥ 8 par mes abonnements (Rating et note de statut)', async () => {
    // Bob note movieB 9 (table Rating) et la série 9 via UserMediaStatus.
    await db.rating.create({ data: { userId: uid('Bob'), mediaId: movieBId, value: 9 } });
    await db.userMediaStatus.create({
      data: { userId: uid('Bob'), mediaId: showMediaId, status: 'watching', rating: 9 },
    });

    const res = await app.inject({ method: 'GET', url: '/api/social/recommendations', headers: bearer('Alice') });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as {
      media: { id: string; title: string; type: string };
      fans: { userId: string; displayName: string }[];
      avgRating: number;
      fanCount: number;
    }[];
    const ids = items.map((i) => i.media.id);
    expect(ids).toContain(movieBId);
    expect(ids).toContain(showMediaId);
    const movieItem = items.find((i) => i.media.id === movieBId);
    expect(movieItem?.avgRating).toBe(9);
    expect(movieItem?.fanCount).toBe(1);
    expect(movieItem?.fans).toEqual([
      expect.objectContaining({ userId: uid('Bob'), displayName: 'Bob' }),
    ]);
    expect(movieItem?.media.title).toBe('Interstellar');
  });

  it('exclut les médias déjà dans ma bibliothèque et les notes < 8', async () => {
    // movieA est dans la bibliothèque d'Alice → exclu même si Bob l'adore.
    await db.userMediaStatus.create({ data: { userId: uid('Alice'), mediaId: movieAId, status: 'completed' } });
    await db.rating.create({ data: { userId: uid('Bob'), mediaId: movieAId, value: 10 } });
    // movieC noté 5 par Bob → sous le seuil.
    await db.rating.create({ data: { userId: uid('Bob'), mediaId: movieCId, value: 5 } });

    const res = await app.inject({ method: 'GET', url: '/api/social/recommendations', headers: bearer('Alice') });
    const ids = (res.json().items as { media: { id: string } }[]).map((i) => i.media.id);
    expect(ids).not.toContain(movieAId);
    expect(ids).not.toContain(movieCId);
  });

  it('exclut les utilisateurs bloqués', async () => {
    // Alice suit Dave qui adore movieC ; movieC apparaît…
    await db.follow.create({ data: { followerId: uid('Alice'), followingId: uid('Dave') } });
    await db.rating.create({ data: { userId: uid('Dave'), mediaId: movieCId, value: 10 } });
    let res = await app.inject({ method: 'GET', url: '/api/social/recommendations', headers: bearer('Alice') });
    expect((res.json().items as { media: { id: string } }[]).map((i) => i.media.id)).toContain(movieCId);

    // …puis Alice bloque Dave : même si un follow subsiste, movieC disparaît.
    const block = await app.inject({ method: 'POST', url: `/api/users/${uid('Dave')}/block`, headers: bearer('Alice') });
    expect(block.statusCode).toBe(200);
    await db.follow.create({ data: { followerId: uid('Alice'), followingId: uid('Dave') } });
    res = await app.inject({ method: 'GET', url: '/api/social/recommendations', headers: bearer('Alice') });
    expect((res.json().items as { media: { id: string } }[]).map((i) => i.media.id)).not.toContain(movieCId);
  });
});

describe('Feature 3 — défi hebdo', () => {
  it('minutes depuis lundi 00:00 Europe/Paris, tri décroissant, zéros inclus', async () => {
    // Le test précédent a laissé Dave BLOQUÉ par Alice — or le défi hebdo
    // exclut désormais les comptes bloqués (cf. audit-social-fixes.test.ts).
    // On lève le blocage pour retrouver le scénario nominal (Dave suivi, 0 min).
    await db.block.deleteMany({ where: { blockerId: uid('Alice') } });
    // Alice regarde l'épisode (runtime 50) cette semaine. Le défi hebdo se
    // base sur les STATUTS (UserEpisodeStatus/UserMediaStatus), pas sur les
    // WatchEvents (sous-comptage des marquages en masse) : on pose le statut,
    // comme le ferait POST /api/episodes/:id/watched.
    await db.userEpisodeStatus.create({
      data: { userId: uid('Alice'), episodeId, status: 'watched', watchedAt: new Date() },
    });
    // Bob a vu movieA (runtime null → fallback 115) cette semaine : statut
    // completed avec completedAt, comme le pose POST /api/movies/:id/watched.
    await db.userMediaStatus.create({
      data: { userId: uid('Bob'), mediaId: movieAId, status: 'completed', completedAt: new Date() },
    });
    // Bob a aussi un vieux visionnage (il y a 8 jours) : hors semaine, non compté.
    await db.userMediaStatus.create({
      data: { userId: uid('Bob'), mediaId: movieBId, status: 'completed', completedAt: new Date(Date.now() - 8 * 86_400_000) },
    });

    const res = await app.inject({ method: 'GET', url: '/api/social/challenge/weekly', headers: bearer('Alice') });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      weekStart: string;
      entries: { userId: string; displayName: string; minutes: number; isMe: boolean }[];
    };

    // weekStart : un lundi à minuit heure de Paris, dans les 7 derniers jours.
    const weekStart = new Date(body.weekStart);
    expect(Number.isNaN(weekStart.getTime())).toBe(false);
    expect(Date.now() - weekStart.getTime()).toBeLessThan(7 * 86_400_000 + 1);
    expect(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short' }).format(weekStart)).toBe('Mon');
    expect(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false }).format(weekStart),
    ).toMatch(/^(00|24):00$/);

    const alice = body.entries.find((e) => e.userId === uid('Alice'));
    const bob = body.entries.find((e) => e.userId === uid('Bob'));
    const dave = body.entries.find((e) => e.userId === uid('Dave'));
    // Alice : 50 min (runtime épisode). Bob : 115 min (film sans runtime →
    // fallback), le vieux visionnage étant exclu. Dave : 0 mais présent.
    expect(alice).toMatchObject({ minutes: 50, isMe: true });
    expect(bob).toMatchObject({ minutes: 115, isMe: false });
    expect(dave).toMatchObject({ minutes: 0 });
    // Tri par minutes décroissantes.
    const minutes = body.entries.map((e) => e.minutes);
    expect(minutes).toEqual([...minutes].sort((a, b) => b - a));
  });
});

describe('Feature 5 — clubs par série', () => {
  it('POST /api/clubs crée le club du média et m’y ajoute (idempotent)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/clubs',
      payload: { mediaId: showMediaId },
      headers: bearer('Bob'),
    });
    expect(res.statusCode).toBe(200);
    const club = res.json();
    clubId = club.id;
    expect(club).toMatchObject({
      isMember: true,
      memberCount: 1,
      media: { id: showMediaId, title: 'Dark', type: 'show' },
    });
    expect(Array.isArray(club.friendMembers)).toBe(true);

    // Idempotent : même club, toujours 1 seul membre.
    const again = await app.inject({
      method: 'POST',
      url: '/api/clubs',
      payload: { mediaId: showMediaId },
      headers: bearer('Bob'),
    });
    expect(again.json().id).toBe(clubId);
    expect(again.json().memberCount).toBe(1);
  });

  it('POST /api/clubs sur un média inconnu → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/clubs',
      payload: { mediaId: 'inexistant' },
      headers: bearer('Bob'),
    });
    expect(res.statusCode).toBe(404);
  });

  it('join / leave mettent à jour memberCount (et 404 sur club inconnu)', async () => {
    const join = await app.inject({ method: 'POST', url: `/api/clubs/${clubId}/join`, headers: bearer('Carol') });
    expect(join.json()).toEqual({ ok: true, memberCount: 2 });

    const leave = await app.inject({ method: 'POST', url: `/api/clubs/${clubId}/leave`, headers: bearer('Carol') });
    expect(leave.json()).toEqual({ ok: true, memberCount: 1 });

    const missing = await app.inject({ method: 'POST', url: '/api/clubs/inexistant/join', headers: bearer('Carol') });
    expect(missing.statusCode).toBe(404);
  });

  it('GET /api/clubs : suggéré quand un abonnement en est membre, avec friendMembers', async () => {
    // Alice suit Bob (membre) et n'est pas membre → club suggéré.
    const res = await app.inject({ method: 'GET', url: '/api/clubs', headers: bearer('Alice') });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      mine: { id: string }[];
      suggested: { id: string; isMember: boolean; memberCount: number; friendMembers: { userId: string }[] }[];
    };
    expect(body.mine).toHaveLength(0);
    const suggestion = body.suggested.find((c) => c.id === clubId);
    expect(suggestion).toBeTruthy();
    expect(suggestion?.isMember).toBe(false);
    expect(suggestion?.memberCount).toBe(1);
    expect(suggestion?.friendMembers.map((m) => m.userId)).toContain(uid('Bob'));
  });

  it('GET /api/clubs : mine pour un membre, suggéré via la bibliothèque', async () => {
    // Bob (membre) : le club est dans `mine`.
    const asBob = await app.inject({ method: 'GET', url: '/api/clubs', headers: bearer('Bob') });
    const mine = asBob.json().mine as { id: string; isMember: boolean }[];
    expect(mine.map((c) => c.id)).toContain(clubId);
    expect(mine.find((c) => c.id === clubId)?.isMember).toBe(true);

    // Carol (a quitté, ne suit personne) : la série entre dans sa bibliothèque
    // → le club redevient suggéré via le chemin « média dans ma bibliothèque ».
    await db.userMediaStatus.create({ data: { userId: uid('Carol'), mediaId: showMediaId, status: 'watching' } });
    const asCarol = await app.inject({ method: 'GET', url: '/api/clubs', headers: bearer('Carol') });
    const suggested = asCarol.json().suggested as { id: string; friendMembers: unknown[] }[];
    expect(suggested.map((c) => c.id)).toContain(clubId);
    expect(suggested.find((c) => c.id === clubId)?.friendMembers).toEqual([]);
  });
});
