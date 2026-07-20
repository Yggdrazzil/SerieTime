import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-overview-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'overview.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let app: FastifyInstance;
let db: (typeof import('../db/client.js'))['prisma'];
let dayKeyParis: (d: Date) => string;
let parisMidnightUtc: (k: string) => Date;
const users: Record<string, { token: string; id: string }> = {};

// Médias de test.
let showMediaId = '';
let movieAId = '';
let movieBId = '';
const episodeIds: string[] = []; // S1E1..S1E3

// Repère temporel STABLE : midi (heure de Paris) du jour courant — évite
// qu'un test lancé à minuit ne fasse chevaucher deux jours parisiens.
let todayNoon: Date;
let todayKey = '';

// État partagé (suite séquentielle, comme community-features.test.ts).
let bobLatestEventId = ''; // S1E3 — refId du groupe « Récemment vus » de Bob
let carolMovieEventId = '';
let bobBadgeId = '';

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

async function overview(name: string) {
  const res = await app.inject({ method: 'GET', url: '/api/social/overview', headers: bearer(name) });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    now: {
      user: { id: string; displayName: string; avatarUrl: string | null; level: number; streak: number };
      media: { id: string; title: string; posterPath: string | null; type: string };
      episode: { seasonNumber: number; episodeNumber: number } | null;
      lastAt: string;
    }[];
    recent: {
      user: { id: string };
      media: { id: string; title: string; type: string };
      day: string;
      count: number;
      refId: string;
      reactions: { total: number; mine: string[] };
    }[];
    badges: {
      user: { id: string };
      badge: { id: string; label: string; tier: number };
      unlockedAt: string;
      refId: string;
      reactions: { total: number; mine: string[] };
    }[];
  };
}

const reactionNotifs = (userId: string) =>
  db.notification.findMany({ where: { userId, type: 'reaction' }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
  const { buildApp } = await import('../app.js');
  app = await buildApp();
  ({ prisma: db } = await import('../db/client.js'));
  ({ dayKeyParis, parisMidnightUtc } = await import('../lib/parisTime.js'));
  todayKey = dayKeyParis(new Date());
  todayNoon = new Date(parisMidnightUtc(todayKey).getTime() + 12 * 3_600_000);

  // Alice (observatrice) — amis : Bob, Carol, Dave (sans activité).
  // Eve : suivie MAIS bloquée par Alice (le follow subsiste volontairement).
  // Frank : non suivi.
  await register('Alice', 'alice@example.com');
  await register('Bob', 'bob@example.com');
  await register('Carol', 'carol@example.com');
  await register('Dave', 'dave@example.com');
  await register('Eve', 'eve@example.com');
  await register('Frank', 'frank@example.com');
  await db.follow.createMany({
    data: ['Bob', 'Carol', 'Dave', 'Eve'].map((n) => ({ followerId: uid('Alice'), followingId: uid(n) })),
  });
  await db.block.create({ data: { blockerId: uid('Alice'), blockedId: uid('Eve') } });

  const showMedia = await db.media.create({
    data: {
      type: 'show',
      title: 'Dark',
      show: {
        create: {
          episodes: {
            create: [1, 2, 3].map((n) => ({ seasonNumber: 1, episodeNumber: n, title: `Épisode ${n}`, runtime: 50 })),
          },
        },
      },
    },
    include: { show: { include: { episodes: { orderBy: { episodeNumber: 'asc' } } } } },
  });
  showMediaId = showMedia.id;
  for (const ep of showMedia.show?.episodes ?? []) episodeIds.push(ep.id);
  expect(episodeIds).toHaveLength(3);
  movieAId = (await db.media.create({ data: { type: 'movie', title: 'Inception', year: 2010 } })).id;
  movieBId = (await db.media.create({ data: { type: 'movie', title: 'Interstellar', year: 2014 } })).id;

  const watch = (userId: string, mediaId: string, eventDate: Date, episodeId?: string) =>
    db.watchEvent.create({
      data: { userId, mediaId, episodeId, eventType: 'watched', eventDate, source: 'manual' },
    });

  // Bob : 3 épisodes de Dark AUJOURD'HUI (même jour Paris) + un vieux film
  // il y a 2 jours (autre groupe). Son dernier événement = S1E3.
  await watch(uid('Bob'), showMediaId, new Date(todayNoon.getTime() - 120_000), episodeIds[0]);
  await watch(uid('Bob'), showMediaId, new Date(todayNoon.getTime() - 60_000), episodeIds[1]);
  bobLatestEventId = (await watch(uid('Bob'), showMediaId, todayNoon, episodeIds[2])).id;
  await watch(uid('Bob'), movieAId, new Date(todayNoon.getTime() - 2 * 86_400_000));
  // Carol : un film il y a 1 h (avant le dernier événement de Bob).
  carolMovieEventId = (await watch(uid('Carol'), movieBId, new Date(todayNoon.getTime() - 3_600_000))).id;
  // Eve (bloquée) et Frank (non suivi) : de l'activité qui ne doit JAMAIS
  // apparaître chez Alice. Dave : aucune activité.
  await watch(uid('Eve'), movieAId, todayNoon);
  await watch(uid('Frank'), movieBId, todayNoon);
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('GET /api/social/overview — « En ce moment »', () => {
  it('1 entrée par ami actif (son DERNIER visionnage), amis sans activité exclus, tri lastAt desc', async () => {
    const body = await overview('Alice');
    const byUser = body.now.map((n) => n.user.id);
    // Une seule entrée par ami, malgré les 4 événements de Bob.
    expect(byUser.filter((id) => id === uid('Bob'))).toHaveLength(1);
    expect(byUser).toContain(uid('Carol'));
    expect(byUser).not.toContain(uid('Dave')); // aucun visionnage
    expect(byUser).not.toContain(uid('Eve')); // bloquée
    expect(byUser).not.toContain(uid('Frank')); // non suivi

    // L'entrée de Bob est son événement LE PLUS RÉCENT : Dark S1E3.
    const bob = body.now.find((n) => n.user.id === uid('Bob'));
    expect(bob?.media).toMatchObject({ id: showMediaId, title: 'Dark', type: 'show' });
    expect(bob?.episode).toEqual({ seasonNumber: 1, episodeNumber: 3 });
    expect(typeof bob?.user.level).toBe('number');
    expect(typeof bob?.user.streak).toBe('number');
    // Carol : un film → episode null.
    const carol = body.now.find((n) => n.user.id === uid('Carol'));
    expect(carol?.media.id).toBe(movieBId);
    expect(carol?.episode).toBeNull();
    // Tri lastAt décroissant (Bob à midi, Carol à 11 h).
    const dates = body.now.map((n) => n.lastAt);
    expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));
  });
});

