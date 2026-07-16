import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { mediaTitle, serializeMedia } from '../media/serialize.js';
import { getUserLang } from '../media/userLang.js';
import { notifyFollowers, notifyUser } from './notify.js';
import { BADGES, findBlockedTerm } from '@serietime/core';
import { meView, scheduleRecompute } from '../gamification/service.js';

// Ordre favoris (drag & drop) partagé avec /api/profile : positionnés d'abord,
// puis les plus anciennement ajoutés.
const FAVORITE_ORDER = [
  { favoriteOrder: { sort: 'asc' as const, nulls: 'last' as const } },
  { favoritedAt: 'asc' as const },
];

// Sous-ensemble PUBLIC de la gamification (réputation, visible même sur un
// profil restreint) : niveau, titre, streak et badges DÉBLOQUÉS uniquement.
// Les défis (personnels) ne sont jamais exposés. Réutilise meView (lecture
// pure, aucune écriture ni notification). Null si l'utilisateur a disparu.
async function publicGamification(userId: string) {
  const view = await meView(userId);
  if (!view) return null;
  const badges = view.badges
    .filter((b) => b.tier > 0)
    // Palier décroissant, puis déblocage le plus récent d'abord.
    .sort((a, b) => b.tier - a.tier || (b.unlockedAt ?? '').localeCompare(a.unlockedAt ?? ''))
    .map((b) => ({ id: b.id, label: b.label, icon: b.icon, tier: b.tier, tierCount: b.tierCount }));
  return {
    level: view.level,
    levelTitle: view.levelTitle,
    xp: view.xp,
    nextLevelXp: view.nextLevelXp,
    currentStreak: view.currentStreak,
    bestStreak: view.bestStreak,
    badges,
  };
}

type PublicUser = { id: string; displayName: string; avatarUrl: string | null; isPrivate: boolean };

function publicUser(u: PublicUser): PublicUser {
  return { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, isPrivate: u.isPrivate };
}

async function followingIdSet(userId: string): Promise<Set<string>> {
  const rows = await prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true } });
  return new Set(rows.map((r) => r.followingId));
}

function summarizeReactions(reactions: { emoji: string; userId: string }[], me: string) {
  const byEmoji: Record<string, number> = {};
  const mine: string[] = [];
  for (const r of reactions) {
    byEmoji[r.emoji] = (byEmoji[r.emoji] ?? 0) + 1;
    if (r.userId === me) mine.push(r.emoji);
  }
  return { total: reactions.length, byEmoji, mine };
}

type FeedItem = {
  kind: 'watch' | 'comment' | 'badge';
  id: string;
  date: string;
  eventType: string;
  // `level` (gamification) n'est ajouté qu'ici et dans le leaderboard, en
  // batch (une requête UserProgress pour tous les ids) — publicUser() est
  // appelé unitairement partout ailleurs et y ajouter un lookup ferait un N+1.
  user: PublicUser & { level?: number };
  // Absents pour kind: 'badge' (déblocage de badge, sans média associé).
  media?: { id: string; title: string; posterPath: string | null; type: string };
  episode?: { seasonNumber: number; episodeNumber: number; title: string } | null;
  body?: string;
  badge?: { id: string; label: string; tier: number };
};

