import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-social-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'social.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let app: FastifyInstance;
const users: Record<string, { token: string; id: string }> = {};
let movieId = '';
let bobCommentId = '';

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

  await register('Alice', 'alice@example.com');
  await register('Bob', 'bob@example.com');
  await register('Carol', 'carol@example.com');

  const { prisma } = await import('../db/client.js');
  const media = await prisma.media.create({ data: { type: 'movie', title: 'Inception', year: 2010 } });
  movieId = media.id;
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('Social — abonnements, fil, commentaires, réactions, confidentialité', () => {
  it('Bob regarde un film et poste un commentaire (activité)', async () => {
    const w = await app.inject({ method: 'POST', url: `/api/movies/${movieId}/watched`, headers: bearer('Bob') });
    expect(w.statusCode).toBe(200);
    const c = await app.inject({
      method: 'POST',
      url: `/api/media/${movieId}/comments`,
      payload: { body: 'Chef-d’œuvre !' },
      headers: bearer('Bob'),
    });
    expect(c.statusCode).toBe(200);
    bobCommentId = c.json().id;
    expect(bobCommentId).toBeTruthy();
  });

  it('on ne peut pas s’abonner à soi-même', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/social/follow/${uid("Alice")}`,
      headers: bearer('Alice'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('Alice suit Bob ; les listes d’abonnements reflètent la relation', async () => {
    const f = await app.inject({ method: 'POST', url: `/api/social/follow/${uid("Bob")}`, headers: bearer('Alice') });
    expect(f.json()).toMatchObject({ following: true });

    const following = await app.inject({ method: 'GET', url: '/api/social/following', headers: bearer('Alice') });
    expect(following.json().users.map((u: { id: string }) => u.id)).toContain(uid("Bob"));

    const followers = await app.inject({ method: 'GET', url: '/api/social/followers', headers: bearer('Bob') });
    const alice = followers.json().users.find((u: { id: string }) => u.id === uid("Alice"));
    expect(alice).toBeTruthy();
  });

  it('le fil d’Alice montre l’activité de Bob (visionnage + commentaire)', async () => {
    const feed = await app.inject({ method: 'GET', url: '/api/social/feed', headers: bearer('Alice') });
    const items = feed.json().items as { kind: string; user: { id: string }; media: { title: string } }[];
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.every((i) => i.user.id === uid("Bob"))).toBe(true);
    expect(items.some((i) => i.kind === 'watch')).toBe(true);
    expect(items.some((i) => i.kind === 'comment')).toBe(true);
    expect(items.every((i) => i.media.title === 'Inception')).toBe(true);
  });

  it('le fil de Carol (qui ne suit personne) est vide', async () => {
    const feed = await app.inject({ method: 'GET', url: '/api/social/feed', headers: bearer('Carol') });
    expect(feed.json().items).toHaveLength(0);
  });

  it('Alice pose plusieurs réactions (emojis indépendants)', async () => {
    await app.inject({ method: 'POST', url: `/api/comments/${bobCommentId}/react`, payload: { emoji: '❤️' }, headers: bearer('Alice') });
    await app.inject({ method: 'POST', url: `/api/comments/${bobCommentId}/react`, payload: { emoji: '👍' }, headers: bearer('Alice') });
    let comments = await app.inject({ method: 'GET', url: `/api/media/${movieId}/comments`, headers: bearer('Alice') });
    let bobComment = comments.json().comments.find((c: { id: string }) => c.id === bobCommentId);
    expect(bobComment.reactions.total).toBe(2);
    expect(bobComment.reactions.mine).toEqual(expect.arrayContaining(['❤️', '👍']));
    expect(bobComment.isMine).toBe(false);

    // Re-poster ❤️ le retire (toggle).
    const toggle = await app.inject({ method: 'POST', url: `/api/comments/${bobCommentId}/react`, payload: { emoji: '❤️' }, headers: bearer('Alice') });
    expect(toggle.json().reacted).toBe(false);
    comments = await app.inject({ method: 'GET', url: `/api/media/${movieId}/comments`, headers: bearer('Alice') });
    bobComment = comments.json().comments.find((c: { id: string }) => c.id === bobCommentId);
    expect(bobComment.reactions.total).toBe(1);
    expect(bobComment.reactions.mine).toEqual(['👍']);
  });

  it('Alice répond au commentaire de Bob (fil de discussion)', async () => {
    const reply = await app.inject({
      method: 'POST',
      url: `/api/media/${movieId}/comments`,
      payload: { body: 'Tout à fait d’accord !', parentId: bobCommentId },
      headers: bearer('Alice'),
    });
    expect(reply.statusCode).toBe(200);
    const comments = await app.inject({ method: 'GET', url: `/api/media/${movieId}/comments`, headers: bearer('Alice') });
    const bobComment = comments.json().comments.find((c: { id: string }) => c.id === bobCommentId);
    expect(bobComment.replies).toHaveLength(1);
    expect(bobComment.replies[0].body).toBe('Tout à fait d’accord !');
    // La réponse n'apparaît pas comme commentaire racine.
    expect(comments.json().comments.some((c: { id: string }) => c.id === bobComment.replies[0].id)).toBe(false);
  });

  it('Bob est notifié de la réaction et de la réponse d’Alice', async () => {
    const notifs = await app.inject({ method: 'GET', url: '/api/notifications', headers: bearer('Bob') });
    const types = notifs.json().notifications.map((n: { type: string }) => n.type);
    expect(types).toContain('comment_reaction');
    expect(types).toContain('comment_reply');
    expect(notifs.json().unreadCount).toBeGreaterThanOrEqual(2);
  });

  it('un nouveau commentaire de Bob notifie ses abonnés (Alice)', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/media/${movieId}/comments`,
      payload: { body: 'À revoir absolument.' },
      headers: bearer('Bob'),
    });
    const notifs = await app.inject({ method: 'GET', url: '/api/notifications', headers: bearer('Alice') });
    expect(notifs.json().notifications.some((n: { type: string }) => n.type === 'friend_comment')).toBe(true);
  });

  it('marquer les notifications comme lues remet le compteur à zéro', async () => {
    await app.inject({ method: 'POST', url: '/api/notifications/read', payload: {}, headers: bearer('Bob') });
    const count = await app.inject({ method: 'GET', url: '/api/notifications/unread-count', headers: bearer('Bob') });
    expect(count.json().unreadCount).toBe(0);
  });

  it('profil public : gamification (niveau) + favoris exposés', async () => {
    // Bob met le film en favori pour peupler « Films préférés ».
    await app.inject({ method: 'POST', url: `/api/movies/${movieId}/favorite`, headers: bearer('Bob') });

    const asCarol = await app.inject({ method: 'GET', url: `/api/users/${uid("Bob")}`, headers: bearer('Carol') });
    const body = asCarol.json();
    expect(body.restricted).toBe(false);
    // Gamification publique : niveau présent, défis JAMAIS exposés.
    expect(typeof body.gamification.level).toBe('number');
    expect(body.gamification.challenges).toBeUndefined();
    expect(Array.isArray(body.gamification.badges)).toBe(true);
    // gamesCount ajouté aux stats.
    expect(typeof body.stats.gamesCount).toBe('number');
    // Favoris exposés.
    expect(body.favoriteMovies.map((m: { id: string }) => m.id)).toContain(movieId);
    expect(Array.isArray(body.favoriteShows)).toBe(true);
  });

  it('profil privé : masqué aux non-abonnés, visible des abonnés (mais gamification toujours visible)', async () => {
    await app.inject({ method: 'POST', url: '/api/social/privacy', payload: { isPrivate: true }, headers: bearer('Bob') });

    const asCarol = await app.inject({ method: 'GET', url: `/api/users/${uid("Bob")}`, headers: bearer('Carol') });
    expect(asCarol.json().restricted).toBe(true);
    expect(asCarol.json().stats).toBeNull();
    // Restricted : favoris masqués…
    expect(asCarol.json().favoriteMovies).toEqual([]);
    // …mais la gamification (réputation) reste visible.
    expect(typeof asCarol.json().gamification.level).toBe('number');

    const asAlice = await app.inject({ method: 'GET', url: `/api/users/${uid("Bob")}`, headers: bearer('Alice') });
    expect(asAlice.json().restricted).toBe(false);
    expect(asAlice.json().isFollowing).toBe(true);
    expect(asAlice.json().stats.moviesCount).toBeGreaterThanOrEqual(1);
  });

  it('on ne peut supprimer que ses propres commentaires', async () => {
    const forbidden = await app.inject({ method: 'DELETE', url: `/api/comments/${bobCommentId}`, headers: bearer('Alice') });
    expect(forbidden.statusCode).toBe(403);
    const ok = await app.inject({ method: 'DELETE', url: `/api/comments/${bobCommentId}`, headers: bearer('Bob') });
    expect(ok.statusCode).toBe(200);
  });

  it('se désabonner vide le fil', async () => {
    await app.inject({ method: 'DELETE', url: `/api/social/follow/${uid("Bob")}`, headers: bearer('Alice') });
    const feed = await app.inject({ method: 'GET', url: '/api/social/feed', headers: bearer('Alice') });
    expect(feed.json().items).toHaveLength(0);
  });
});
