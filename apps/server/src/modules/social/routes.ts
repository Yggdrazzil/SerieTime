import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { mediaTitle, serializeMedia } from '../media/serialize.js';
import { getUserLang } from '../media/userLang.js';
import { notifyFollowers, notifyUser } from './notify.js';
import { blockedIdSet } from './blocks.js';
import { BADGES, findBlockedTerm, levelTitle, nextLevelXp } from '@serietime/core';
import { scheduleRecompute } from '../gamification/service.js';
import { EP_FALLBACK_MIN, MOVIE_FALLBACK_MIN } from '../../lib/runtimeFallbacks.js';

// Ordre favoris (drag & drop) partagé avec /api/profile : positionnés d'abord,
// puis les plus anciennement ajoutés.
const FAVORITE_ORDER = [
  { favoriteOrder: { sort: 'asc' as const, nulls: 'last' as const } },
  { favoritedAt: 'asc' as const },
];

// Sous-ensemble PUBLIC de la gamification (réputation, visible même sur un
// profil restreint) : niveau, titre, streak et badges DÉBLOQUÉS uniquement.
// Les défis (personnels) ne sont jamais exposés. On lit l'état PERSISTÉ
// (UserProgress + UserBadge, maintenus par le recompute débouncé) : l'ancien
// collect() live rescannait toute la bibliothèque (20k lignes) à CHAQUE
// GET /api/users/:id — le collect live reste réservé à /api/gamification/me.
async function publicGamification(userId: string) {
  const [progress, badgeRows] = await Promise.all([
    prisma.userProgress.findUnique({ where: { userId } }),
    prisma.userBadge.findMany({ where: { userId }, select: { badgeId: true, tier: true, unlockedAt: true } }),
  ]);
  // Pas encore de UserProgress (compte tout neuf, recompute pas encore passé) :
  // valeurs par défaut plutôt que null — la réputation publique reste affichable.
  const level = progress?.level ?? 1;
  // Plus haut palier persisté par badge (+ date de déblocage correspondante).
  const topByBadge = new Map<string, { tier: number; unlockedAt: Date }>();
  for (const row of badgeRows) {
    const cur = topByBadge.get(row.badgeId);
    if (!cur || row.tier > cur.tier) topByBadge.set(row.badgeId, { tier: row.tier, unlockedAt: row.unlockedAt });
  }
  const badges = [...topByBadge.entries()]
    .flatMap(([badgeId, b]) => {
      const def = BADGES.find((d) => d.id === badgeId);
      if (!def || b.tier <= 0) return [];
      return [{ id: badgeId, label: def.label, icon: def.icon, tier: b.tier, tierCount: def.thresholds.length, unlockedAt: b.unlockedAt }];
    })
    // Palier décroissant, puis déblocage le plus récent d'abord.
    .sort((a, b) => b.tier - a.tier || b.unlockedAt.getTime() - a.unlockedAt.getTime())
    .map(({ unlockedAt: _unlockedAt, ...b }) => b);
  return {
    level,
    levelTitle: levelTitle(level),
    xp: progress?.xp ?? 0,
    nextLevelXp: nextLevelXp(level),
    currentStreak: progress?.currentStreak ?? 0,
    bestStreak: progress?.bestStreak ?? 0,
    badges,
  };
}

type PublicUser = { id: string; displayName: string; avatarUrl: string | null; isPrivate: boolean };

function publicUser(u: PublicUser): PublicUser {
  return { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, isPrivate: u.isPrivate };
}

export async function followingIdSet(userId: string): Promise<Set<string>> {
  const rows = await prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true } });
  return new Set(rows.map((r) => r.followingId));
}

// Niveau + streak d'une liste d'utilisateurs, en UNE requête UserProgress
// (jamais de lookup unitaire par user — N+1). Défauts : level 1, streak 0.
async function progressMap(ids: string[]): Promise<Map<string, { level: number; currentStreak: number }>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.userProgress.findMany({
    where: { userId: { in: ids } },
    select: { userId: true, level: true, currentStreak: true },
  });
  return new Map(rows.map((r) => [r.userId, { level: r.level, currentStreak: r.currentStreak }]));
}

// Décalage (ms) entre l'heure locale d'un fuseau et l'UTC à un instant donné.
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const p: Record<string, number> = {};
  for (const part of parts) p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, (p.hour ?? 0) % 24, p.minute ?? 0, p.second ?? 0);
  return asUtc - date.getTime();
}

