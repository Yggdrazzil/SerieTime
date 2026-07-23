import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { BADGES } from '@serietime/core';

// Lot de correctifs d'audit social/serveur : toggle de réaction idempotent,
// store unique des likes de commentaires, contrôle d'accès feed/react,
// blocklist (défi hebdo, notifications), fils de commentaires (racine
// uniquement), épisode rattaché au média, purge des ActivityReaction,
// profil public sans rescanner la bibliothèque, OAuth fail closed.
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-audit-social-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'audit-social.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';
// OAuth fail closed : AUCUN identifiant Discord/Facebook/Google posé ici —
// le test vérifie que le provider non configuré est refusé (400).
delete process.env.DISCORD_CLIENT_ID;
delete process.env.FACEBOOK_APP_ID;
delete process.env.FACEBOOK_APP_SECRET;
delete process.env.GOOGLE_CLIENT_IDS;

let app: FastifyInstance;
let db: (typeof import('../db/client.js'))['prisma'];
const users: Record<string, { token: string; id: string }> = {};

let movieId = ''; // runtime null
let showMediaId = '';
let episodeId = ''; // runtime 50, appartient à showMediaId
let bobWatchEventId = '';
let bobRootCommentId = '';
let aliceReplyId = '';

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

  const movie = await db.media.create({ data: { type: 'movie', title: 'Inception', year: 2010 } });
  movieId = movie.id;
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

  // Alice suit Bob et Dave (fil + défi hebdo).
  for (const target of ['Bob', 'Dave']) {
    const f = await app.inject({ method: 'POST', url: `/api/social/follow/${uid(target)}`, headers: bearer('Alice') });
    expect(f.statusCode).toBe(200);
  }

  const event = await db.watchEvent.create({
    data: { userId: uid('Bob'), mediaId: movieId, eventType: 'watched', eventDate: new Date(), source: 'manual' },
  });
  bobWatchEventId = event.id;
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('Commentaires — parentId racine uniquement, épisode rattaché au média', () => {
  it('commentaire racine + réponse à une racine : OK', async () => {
    const root = await app.inject({
      method: 'POST',
      url: `/api/media/${movieId}/comments`,
      payload: { body: 'Chef-d’œuvre !' },
      headers: bearer('Bob'),
    });
    expect(root.statusCode).toBe(200);
    bobRootCommentId = root.json().id;

    const reply = await app.inject({
      method: 'POST',
      url: `/api/media/${movieId}/comments`,
      payload: { body: 'Complètement d’accord', parentId: bobRootCommentId },
      headers: bearer('Alice'),
    });
    expect(reply.statusCode).toBe(200);
    aliceReplyId = reply.json().id;
  });

  it('rejette (400) une réponse à une RÉPONSE (parentId non racine)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/media/${movieId}/comments`,
      payload: { body: 'Réponse de réponse', parentId: aliceReplyId },
      headers: bearer('Bob'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('parent_not_root');
  });

  it('rejette (400) un episodeId qui n’appartient pas au média', async () => {
    // L'épisode appartient à la série Dark, pas au film Inception.
    const res = await app.inject({
      method: 'POST',
      url: `/api/media/${movieId}/comments`,
      payload: { body: 'Épisode volé', episodeId },
      headers: bearer('Alice'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('episode_not_in_media');

    // Sur le BON média, le même episodeId passe — après avoir marqué l'épisode
    // vu (garde anti-spoiler : commenter un épisode exige de l'avoir vu).
    const watch = await app.inject({ method: 'POST', url: `/api/episodes/${episodeId}/watched`, headers: bearer('Alice') });
    expect(watch.statusCode).toBe(200);
    const ok = await app.inject({
      method: 'POST',
      url: `/api/media/${showMediaId}/comments`,
      payload: { body: 'Quel pilote !', episodeId },
      headers: bearer('Alice'),
    });
    expect(ok.statusCode).toBe(200);
  });

  it('le fil ne publie QUE les commentaires racines (jamais les réponses)', async () => {
    const feed = await app.inject({ method: 'GET', url: '/api/social/feed', headers: bearer('Carol') });
    expect(feed.statusCode).toBe(200);
    // Carol ne suit personne : fil vide — on regarde le fil d'Alice… qui suit
    // Bob. La réponse d'ALICE n'y serait de toute façon pas (pas d'auto-suivi),
    // donc on vérifie via Bob : Bob répond à sa propre racine, puis on lit le
    // fil d'Alice (qui suit Bob) — la réponse ne doit pas apparaître.
    const selfReply = await app.inject({
      method: 'POST',
      url: `/api/media/${movieId}/comments`,
      payload: { body: 'Je me réponds', parentId: bobRootCommentId },
      headers: bearer('Bob'),
    });
    expect(selfReply.statusCode).toBe(200);
    const selfReplyId = selfReply.json().id as string;

    const aliceFeed = await app.inject({ method: 'GET', url: '/api/social/feed', headers: bearer('Alice') });
    const commentIds = (aliceFeed.json().items as { kind: string; id: string }[])
      .filter((i) => i.kind === 'comment')
      .map((i) => i.id);
    expect(commentIds).toContain(bobRootCommentId);
    expect(commentIds).not.toContain(selfReplyId);
  });
});

describe('Réactions — toggle idempotent, store unique, contrôle d’accès', () => {
  it('deux réactions concurrentes identiques : jamais de 500 (P2002 toléré)', async () => {
    const post = () =>
      app.inject({
        method: 'POST',
        url: '/api/social/feed/react',
        payload: { kind: 'watch', refId: bobWatchEventId, emoji: '🔥' },
        headers: bearer('Alice'),
      });
    const [r1, r2] = await Promise.all([post(), post()]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    // Résultat net d'un double toggle : zéro réaction 🔥 d'Alice.
    const remaining = await db.activityReaction.count({
      where: { kind: 'watch', refId: bobWatchEventId, userId: uid('Alice'), emoji: '🔥' },
    });
    expect(remaining).toBe(0);
  });

  it('idem sur /api/comments/:id/react (double-tap concurrent)', async () => {
    const post = () =>
      app.inject({
        method: 'POST',
        url: `/api/comments/${bobRootCommentId}/react`,
        payload: { emoji: '👏' },
        headers: bearer('Alice'),
      });
    const [r1, r2] = await Promise.all([post(), post()]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
  });

  it('like de commentaire depuis le FEED → visible dans GET /api/media/:id/comments', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/social/feed/react',
      payload: { kind: 'comment', refId: bobRootCommentId, emoji: '❤️' },
      headers: bearer('Alice'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reacted).toBe(true);

    // Le like vit dans CommentReaction : l'écran commentaires le voit.
    const comments = await app.inject({ method: 'GET', url: `/api/media/${movieId}/comments`, headers: bearer('Alice') });
    const root = (comments.json().comments as { id: string; reactions: { total: number; mine: string[] } }[]).find(
      (c) => c.id === bobRootCommentId,
    );
    expect(root).toBeTruthy();
    expect(root?.reactions.total).toBeGreaterThanOrEqual(1);
    expect(root?.reactions.mine).toContain('❤️');

    // …et le feed l'agrège aussi.
    const feed = await app.inject({ method: 'GET', url: '/api/social/feed', headers: bearer('Alice') });
    const item = (feed.json().items as { kind: string; id: string; reactions: { mine: string[] } }[]).find(
      (i) => i.kind === 'comment' && i.id === bobRootCommentId,
    );
    expect(item?.reactions.mine).toContain('❤️');
  });

  it('réagir à l’item d’un compte NON suivi → 404 uniforme (anti-oracle)', async () => {
    // Carol ne suit pas Bob : même réponse que pour un id inexistant.
    const res = await app.inject({
      method: 'POST',
      url: '/api/social/feed/react',
      payload: { kind: 'watch', refId: bobWatchEventId, emoji: '🔥' },
      headers: bearer('Carol'),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });

  it('réagir à son PROPRE item reste permis', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/social/feed/react',
      payload: { kind: 'watch', refId: bobWatchEventId, emoji: '🎉' },
      headers: bearer('Bob'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reacted).toBe(true);
  });
});

describe('Suppression de commentaire — purge des ActivityReaction orphelines', () => {
  it('DELETE /api/comments/:id supprime les ActivityReaction du commentaire ET de ses réponses', async () => {
    // Réactions legacy posées directement dans ActivityReaction (ancien store).
    await db.activityReaction.createMany({
      data: [
        { kind: 'comment', refId: bobRootCommentId, userId: uid('Alice'), emoji: '💾' },
        { kind: 'comment', refId: aliceReplyId, userId: uid('Bob'), emoji: '💾' },
      ],
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/comments/${bobRootCommentId}`,
      headers: bearer('Bob'),
    });
    expect(del.statusCode).toBe(200);
    const orphans = await db.activityReaction.count({
      where: { kind: 'comment', refId: { in: [bobRootCommentId, aliceReplyId] } },
    });
    expect(orphans).toBe(0);
    // La réponse est bien partie en cascade.
    expect(await db.comment.count({ where: { id: aliceReplyId } })).toBe(0);
  });
});

describe('Profil public — gamification persistée (sans rescanner la bibliothèque)', () => {
  it('expose niveau/xp/streaks/badges depuis UserProgress + UserBadge', async () => {
    const badgeDef = BADGES[0]!;
    await db.userProgress.upsert({
      where: { userId: uid('Bob') },
      create: { userId: uid('Bob'), xp: 5000, level: 5, currentStreak: 7, bestStreak: 9 },
      update: { xp: 5000, level: 5, currentStreak: 7, bestStreak: 9 },
    });
    await db.userBadge.createMany({
      data: [
        { userId: uid('Bob'), badgeId: badgeDef.id, tier: 1 },
        { userId: uid('Bob'), badgeId: badgeDef.id, tier: 2 },
      ],
    });
    const res = await app.inject({ method: 'GET', url: `/api/users/${uid('Bob')}`, headers: bearer('Carol') });
    expect(res.statusCode).toBe(200);
    const g = res.json().gamification;
    expect(g.level).toBe(5);
    expect(g.xp).toBe(5000);
    expect(g.currentStreak).toBe(7);
    expect(g.bestStreak).toBe(9);
    expect(typeof g.levelTitle).toBe('string');
    expect(typeof g.nextLevelXp).toBe('number');
    // Un seul badge exposé, au plus haut palier persisté.
    const badge = (g.badges as { id: string; tier: number; tierCount: number }[]).find((b) => b.id === badgeDef.id);
    expect(badge).toMatchObject({ id: badgeDef.id, tier: 2, tierCount: badgeDef.thresholds.length });
    expect(g.challenges).toBeUndefined();
  });

  it('compte sans UserProgress : valeurs par défaut (jamais de crash)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/users/${uid('Carol')}`, headers: bearer('Bob') });
    expect(res.statusCode).toBe(200);
    expect(res.json().gamification).toMatchObject({ level: 1, xp: 0, currentStreak: 0, badges: [] });
  });
});

describe('Blocage — défi hebdo et notifications', () => {
  it('le défi hebdo exclut les comptes bloqués (même avec un follow résiduel)', async () => {
    // Dave a regardé un épisode cette semaine.
    await db.watchEvent.create({
      data: { userId: uid('Dave'), mediaId: showMediaId, episodeId, eventType: 'watched', eventDate: new Date(), source: 'manual' },
    });
    let res = await app.inject({ method: 'GET', url: '/api/social/challenge/weekly', headers: bearer('Alice') });
    expect(res.statusCode).toBe(200);
    let entries = res.json().entries as { userId: string; minutes: number }[];
    expect(entries.map((e) => e.userId)).toContain(uid('Dave'));

    // Alice bloque Dave, puis un follow résiduel est recréé (vieux client).
    const block = await app.inject({ method: 'POST', url: `/api/users/${uid('Dave')}/block`, headers: bearer('Alice') });
    expect(block.statusCode).toBe(200);
    await db.follow.create({ data: { followerId: uid('Alice'), followingId: uid('Dave') } });

    res = await app.inject({ method: 'GET', url: '/api/social/challenge/weekly', headers: bearer('Alice') });
    entries = res.json().entries as { userId: string; minutes: number }[];
    expect(entries.map((e) => e.userId)).not.toContain(uid('Dave'));
    // Bob (non bloqué) reste présent.
    expect(entries.map((e) => e.userId)).toContain(uid('Bob'));
  });

  it('notifyUser ne notifie pas un destinataire qui a bloqué l’acteur', async () => {
    const { notifyUser } = await import('../modules/social/notify.js');
    const before = await db.notification.count({ where: { userId: uid('Alice') } });
    // Dave est bloqué par Alice → aucun signal ne doit passer.
    await notifyUser(uid('Alice'), uid('Dave'), { type: 'comment_reaction', title: 'ping bloqué' });
    expect(await db.notification.count({ where: { userId: uid('Alice') } })).toBe(before);
    // Contrôle : un acteur non bloqué notifie normalement.
    await notifyUser(uid('Alice'), uid('Bob'), { type: 'comment_reaction', title: 'ping légitime' });
    expect(await db.notification.count({ where: { userId: uid('Alice') } })).toBe(before + 1);
  });
});

describe('OAuth fail closed', () => {
  it.each(['discord', 'facebook', 'google'] as const)(
    'provider %s non configuré → 400 provider_not_configured',
    async (provider) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/oauth',
        payload: { provider, token: 'nimporte-quoi' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('provider_not_configured');
    },
  );
});