describe('GET /api/social/overview — « Récemment vus » agrégé', () => {
  it('3 épisodes de la même série le même jour → 1 groupe count 3, refId = événement le plus récent', async () => {
    const body = await overview('Alice');
    const bobDark = body.recent.filter((r) => r.user.id === uid('Bob') && r.media.id === showMediaId);
    expect(bobDark).toHaveLength(1);
    expect(bobDark[0]).toMatchObject({ day: todayKey, count: 3, refId: bobLatestEventId });
    // Le film de Bob (autre média, autre jour) est un groupe séparé, count 1.
    const bobMovie = body.recent.find((r) => r.user.id === uid('Bob') && r.media.id === movieAId);
    expect(bobMovie?.count).toBe(1);
    // Tri lastAt desc : le groupe Dark (midi) précède le groupe film (il y a 2 jours).
    expect(body.recent.indexOf(bobDark[0]!)).toBeLessThan(body.recent.indexOf(bobMovie!));
  });

  it('exclut les non-suivis et les bloqués (même avec un follow résiduel)', async () => {
    const body = await overview('Alice');
    const userIds = body.recent.map((r) => r.user.id);
    expect(userIds).not.toContain(uid('Eve')); // bloquée mais toujours suivie
    expect(userIds).not.toContain(uid('Frank')); // non suivi
    expect(userIds).toContain(uid('Carol'));
  });
});

describe('GET /api/social/overview — « Derniers badges »', () => {
  it('badges des amis sur 14 jours, avec réactions { total, mine }, refId = UserBadge.id', async () => {
    bobBadgeId = (await db.userBadge.create({ data: { userId: uid('Bob'), badgeId: 'marathon', tier: 2 } })).id;
    // Vieux badge (20 jours) : hors fenêtre.
    const old = await db.userBadge.create({
      data: {
        userId: uid('Carol'),
        badgeId: 'critic',
        tier: 1,
        unlockedAt: new Date(Date.now() - 20 * 86_400_000),
      },
    });
    // Alice pose un kudos 🎉 sur le badge de Bob.
    const react = await app.inject({
      method: 'POST',
      url: '/api/social/feed/react',
      payload: { kind: 'badge', refId: bobBadgeId, emoji: '🎉' },
      headers: bearer('Alice'),
    });
    expect(react.statusCode).toBe(200);
    expect(react.json()).toEqual({ reacted: true, count: 1 });

    const body = await overview('Alice');
    const entry = body.badges.find((b) => b.refId === bobBadgeId);
    expect(entry).toBeTruthy();
    expect(entry?.user.id).toBe(uid('Bob'));
    expect(entry?.badge).toMatchObject({ id: 'marathon', tier: 2 });
    expect(typeof entry?.badge.label).toBe('string');
    expect(entry?.reactions).toEqual({ total: 1, mine: ['🎉'] });
    expect(body.badges.map((b) => b.refId)).not.toContain(old.id);
  });
});