export async function socialRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // --- Abonnements ---------------------------------------------------------
  app.post('/api/social/follow/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string };
    if (userId === request.userId) return reply.code(400).send({ error: 'cannot_follow_self' });
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return reply.code(404).send({ error: 'not_found' });
    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId: request.userId, followingId: userId } },
      create: { followerId: request.userId, followingId: userId },
      update: {},
    });
    scheduleRecompute(userId); // gamification : badge « Célébrité » du compte suivi
    return { ok: true, following: true };
  });

  app.delete('/api/social/follow/:userId', async (request) => {
    const { userId } = request.params as { userId: string };
    await prisma.follow.deleteMany({ where: { followerId: request.userId, followingId: userId } });
    return { ok: true, following: false };
  });

  app.get('/api/social/following', async (request) => {
    const rows = await prisma.follow.findMany({
      where: { followerId: request.userId },
      include: { following: true },
      orderBy: { createdAt: 'desc' },
    });
    return { users: rows.map((r) => ({ ...publicUser(r.following), isFollowing: true })) };
  });

  app.get('/api/social/followers', async (request) => {
    const rows = await prisma.follow.findMany({
      where: { followingId: request.userId },
      include: { follower: true },
      orderBy: { createdAt: 'desc' },
    });
    const followingIds = await followingIdSet(request.userId);
    return {
      users: rows.map((r) => ({ ...publicUser(r.follower), isFollowing: followingIds.has(r.follower.id) })),
    };
  });

  // Mes commentaires (pour le compteur « commentaires » du profil).
  app.get('/api/social/comments', async (request) => {
    const rows = await prisma.comment.findMany({
      where: { userId: request.userId },
      include: { media: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      comments: rows.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        media: {
          id: c.media.id,
          type: c.media.type,
          title: c.media.localizedTitle ?? c.media.title,
          posterPath: c.media.posterPath,
        },
      })),
    };
  });

  // --- Recherche d'utilisateurs -------------------------------------------
  app.get('/api/users/search', async (request) => {
    const { q } = z.object({ q: z.string().default('') }).parse(request.query ?? {});
    const term = q.trim();
    if (!term) return { users: [] };
    const users = await prisma.user.findMany({
      where: { displayName: { contains: term }, id: { not: request.userId } },
      take: 20,
    });
    const followingIds = await followingIdSet(request.userId);
    return { users: users.map((u) => ({ ...publicUser(u), isFollowing: followingIds.has(u.id) })) };
  });

  // --- Profil public -------------------------------------------------------
  app.get('/api/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    // Langue du VISITEUR (request.userId), pas celle du profil consulté.
    const lang = await getUserLang(request.userId);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: 'not_found' });
    const isSelf = id === request.userId;
    const isFollowing =
      !isSelf &&
      !!(await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: request.userId, followingId: id } },
      }));
    // Gamification calculée TOUJOURS (réputation publique, même en restricted).
    const [followersCount, followingCount, gamification] = await Promise.all([
      prisma.follow.count({ where: { followingId: id } }),
      prisma.follow.count({ where: { followerId: id } }),
      publicGamification(id),
    ]);
    const base = { ...publicUser(user), isFollowing, isSelf, followersCount, followingCount, gamification };

    // Profil privé : niveau + trophées restent visibles, mais l'activité (stats,
    // séries récentes, favoris) est masquée aux non-abonnés.
    if (user.isPrivate && !isSelf && !isFollowing) {
      return {
        ...base,
        restricted: true,
        stats: null,
        recentShows: [],
        favoriteShows: [],
        favoriteMovies: [],
        favoriteGames: [],
      };
    }
    const [showsCount, moviesCount, episodesWatched, gamesCount, recent, favoriteShows, favoriteMovies, favoriteGames] =
      await Promise.all([
        prisma.userMediaStatus.count({ where: { userId: id, media: { type: 'show' } } }),
        prisma.userMediaStatus.count({ where: { userId: id, media: { type: 'movie' } } }),
        prisma.userEpisodeStatus.count({ where: { userId: id, status: 'watched' } }),
        prisma.userMediaStatus.count({ where: { userId: id, media: { type: 'game' }, isHidden: false } }),
        prisma.userMediaStatus.findMany({
          where: { userId: id, media: { type: 'show' }, isHidden: false },
          include: { media: true },
          orderBy: { lastWatchedAt: 'desc' },
          take: 12,
        }),
        prisma.userMediaStatus.findMany({
          where: { userId: id, media: { type: 'show' }, isFavorite: true },
          include: { media: true },
          orderBy: FAVORITE_ORDER,
          take: 12,
        }),
        prisma.userMediaStatus.findMany({
          where: { userId: id, media: { type: 'movie' }, isFavorite: true },
          include: { media: true },
          orderBy: FAVORITE_ORDER,
          take: 12,
        }),
        prisma.userMediaStatus.findMany({
          where: { userId: id, media: { type: 'game' }, isFavorite: true },
          include: { media: true },
          orderBy: FAVORITE_ORDER,
          take: 12,
        }),
      ]);
    return {
      ...base,
      restricted: false,
      stats: { showsCount, moviesCount, episodesWatched, gamesCount },
      recentShows: recent.map((s) => serializeMedia(s.media, s, lang)),
      favoriteShows: favoriteShows.map((s) => serializeMedia(s.media, s, lang)),
      favoriteMovies: favoriteMovies.map((s) => serializeMedia(s.media, s, lang)),
      favoriteGames: favoriteGames.map((s) => serializeMedia(s.media, s, lang)),
    };
  });

  // --- Fil d'activité des abonnements --------------------------------------
  app.get('/api/social/feed', async (request) => {
    const lang = await getUserLang(request.userId);
    const ids = [...(await followingIdSet(request.userId))];
    if (ids.length === 0) return { items: [] as FeedItem[] };

    const [events, comments, badges, progresses] = await Promise.all([
      prisma.watchEvent.findMany({
        where: { userId: { in: ids }, eventType: { in: ['watched', 'favorited', 'added_to_watchlist'] } },
        include: { user: true, media: true, episode: true },
        orderBy: { eventDate: 'desc' },
        take: 40,
      }),
      prisma.comment.findMany({
        where: { userId: { in: ids } },
        include: { user: true, media: true, episode: true },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
      // Gamification : déblocages de badges récents des comptes suivis.
      prisma.userBadge.findMany({
        where: { userId: { in: ids } },
        include: { user: true },
        orderBy: { unlockedAt: 'desc' },
        take: 20,
      }),
      // Niveau des comptes suivis, en une requête (pas de N+1).
      prisma.userProgress.findMany({ where: { userId: { in: ids } }, select: { userId: true, level: true } }),
    ]);
    const levelById = new Map(progresses.map((p) => [p.userId, p.level]));
    const withLevel = (u: PublicUser): FeedItem['user'] => ({ ...publicUser(u), level: levelById.get(u.id) ?? 1 });

    const items: FeedItem[] = [
      ...events.map((e): FeedItem => ({
        kind: 'watch',
        id: e.id,
        date: e.eventDate.toISOString(),
        eventType: e.eventType,
        user: withLevel(e.user),
        media: {
          id: e.mediaId,
          title: mediaTitle(e.media, lang),
          posterPath: e.media.posterPath,
          type: e.media.type,
        },
        episode: e.episode
          ? { seasonNumber: e.episode.seasonNumber, episodeNumber: e.episode.episodeNumber, title: e.episode.title }
          : null,
      })),
      ...comments.map((c): FeedItem => ({
        kind: 'comment',
        id: c.id,
        date: c.createdAt.toISOString(),
        eventType: 'comment',
        user: withLevel(c.user),
        media: {
          id: c.mediaId,
          title: mediaTitle(c.media, lang),
          posterPath: c.media.posterPath,
          type: c.media.type,
        },
        episode: c.episode
          ? { seasonNumber: c.episode.seasonNumber, episodeNumber: c.episode.episodeNumber, title: c.episode.title }
          : null,
        body: c.body,
      })),
      ...badges.map((b): FeedItem => ({
        kind: 'badge',
        id: b.id,
        date: b.unlockedAt.toISOString(),
        eventType: 'badge_unlocked',
        user: withLevel(b.user),
        badge: {
          id: b.badgeId,
          label: BADGES.find((def) => def.id === b.badgeId)?.label ?? b.badgeId,
          tier: b.tier,
        },
      })),
    ]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 50);

    return { items };
  });

  // --- Confidentialité -----------------------------------------------------
  app.post('/api/social/privacy', async (request) => {
    const { isPrivate } = z.object({ isPrivate: z.boolean() }).parse(request.body);
    await prisma.user.update({ where: { id: request.userId }, data: { isPrivate } });
    return { ok: true, isPrivate };
  });

  // --- Commentaires (avec fils de discussion) + réactions -----------------
  app.get('/api/media/:id/comments', async (request) => {
    const { id } = request.params as { id: string };
    const { episodeId } = z.object({ episodeId: z.string().optional() }).parse(request.query ?? {});
    const all = await prisma.comment.findMany({
      where: { mediaId: id, ...(episodeId ? { episodeId } : {}) },
      include: { user: true, reactions: true },
      orderBy: { createdAt: 'asc' },
    });
    const me = request.userId;
    const serialize = (c: (typeof all)[number]) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      episodeId: c.episodeId,
      parentId: c.parentId,
      user: publicUser(c.user),
      isMine: c.userId === me,
      reactions: summarizeReactions(c.reactions, me),
    });
    const repliesByParent = new Map<string, ReturnType<typeof serialize>[]>();
    for (const c of all) {
      if (!c.parentId) continue;
      const arr = repliesByParent.get(c.parentId) ?? [];
      arr.push(serialize(c));
      repliesByParent.set(c.parentId, arr);
    }
    // Commentaires racines, plus récents d'abord ; réponses en ordre chronologique.
    const comments = all
      .filter((c) => !c.parentId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((c) => ({ ...serialize(c), replies: repliesByParent.get(c.id) ?? [] }));
    return { comments };
  });

  app.post('/api/media/:id/comments', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        body: z.string().min(1).max(2000),
        episodeId: z.string().optional(),
        parentId: z.string().optional(),
      })
      .parse(request.body);
    // Modération : rejette les commentaires ET réponses (même route) contenant
    // des termes haineux/gravement injurieux. On ne journalise QUE la catégorie,
    // jamais le texte complet du commentaire.
    const blocked = findBlockedTerm(body.body);
    if (blocked) {
      request.log.info({ category: blocked.category }, 'comment blocked by moderation');
      return reply.code(400).send({
        error: 'comment_blocked',
        message:
          'Hop hop hop ! 🙅 La politesse est de mise sur SerieTime, chenapan. Reformule ça sans insulte et réessaie 😇',
      });
    }
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    if (body.episodeId) {
      const ep = await prisma.episode.findUnique({ where: { id: body.episodeId } });
      if (!ep) return reply.code(404).send({ error: 'episode_not_found' });
    }
    let parent: { id: string; userId: string } | null = null;
    if (body.parentId) {
      const p = await prisma.comment.findUnique({ where: { id: body.parentId } });
      if (!p || p.mediaId !== id) return reply.code(404).send({ error: 'parent_not_found' });
      parent = { id: p.id, userId: p.userId };
    }
    const comment = await prisma.comment.create({
      data: {
        userId: request.userId,
        mediaId: id,
        episodeId: body.episodeId,
        parentId: body.parentId,
        body: body.body,
      },
    });

    const me = await prisma.user.findUnique({ where: { id: request.userId } });
    const actorName = me?.displayName ?? 'Quelqu’un';
    const title = media.localizedTitle ?? media.title;
    if (parent) {
      await notifyUser(parent.userId, request.userId, {
        type: 'comment_reply',
        title: `${actorName} a répondu à votre commentaire`,
        body: body.body,
        mediaId: id,
        commentId: comment.id,
      });
    } else {
      await notifyFollowers(request.userId, {
        type: 'friend_comment',
        title: `${actorName} a commenté ${title}`,
        body: body.body,
        imageUrl: media.posterPath,
        mediaId: id,
        commentId: comment.id,
      });
    }
    scheduleRecompute(request.userId); // gamification : commentaire posté
    return { id: comment.id };
  });

  app.delete('/api/comments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const comment = await prisma.comment.findUnique({ where: { id } });
    if (!comment) return reply.code(404).send({ error: 'not_found' });
    if (comment.userId !== request.userId) return reply.code(403).send({ error: 'forbidden' });
    await prisma.comment.delete({ where: { id } }); // supprime aussi les réponses (cascade)
    return { ok: true };
  });

  // Réactions multiples : chaque emoji est indépendant (toggle par emoji).
  app.post('/api/comments/:id/react', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { emoji } = z.object({ emoji: z.string().min(1).max(8) }).parse(request.body);
    const comment = await prisma.comment.findUnique({ where: { id } });
    if (!comment) return reply.code(404).send({ error: 'not_found' });
    const existing = await prisma.commentReaction.findUnique({
      where: { commentId_userId_emoji: { commentId: id, userId: request.userId, emoji } },
    });
    if (existing) {
      await prisma.commentReaction.delete({ where: { id: existing.id } });
      return { ok: true, reacted: false };
    }
    await prisma.commentReaction.create({ data: { commentId: id, userId: request.userId, emoji } });
    const me = await prisma.user.findUnique({ where: { id: request.userId } });
    await notifyUser(comment.userId, request.userId, {
      type: 'comment_reaction',
      title: `${me?.displayName ?? 'Quelqu’un'} a réagi ${emoji} à votre commentaire`,
      mediaId: comment.mediaId,
      commentId: comment.id,
    });
    return { ok: true, reacted: true };
  });
}