// Lundi 00:00 Europe/Paris (l'instant UTC correspondant), calculé côté JS puis
// utilisé comme borne SQL — WatchEvent.eventDate est stocké en ms epoch.
export function mondayStartParis(now = new Date()): Date {
  const tz = 'Europe/Paris';
  const dayParts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now)
    .split('-')
    .map(Number);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
  const idx = Math.max(0, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday));
  // Minuit UTC du lundi calendaire parisien, puis correction par l'offset Paris
  // (les bascules DST ont lieu à 2 h/3 h : l'offset à minuit est le bon).
  const guess = Date.UTC(dayParts[0] ?? 1970, (dayParts[1] ?? 1) - 1, (dayParts[2] ?? 1) - idx);
  return new Date(guess - tzOffsetMs(new Date(guess), tz));
}

type FeedReactions = { total: number; mine: string[]; counts: Record<string, number> };

const REACTION_KINDS = ['watch', 'comment', 'badge'] as const;
type ReactionKind = (typeof REACTION_KINDS)[number];

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
  // `level`/`streak` (gamification) ne sont ajoutés qu'ici et dans les listes
  // d'abonnements, en batch (une requête UserProgress pour tous les ids) —
  // publicUser() est appelé unitairement ailleurs, un lookup ferait un N+1.
  user: PublicUser & { level?: number; streak?: number };
  // Réactions emoji sur l'item (toggle via POST /api/social/feed/react).
  reactions: FeedReactions;
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
    // Streak + niveau en UNE requête UserProgress pour toute la liste.
    const progress = await progressMap(rows.map((r) => r.following.id));
    return {
      users: rows.map((r) => ({
        ...publicUser(r.following),
        isFollowing: true,
        streak: progress.get(r.following.id)?.currentStreak ?? 0,
        level: progress.get(r.following.id)?.level ?? 1,
      })),
    };
  });

  app.get('/api/social/followers', async (request) => {
    const rows = await prisma.follow.findMany({
      where: { followingId: request.userId },
      include: { follower: true },
      orderBy: { createdAt: 'desc' },
    });
    const [followingIds, progress] = await Promise.all([
      followingIdSet(request.userId),
      progressMap(rows.map((r) => r.follower.id)),
    ]);
    return {
      users: rows.map((r) => ({
        ...publicUser(r.follower),
        isFollowing: followingIds.has(r.follower.id),
        streak: progress.get(r.follower.id)?.currentStreak ?? 0,
        level: progress.get(r.follower.id)?.level ?? 1,
      })),
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

  // --- Blocage d'un utilisateur (modération UGC, exigence stores) ----------
  // Modèle « mute » unidirectionnel (cf. blocks.ts) : bloquer masque les
  // contenus du bloqué au bloqueur, et désabonne DANS LES DEUX SENS.
  app.post('/api/users/:id/block', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.userId) return reply.code(400).send({ error: 'cannot_block_self' });
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: 'not_found' });
    // Idempotent : re-bloquer un compte déjà bloqué ne change rien.
    await prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId: request.userId, blockedId: id } },
      create: { blockerId: request.userId, blockedId: id },
      update: {},
    });
    // Désabonnement bilatéral : plus aucun lien social entre les deux comptes.
    await prisma.follow.deleteMany({
      where: {
        OR: [
          { followerId: request.userId, followingId: id },
          { followerId: id, followingId: request.userId },
        ],
      },
    });
    return { ok: true, blocked: true };
  });

  app.delete('/api/users/:id/block', async (request) => {
    const { id } = request.params as { id: string };
    // Idempotent : débloquer un compte non bloqué renvoie aussi ok.
    await prisma.block.deleteMany({ where: { blockerId: request.userId, blockedId: id } });
    return { ok: true, blocked: false };
  });

  // --- Recherche d'utilisateurs -------------------------------------------
  app.get('/api/users/search', async (request) => {
    const { q } = z.object({ q: z.string().default('') }).parse(request.query ?? {});
    const term = q.trim();
    if (!term) return { users: [] };
    const blockedIds = await blockedIdSet(request.userId);
    const users = await prisma.user.findMany({
      where: { displayName: { contains: term }, id: { not: request.userId, notIn: [...blockedIds] } },
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
    // Blocage : moi (visiteur) → lui (profil consulté). Le profil reste
    // consultable (modèle mute) ; le client remplace SUIVRE par « Débloquer ».
    const isBlocked =
      !isSelf &&
      !!(await prisma.block.findUnique({
        where: { blockerId_blockedId: { blockerId: request.userId, blockedId: id } },
      }));
    // Gamification calculée TOUJOURS (réputation publique, même en restricted).
    const [followersCount, followingCount, gamification] = await Promise.all([
      prisma.follow.count({ where: { followingId: id } }),
      prisma.follow.count({ where: { followerId: id } }),
      publicGamification(id),
    ]);
    const base = { ...publicUser(user), isFollowing, isBlocked, isSelf, followersCount, followingCount, gamification };

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
          where: { userId: id, media: { type: 'show' }, isFavorite: true, isHidden: false },
          include: { media: true },
          orderBy: FAVORITE_ORDER,
          take: 12,
        }),
        prisma.userMediaStatus.findMany({
          where: { userId: id, media: { type: 'movie' }, isFavorite: true, isHidden: false },
          include: { media: true },
          orderBy: FAVORITE_ORDER,
          take: 12,
        }),
        prisma.userMediaStatus.findMany({
          where: { userId: id, media: { type: 'game' }, isFavorite: true, isHidden: false },
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
    // Filtrage blocage : bloquer désabonne déjà, mais on exclut aussi ici par
    // sûreté (ex. follow recréé par un vieux client) — une seule requête Block.
    const [followingIds, blockedIds] = await Promise.all([
      followingIdSet(request.userId),
      blockedIdSet(request.userId),
    ]);
    const ids = [...followingIds].filter((id) => !blockedIds.has(id));
    if (ids.length === 0) return { items: [] as FeedItem[] };

    const [events, comments, badges, progresses] = await Promise.all([
      prisma.watchEvent.findMany({
        where: { userId: { in: ids }, eventType: { in: ['watched', 'favorited', 'added_to_watchlist'] } },
        include: { user: true, media: true, episode: true },
        orderBy: { eventDate: 'desc' },
        take: 40,
      }),
      // Seuls les commentaires RACINES alimentent le fil : une réponse hors de
      // son fil de discussion serait incompréhensible (et dupliquerait l'info).
      prisma.comment.findMany({
        where: { userId: { in: ids }, parentId: null },
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
      // Niveau + streak des comptes suivis, en une requête (pas de N+1).
      prisma.userProgress.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, level: true, currentStreak: true },
      }),
    ]);
    const progressById = new Map(progresses.map((p) => [p.userId, p]));
    const withLevel = (u: PublicUser): FeedItem['user'] => ({
      ...publicUser(u),
      level: progressById.get(u.id)?.level ?? 1,
      streak: progressById.get(u.id)?.currentStreak ?? 0,
    });

    // Réactions de TOUS les items en DEUX requêtes (pas de N+1) : les likes de
    // commentaires vivent dans CommentReaction (même store que l'écran
    // commentaires — un like posé depuis le feed y est visible et vice versa) ;
    // on agrège AUSSI les vieilles ActivityReaction 'comment' (données legacy).
    const [reactionRows, commentReactionRows] = await Promise.all([
      prisma.activityReaction.findMany({
        where: {
          OR: [
            { kind: 'watch', refId: { in: events.map((e) => e.id) } },
            { kind: 'comment', refId: { in: comments.map((c) => c.id) } },
            { kind: 'badge', refId: { in: badges.map((b) => b.id) } },
          ],
        },
        select: { kind: true, refId: true, userId: true, emoji: true },
      }),
      prisma.commentReaction.findMany({
        where: { commentId: { in: comments.map((c) => c.id) } },
        select: { commentId: true, userId: true, emoji: true },
      }),
    ]);
    const reactionsByTarget = new Map<string, FeedReactions>();
    const addReaction = (key: string, userId: string, emoji: string) => {
      const agg = reactionsByTarget.get(key) ?? { total: 0, mine: [], counts: {} };
      agg.total += 1;
      agg.counts[emoji] = (agg.counts[emoji] ?? 0) + 1;
      if (userId === request.userId && !agg.mine.includes(emoji)) agg.mine.push(emoji);
      reactionsByTarget.set(key, agg);
    };
    for (const r of reactionRows) addReaction(`${r.kind}:${r.refId}`, r.userId, r.emoji);
    for (const r of commentReactionRows) addReaction(`comment:${r.commentId}`, r.userId, r.emoji);
    const reactionsFor = (kind: ReactionKind, refId: string): FeedReactions =>
      reactionsByTarget.get(`${kind}:${refId}`) ?? { total: 0, mine: [], counts: {} };

    const items: FeedItem[] = [
      ...events.map((e): FeedItem => ({
        kind: 'watch',
        id: e.id,
        date: e.eventDate.toISOString(),
        eventType: e.eventType,
        user: withLevel(e.user),
        reactions: reactionsFor('watch', e.id),
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
        reactions: reactionsFor('comment', c.id),
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
        reactions: reactionsFor('badge', b.id),
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

  // Réaction emoji sur un item du fil (toggle, comme les réactions de
  // commentaires) : chaque emoji est indépendant. La cible est polymorphe.
  app.post('/api/social/feed/react', async (request, reply) => {
    const { kind, refId, emoji } = z
      .object({
        kind: z.enum(REACTION_KINDS),
        refId: z.string().min(1),
        emoji: z.string().min(1).max(8),
      })
      .parse(request.body);
    // La cible doit exister (WatchEvent/Comment/UserBadge selon le kind).
    const target =
      kind === 'watch'
        ? await prisma.watchEvent.findUnique({ where: { id: refId }, select: { id: true, userId: true } })
        : kind === 'comment'
          ? await prisma.comment.findUnique({ where: { id: refId }, select: { id: true, userId: true } })
          : await prisma.userBadge.findUnique({ where: { id: refId }, select: { id: true, userId: true } });
    if (!target) return reply.code(404).send({ error: 'not_found' });
    // Contrôle d'accès : on ne réagit qu'aux items de SON fil (soi-même ou un
    // compte suivi). Sans ce contrôle, l'endpoint servait d'oracle d'existence
    // d'ids et permettait de « pinger » n'importe quel compte. 404 UNIFORME
    // (même réponse que cible inexistante : ne révèle pas que l'id existe).
    if (target.userId !== request.userId) {
      const followingIds = await followingIdSet(request.userId);
      if (!followingIds.has(target.userId)) return reply.code(404).send({ error: 'not_found' });
    }

    // Toggle idempotent sous double-tap : deux requêtes simultanées passaient
    // toutes deux le findUnique (rien trouvé) puis create → P2002 → 500. On
    // traite le P2002 comme « déjà présent » → suppression (résultat net d'un
    // double toggle), et on supprime via deleteMany (jamais de P2025 en course).
    const toggle = async (): Promise<boolean> => {
      if (kind === 'comment') {
        // Les likes de commentaires vivent dans CommentReaction : même store
        // que POST /api/comments/:id/react, pour que l'écran commentaires et
        // le feed voient les mêmes réactions.
        const where = { commentId: refId, userId: request.userId, emoji };
        const existing = await prisma.commentReaction.findUnique({
          where: { commentId_userId_emoji: where },
        });
        if (existing) {
          await prisma.commentReaction.deleteMany({ where });
          return false;
        }
        try {
          await prisma.commentReaction.create({ data: where });
          return true;
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            await prisma.commentReaction.deleteMany({ where });
            return false;
          }
          throw err;
        }
      }
      const where = { kind, refId, userId: request.userId, emoji };
      const existing = await prisma.activityReaction.findUnique({
        where: { kind_refId_userId_emoji: where },
      });
      if (existing) {
        await prisma.activityReaction.deleteMany({ where });
        return false;
      }
      try {
        await prisma.activityReaction.create({ data: where });
        return true;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          await prisma.activityReaction.deleteMany({ where });
          return false;
        }
        throw err;
      }
    };
    const reacted = await toggle();
    // Total toutes emojis confondues sur la cible (kind 'comment' : store
    // CommentReaction + éventuelles ActivityReaction legacy, comme le feed).
    const count =
      kind === 'comment'
        ? (await prisma.commentReaction.count({ where: { commentId: refId } })) +
          (await prisma.activityReaction.count({ where: { kind, refId } }))
        : await prisma.activityReaction.count({ where: { kind, refId } });
    return { reacted, count };
  });

  // --- « Tes amis ont adoré » ---------------------------------------------
  // Médias notés ≥ 8 par mes abonnements (Rating de média OU note du statut),
  // hors médias déjà dans MA bibliothèque et hors utilisateurs bloqués.
  app.get('/api/social/recommendations', async (request) => {
    const lang = await getUserLang(request.userId);
    const [followingIds, blockedIds] = await Promise.all([
      followingIdSet(request.userId),
      blockedIdSet(request.userId),
    ]);
    const friendIds = [...followingIds].filter((id) => !blockedIds.has(id));
    if (friendIds.length === 0) return { items: [] };

    const [ratings, statuses, mine] = await Promise.all([
      prisma.rating.findMany({
        where: { userId: { in: friendIds }, episodeId: null, value: { gte: 8 } },
        select: { userId: true, mediaId: true, value: true },
      }),
      prisma.userMediaStatus.findMany({
        where: { userId: { in: friendIds }, rating: { gte: 8 } },
        select: { userId: true, mediaId: true, rating: true },
      }),
      prisma.userMediaStatus.findMany({ where: { userId: request.userId }, select: { mediaId: true } }),
    ]);
    const myMediaIds = new Set(mine.map((s) => s.mediaId));

    // Par média : note par fan (si Rating ET note de statut, on garde la max).
    const byMedia = new Map<string, Map<string, number>>();
    const add = (mediaId: string, userId: string, value: number) => {
      if (myMediaIds.has(mediaId)) return;
      const fans = byMedia.get(mediaId) ?? new Map<string, number>();
      fans.set(userId, Math.max(fans.get(userId) ?? 0, value));
      byMedia.set(mediaId, fans);
    };
    for (const r of ratings) add(r.mediaId, r.userId, r.value);
    for (const s of statuses) add(s.mediaId, s.userId, s.rating ?? 0);
    if (byMedia.size === 0) return { items: [] };

    const fanIds = [...new Set([...byMedia.values()].flatMap((fans) => [...fans.keys()]))];
    const [medias, fanUsers] = await Promise.all([
      prisma.media.findMany({ where: { id: { in: [...byMedia.keys()] } } }),
      prisma.user.findMany({
        where: { id: { in: fanIds } },
        select: { id: true, displayName: true, avatarUrl: true },
      }),
    ]);
    const mediaById = new Map(medias.map((m) => [m.id, m]));
    const fanById = new Map(fanUsers.map((u) => [u.id, u]));

    const items = [...byMedia.entries()]
      .flatMap(([mediaId, fanRatings]) => {
        const media = mediaById.get(mediaId);
        if (!media) return [];
        const values = [...fanRatings.values()];
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const fans = [...fanRatings.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([userId]) => ({
            userId,
            displayName: fanById.get(userId)?.displayName ?? '',
            avatarUrl: fanById.get(userId)?.avatarUrl ?? null,
          }));
        return [
          {
            media: { id: media.id, title: mediaTitle(media, lang), posterPath: media.posterPath, type: media.type },
            fans,
            avgRating: Math.round(avg * 10) / 10,
            fanCount: fanRatings.size,
          },
        ];
      })
      .sort((a, b) => b.fanCount - a.fanCount || b.avgRating - a.avgRating)
      .slice(0, 12);
    return { items };
  });

  // --- Défi hebdo ----------------------------------------------------------
  // Minutes vues depuis lundi 00:00 Europe/Paris, pour moi + mes abonnements.
  // Agrégation en SQL brut (pattern leaderboard) : épisodes via WatchEvent
  // 'watched' joints à Episode→Show→Media, films via le runtime du média.
  app.get('/api/social/challenge/weekly', async (request) => {
    const weekStart = mondayStartParis();
    // Blocage : les comptes que j'ai bloqués sortent de MON défi hebdo (même
    // règle que gamification/routes.ts — un vieux follow peut subsister).
    const [followingIds, blockedIds] = await Promise.all([
      followingIdSet(request.userId),
      blockedIdSet(request.userId),
    ]);
    const ids = [request.userId, ...[...followingIds].filter((id) => !blockedIds.has(id))];
    const [rows, users] = await Promise.all([
      prisma.$queryRaw<{ userId: string; minutes: bigint | number | null }[]>`
        SELECT we.userId AS userId,
               SUM(CASE
                     WHEN we.episodeId IS NOT NULL THEN
                       CASE WHEN e.runtime > 0 THEN e.runtime
                            WHEN sm.runtime > 0 THEN sm.runtime
                            ELSE ${EP_FALLBACK_MIN} END
                     WHEN med.type = 'movie' THEN
                       CASE WHEN med.runtime > 0 THEN med.runtime ELSE ${MOVIE_FALLBACK_MIN} END
                     ELSE 0
                   END) AS minutes
        FROM "WatchEvent" we
        JOIN "Media" med ON med.id = we.mediaId
        LEFT JOIN "Episode" e ON e.id = we.episodeId
        LEFT JOIN "Show" s ON s.id = e.showId
        LEFT JOIN "Media" sm ON sm.id = s.mediaId
        WHERE we.eventType = 'watched'
          AND we.userId IN (${Prisma.join(ids)})
          AND we.eventDate >= ${weekStart.getTime()}
        GROUP BY we.userId`,
      prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true, avatarUrl: true },
      }),
    ]);
    const minutesById = new Map(rows.map((r) => [r.userId, Number(r.minutes ?? 0)]));
    const entries = users
      .map((u) => ({
        userId: u.id,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        minutes: minutesById.get(u.id) ?? 0, // les 0 restent visibles
        isMe: u.id === request.userId,
      }))
      .sort((a, b) => b.minutes - a.minutes);
    return { weekStart: weekStart.toISOString(), entries };
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
    // Blocage : les commentaires ET réponses des utilisateurs que j'ai bloqués
    // disparaissent de ma vue (un Set chargé une fois, pas de N+1).
    const blockedIds = await blockedIdSet(request.userId);
    const all = (
      await prisma.comment.findMany({
        where: { mediaId: id, ...(episodeId ? { episodeId } : {}) },
        include: { user: true, reactions: true },
        orderBy: { createdAt: 'asc' },
      })
    ).filter((c) => !blockedIds.has(c.userId));
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
          'Hop hop hop ! 🙅 La politesse est de mise sur PlotTime, chenapan. Reformule ça sans insulte et réessaie 😇',
      });
    }
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    if (body.episodeId) {
      const ep = await prisma.episode.findUnique({
        where: { id: body.episodeId },
        select: { id: true, show: { select: { mediaId: true } } },
      });
      if (!ep) return reply.code(404).send({ error: 'episode_not_found' });
      // L'épisode doit appartenir au média de l'URL : sinon le commentaire
      // serait rattaché à une fiche mais affiché sous l'épisode d'une autre.
      if (ep.show.mediaId !== id) return reply.code(400).send({ error: 'episode_not_in_media' });
    }
    let parent: { id: string; userId: string } | null = null;
    if (body.parentId) {
      const p = await prisma.comment.findUnique({ where: { id: body.parentId } });
      if (!p || p.mediaId !== id) return reply.code(404).send({ error: 'parent_not_found' });
      // Un seul niveau de fil : on ne répond qu'à un commentaire RACINE.
      // (Une réponse à une réponse serait invisible — l'écran ne descend
      // qu'un niveau et le feed ne liste que les racines.)
      if (p.parentId) return reply.code(400).send({ error: 'parent_not_root' });
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
    // Les ActivityReaction pointent la cible par refId SANS FK (cible
    // polymorphe) : la cascade ne les supprime pas — purge explicite pour le
    // commentaire ET ses réponses, sinon elles resteraient orphelines.
    const replies = await prisma.comment.findMany({ where: { parentId: id }, select: { id: true } });
    await prisma.$transaction([
      prisma.activityReaction.deleteMany({
        where: { kind: 'comment', refId: { in: [id, ...replies.map((r) => r.id)] } },
      }),
      prisma.comment.delete({ where: { id } }), // supprime aussi les réponses (cascade)
    ]);
    return { ok: true };
  });

  // Réactions multiples : chaque emoji est indépendant (toggle par emoji).
  app.post('/api/comments/:id/react', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { emoji } = z.object({ emoji: z.string().min(1).max(8) }).parse(request.body);
    const comment = await prisma.comment.findUnique({ where: { id } });
    if (!comment) return reply.code(404).send({ error: 'not_found' });
    // Toggle idempotent sous double-tap (voir feed/react) : un P2002 en course
    // est traité comme « déjà présent » → suppression, jamais de 500.
    const where = { commentId: id, userId: request.userId, emoji };
    const existing = await prisma.commentReaction.findUnique({
      where: { commentId_userId_emoji: where },
    });
    if (existing) {
      await prisma.commentReaction.deleteMany({ where });
      return { ok: true, reacted: false };
    }
    try {
      await prisma.commentReaction.create({ data: where });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        await prisma.commentReaction.deleteMany({ where });
        return { ok: true, reacted: false };
      }
      throw err;
    }
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