describe('GET /api/social/discussions — fils où mes amis sont actifs', () => {
  it('groupe par média avec commentCount et participants amis, sans texte ni épisode (anti-spoiler)', async () => {
    const c1 = await app.inject({
      method: 'POST',
      url: `/api/media/${movieAId}/comments`,
      payload: { body: 'Le twist final, incroyable — spoiler !' },
      headers: bearer('Bob'),
    });
    expect(c1.statusCode).toBe(200);
    const c2 = await app.inject({
      method: 'POST',
      url: `/api/media/${movieAId}/comments`,
      payload: { body: 'Complètement d’accord', parentId: c1.json().id },
      headers: bearer('Carol'),
    });
    expect(c2.statusCode).toBe(200);
    // Frank (non suivi) commente un autre film : son fil ne doit pas remonter.
    await db.comment.create({ data: { userId: uid('Frank'), mediaId: movieBId, body: 'hors cercle' } });

    const res = await app.inject({ method: 'GET', url: '/api/social/discussions', headers: bearer('Alice') });
    expect(res.statusCode).toBe(200);
    const threads = res.json().threads as {
      media: { id: string; title: string; type: string };
      commentCount: number;
      participants: { id: string; displayName: string }[];
      lastAt: string;
    }[];
    expect(threads.map((t) => t.media.id)).toEqual([movieAId]); // movieB : ami inactif
    const thread = threads[0]!;
    expect(thread.commentCount).toBe(2); // racine de Bob + réponse de Carol
    expect(thread.participants.map((p) => p.id).sort()).toEqual([uid('Bob'), uid('Carol')].sort());
    expect(thread.participants.length).toBeLessThanOrEqual(3);
    // Anti-spoiler : aucun texte de commentaire, aucun numéro d'épisode.
    expect(JSON.stringify(threads)).not.toContain('twist');
    expect(thread).not.toHaveProperty('body');
    expect(thread).not.toHaveProperty('episode');
  });
});

describe('POST /api/social/feed/react — notifications kudos', () => {
  it('création d’un kudos → notification « a salué ton activité » pour le propriétaire', async () => {
    const before = (await reactionNotifs(uid('Bob'))).length;
    const res = await app.inject({
      method: 'POST',
      url: '/api/social/feed/react',
      payload: { kind: 'watch', refId: bobLatestEventId, emoji: '🔥' },
      headers: bearer('Alice'),
    });
    expect(res.json()).toEqual({ reacted: true, count: 1 });
    const notifs = await reactionNotifs(uid('Bob'));
    expect(notifs.length).toBe(before + 1);
    const last = notifs.at(-1)!;
    expect(last.title).toBe('Alice a salué ton activité');
    expect(JSON.parse(last.metadataJson ?? '{}')).toMatchObject({ actorId: uid('Alice'), mediaId: showMediaId });
    // Le kudos badge du test précédent a lui aussi notifié, avec le bon libellé.
    const badgeNotif = notifs.find((n) => n.title.includes('badge'));
    expect(badgeNotif?.title).toBe('Alice a salué ton badge');
  });

  it('retrait du kudos (toggle off) → AUCUNE nouvelle notification', async () => {
    const before = (await reactionNotifs(uid('Bob'))).length;
    const res = await app.inject({
      method: 'POST',
      url: '/api/social/feed/react',
      payload: { kind: 'watch', refId: bobLatestEventId, emoji: '🔥' },
      headers: bearer('Alice'),
    });
    expect(res.json()).toEqual({ reacted: false, count: 0 });
    expect((await reactionNotifs(uid('Bob'))).length).toBe(before);
  });

  it('le destinataire qui a BLOQUÉ l’acteur n’est pas notifié (filtre notifyUser)', async () => {
    // Carol bloque Alice ; Alice (qui suit toujours Carol) pose un kudos.
    await db.block.create({ data: { blockerId: uid('Carol'), blockedId: uid('Alice') } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/social/feed/react',
      payload: { kind: 'watch', refId: carolMovieEventId, emoji: '👏' },
      headers: bearer('Alice'),
    });
    expect(res.json()).toEqual({ reacted: true, count: 1 });
    expect(await reactionNotifs(uid('Carol'))).toHaveLength(0);
  });

  it('réagir à sa PROPRE activité ne crée pas de notification', async () => {
    const myEvent = await db.watchEvent.create({
      data: { userId: uid('Alice'), mediaId: movieAId, eventType: 'watched', eventDate: new Date(), source: 'manual' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/social/feed/react',
      payload: { kind: 'watch', refId: myEvent.id, emoji: '😎' },
      headers: bearer('Alice'),
    });
    expect(res.json()).toEqual({ reacted: true, count: 1 });
    expect(await reactionNotifs(uid('Alice'))).toHaveLength(0);
  });
});
