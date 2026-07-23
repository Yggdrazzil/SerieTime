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
import { dayKeyParis } from '../../lib/parisTime.js';
import { createTtlCache } from '../../lib/ttlCache.js';

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

// Caches TTL des agrégations sociales lourdes (voir lib/ttlCache.ts — Map
// bornée, désactivés en test). Clé = userId appelant : ces vues dépendent de
// MES abonnements/blocages. TTL courts : la fraîcheur à la minute suffit pour
// des recommandations et un défi hebdo, et ça absorbe les rafales de l'onglet
// Communauté (chaque ouverture rejouait des scans complets de l'historique).
const recommendationsCache = createTtlCache<unknown>(300_000);
const weeklyChallengeCache = createTtlCache<unknown>(60_000);

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

// Garde anti-spoiler : lire/écrire les commentaires d'un épisode exige de
// l'avoir marqué VU (UserEpisodeStatus). Empêche le spoiler et le scraping.
async function hasWatchedEpisode(userId: string, episodeId: string): Promise<boolean> {
  const s = await prisma.userEpisodeStatus.findUnique({
    where: { userId_episodeId: { userId, episodeId } },
    select: { status: true },
  });
  return s?.status === 'watched';
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

  // --- Bibliothèque intégrale d'un utilisateur -----------------------------
  // Tout ce qu'il suit/a vu pour UN type de média (show|movie|game), paginé
  // par curseur. Mêmes règles de visibilité que GET /api/users/:id, avec un
  // cran de plus : la bibliothèque COMPLÈTE est plus sensible que l'aperçu du
  // profil, donc si le profil consulté M'A bloqué → 404 (même réponse qu'un id
  // inconnu, pas de fuite d'information).
  app.get('/api/users/:id/library', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        type: z.enum(['show', 'movie', 'game']),
        cursor: z.string().optional(),
        take: z.coerce.number().int().min(1).max(60).default(30),
      })
      .safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });
    const { type, cursor, take } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: 'not_found' });
    const isSelf = id === request.userId;
    if (!isSelf) {
      const blockedByTarget = await prisma.block.findUnique({
        where: { blockerId_blockedId: { blockerId: id, blockedId: request.userId } },
      });
      if (blockedByTarget) return reply.code(404).send({ error: 'not_found' });
    }
    const isFollowing =
      !isSelf &&
      !!(await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: request.userId, followingId: id } },
      }));
    // Profil privé non suivi : refus explicite (le client affiche l'invitation
    // à s'abonner) — cohérent avec `restricted` du profil public.
    if (user.isPrivate && !isSelf && !isFollowing) return reply.code(403).send({ error: 'restricted' });

    const lang = await getUserLang(request.userId);
    const where = { userId: id, isHidden: false, media: { type } };
    // Tri stable pour le curseur : dernier visionnage d'abord (nulls en fin),
    // puis dernière mise à jour, et id en départage.
    const orderBy = [
      { lastWatchedAt: { sort: 'desc' as const, nulls: 'last' as const } },
      { updatedAt: 'desc' as const },
      { id: 'desc' as const },
    ];
    // take+1 : la ligne excédentaire signale seulement qu'une page suit.
    const [rows, total] = await Promise.all([
      prisma.userMediaStatus.findMany({
        where,
        include: { media: true },
        orderBy,
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      prisma.userMediaStatus.count({ where }),
    ]);
    const page = rows.slice(0, take);
    return {
      items: page.map((s) => ({
        media: {
          id: s.media.id,
          title: mediaTitle(s.media, lang),
          posterPath: s.media.posterPath,
          type: s.media.type,
          year: s.media.year,
        },
        status: s.status,
        rating: s.rating,
        isFavorite: s.isFavorite,
      })),
      nextCursor: rows.length > take ? (page[page.length - 1]?.id ?? null) : null,
      total,
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

  // --- QG Communauté (refonte) --------------------------------------------
  // Vue agrégée de l'onglet Communauté en UNE requête HTTP : « En ce moment »
  // (dernier visionnage de chaque ami), « Récemment vus » (groupé anti-spam
  // par ami × média × jour Paris) et « Derniers badges ». Toutes les requêtes
  // sont BORNÉES (fenêtres temporelles + take) et batchées (pas de N+1).
  app.get('/api/social/overview', async (request) => {
    const lang = await getUserLang(request.userId);
    const [followingIds, blockedIds] = await Promise.all([
      followingIdSet(request.userId),
      blockedIdSet(request.userId),
    ]);
    const friendIds = [...followingIds].filter((id) => !blockedIds.has(id));
    if (friendIds.length === 0) return { now: [], recent: [], badges: [] };

    const since7d = new Date(Date.now() - 7 * 86_400_000);
    const since14d = new Date(Date.now() - 14 * 86_400_000);

    // « En ce moment » : le DERNIER WatchEvent 'watched' par ami. Un groupBy
    // (borné à 15 amis, index [userId, eventDate]) donne les couples
    // (ami, dernière date), puis les événements sont rechargés en un findMany.
    const latestPerFriend = await prisma.watchEvent.groupBy({
      by: ['userId'],
      where: { userId: { in: friendIds }, eventType: 'watched' },
      _max: { eventDate: true },
      orderBy: { _max: { eventDate: 'desc' } },
      take: 15,
    });
    const latestPairs = latestPerFriend.flatMap((g) =>
      g._max.eventDate ? [{ userId: g.userId, eventDate: g._max.eventDate }] : [],
    );

    const [nowEvents, recentEvents, badgeRows] = await Promise.all([
      latestPairs.length === 0
        ? []
        : prisma.watchEvent.findMany({
            where: { eventType: 'watched', OR: latestPairs },
            include: { user: true, media: true, episode: true },
            orderBy: { eventDate: 'desc' },
            take: 60, // garde-fou (égalités de date) — dédupliqué par ami ci-dessous
          }),
      // « Récemment vus » : fenêtre 7 jours, plafond dur d'événements bruts.
      prisma.watchEvent.findMany({
        where: { userId: { in: friendIds }, eventType: 'watched', eventDate: { gte: since7d } },
        include: { user: true, media: true, episode: true },
        orderBy: { eventDate: 'desc' },
        take: 500,
      }),
      prisma.userBadge.findMany({
        where: { userId: { in: friendIds }, unlockedAt: { gte: since14d } },
        include: { user: true },
        orderBy: { unlockedAt: 'desc' },
        take: 20,
      }),
    ]);

    // 1 entrée par ami (le plus récent) — les égalités de date sont dédupliquées.
    const seenNow = new Set<string>();
    const nowDeduped = nowEvents
      .filter((e) => (seenNow.has(e.userId) ? false : (seenNow.add(e.userId), true)))
      .slice(0, 15);

    // Agrégation anti-spam : (ami, média, jour Paris) → 1 groupe. Les événements
    // arrivent triés eventDate desc : le premier vu d'un groupe est son plus
    // récent (refId cible des kudos, lastAt), et l'ordre d'insertion des groupes
    // est déjà l'ordre lastAt desc.
    const groups = new Map<string, { event: (typeof recentEvents)[number]; count: number }>();
    for (const e of recentEvents) {
      const key = `${e.userId}:${e.mediaId}:${dayKeyParis(e.eventDate)}`;
      const g = groups.get(key);
      if (g) g.count += 1;
      else groups.set(key, { event: e, count: 1 });
    }
    const recentGroups = [...groups.values()].slice(0, 30);

    // Nombre d'épisodes RÉEL des groupes séries, depuis UserEpisodeStatus :
    // un marquage en masse (mark-all-watched, watched-previous) upserte N
    // statuts mais ne crée qu'UN événement média-niveau — compter les
    // événements affichait « a vu 1 épisode » au lieu de N. On agrège les
    // statuts (ami, série, jour Paris) en une requête bornée (fenêtre 7 j,
    // amis + médias des groupes affichés). Les WatchEvents restent la source
    // de l'ordre et du refId kudos. Fallback : groupe sans statut ce jour-là
    // (données legacy, épisodes décochés depuis) → comptage par événements.
    const recentShowMediaIds = [
      ...new Set(recentGroups.filter((g) => g.event.media.type === 'show').map((g) => g.event.mediaId)),
    ];
    const epStatusRows =
      recentShowMediaIds.length === 0
        ? []
        : await prisma.userEpisodeStatus.findMany({
            where: {
              userId: { in: [...new Set(recentGroups.map((g) => g.event.userId))] },
              status: 'watched',
              watchedAt: { gte: since7d },
              episode: { show: { mediaId: { in: recentShowMediaIds } } },
            },
            select: { userId: true, watchedAt: true, episode: { select: { show: { select: { mediaId: true } } } } },
          });
    const epCountByGroup = new Map<string, number>();
    for (const r of epStatusRows) {
      if (!r.watchedAt) continue;
      const key = `${r.userId}:${r.episode.show.mediaId}:${dayKeyParis(r.watchedAt)}`;
      epCountByGroup.set(key, (epCountByGroup.get(key) ?? 0) + 1);
    }

    // Niveau + streak de tous les utilisateurs affichés, en UNE requête.
    const progress = await progressMap([
      ...new Set([...nowDeduped, ...recentGroups.map((g) => g.event), ...badgeRows].map((x) => x.userId)),
    ]);
    const overviewUser = (u: PublicUser) => ({
      id: u.id,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      level: progress.get(u.id)?.level ?? 1,
      streak: progress.get(u.id)?.currentStreak ?? 0,
    });
    const mediaOf = (m: (typeof recentEvents)[number]['media']) => ({
      id: m.id,
      title: mediaTitle(m, lang),
      posterPath: m.posterPath,
      type: m.type,
    });

    // Réactions (kudos) de tous les refIds en UNE requête ActivityReaction.
    const reactionRows = await prisma.activityReaction.findMany({
      where: {
        OR: [
          { kind: 'watch', refId: { in: recentGroups.map((g) => g.event.id) } },
          { kind: 'badge', refId: { in: badgeRows.map((b) => b.id) } },
        ],
      },
      select: { kind: true, refId: true, userId: true, emoji: true },
    });
    const reactionsByRef = new Map<string, { total: number; mine: string[] }>();
    for (const r of reactionRows) {
      const key = `${r.kind}:${r.refId}`;
      const agg = reactionsByRef.get(key) ?? { total: 0, mine: [] };
      agg.total += 1;
      if (r.userId === request.userId && !agg.mine.includes(r.emoji)) agg.mine.push(r.emoji);
      reactionsByRef.set(key, agg);
    }
    const reactionsFor = (kind: ReactionKind, refId: string) =>
      reactionsByRef.get(`${kind}:${refId}`) ?? { total: 0, mine: [] as string[] };

    return {
      now: nowDeduped.map((e) => ({
        user: overviewUser(e.user),
        media: mediaOf(e.media),
        episode: e.episode
          ? { seasonNumber: e.episode.seasonNumber, episodeNumber: e.episode.episodeNumber }
          : null,
        lastAt: e.eventDate.toISOString(),
      })),
      recent: recentGroups.map(({ event: e, count }) => {
        // Séries : nb d'épisodes du jour depuis UserEpisodeStatus (les
        // marquages en masse ne créent qu'un événement) ; films/jeux : nb
        // d'événements (1 par visionnage).
        const epCount =
          e.media.type === 'show'
            ? epCountByGroup.get(`${e.userId}:${e.mediaId}:${dayKeyParis(e.eventDate)}`) ?? 0
            : 0;
        return {
          user: overviewUser(e.user),
          media: mediaOf(e.media),
          day: dayKeyParis(e.eventDate),
          count: epCount > 0 ? epCount : count,
          refId: e.id, // WatchEvent le plus récent du groupe → cible kudos (kind 'watch')
          reactions: reactionsFor('watch', e.id),
        };
      }),
      badges: badgeRows.map((b) => ({
        user: overviewUser(b.user),
        badge: {
          id: b.badgeId,
          label: BADGES.find((def) => def.id === b.badgeId)?.label ?? b.badgeId,
          tier: b.tier,
        },
        unlockedAt: b.unlockedAt.toISOString(),
        refId: b.id, // UserBadge.id → cible kudos (kind 'badge')
        reactions: reactionsFor('badge', b.id),
      })),
    };
  });

  // Fils de discussion où mes amis sont actifs (14 derniers jours), groupés
  // par média. Anti-spoiler : ni texte des commentaires ni numéros d'épisode
  // dans la liste — l'utilisateur ouvre la fiche pour lire.
  app.get('/api/social/discussions', async (request) => {
    const lang = await getUserLang(request.userId);
    const [followingIds, blockedIds] = await Promise.all([
      followingIdSet(request.userId),
      blockedIdSet(request.userId),
    ]);
    const friendIds = [...followingIds].filter((id) => !blockedIds.has(id));
    if (friendIds.length === 0) return { threads: [] };

    const since14d = new Date(Date.now() - 14 * 86_400_000);
    // Racines ET réponses comptent comme activité (borné : fenêtre + take).
    const comments = await prisma.comment.findMany({
      where: { userId: { in: friendIds }, createdAt: { gte: since14d } },
      include: { user: true, media: true },
      orderBy: { createdAt: 'desc' },
      take: 400,
    });

    type Thread = {
      media: (typeof comments)[number]['media'];
      commentCount: number;
      participants: Map<string, PublicUser>;
      lastAt: Date;
    };
    // Commentaires triés desc : le premier d'un média fixe lastAt (le plus
    // récent) et l'ordre d'insertion des fils est déjà l'ordre lastAt desc.
    const byMedia = new Map<string, Thread>();
    for (const c of comments) {
      const t =
        byMedia.get(c.mediaId) ??
        ({ media: c.media, commentCount: 0, participants: new Map(), lastAt: c.createdAt } satisfies Thread);
      t.commentCount += 1;
      if (!t.participants.has(c.userId) && t.participants.size < 3) t.participants.set(c.userId, c.user);
      byMedia.set(c.mediaId, t);
    }
    return {
      threads: [...byMedia.values()].slice(0, 20).map((t) => ({
        media: { id: t.media.id, title: mediaTitle(t.media, lang), posterPath: t.media.posterPath, type: t.media.type },
        commentCount: t.commentCount,
        participants: [...t.participants.values()].map((u) => ({
          id: u.id,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
        })),
        lastAt: t.lastAt.toISOString(),
      })),
    };
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
    // mediaId (quand la cible en a un) sert au deep-link de la notification kudos.
    const target: { id: string; userId: string; mediaId?: string } | null =
      kind === 'watch'
        ? await prisma.watchEvent.findUnique({ where: { id: refId }, select: { id: true, userId: true, mediaId: true } })
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
    // Kudos : notifier le propriétaire à la CRÉATION seulement (jamais au
    // retrait). Kind 'comment' exclu : les likes de commentaires ont déjà leur
    // notification 'comment_reaction' via POST /api/comments/:id/react — le
    // chemin feed n'en crée pas non plus, pour ne pas doubler le flux existant.
    // Guard owner === moi (réagir à sa propre activité est autorisé) ; le
    // filtre blocage est déjà dans notifyUser.
    if (reacted && kind !== 'comment' && target.userId !== request.userId) {
      const me = await prisma.user.findUnique({ where: { id: request.userId }, select: { displayName: true } });
      const actorName = me?.displayName ?? 'Quelqu’un';
      await notifyUser(target.userId, request.userId, {
        type: 'reaction',
        title: kind === 'badge' ? `${actorName} a salué ton badge` : `${actorName} a salué ton activité`,
        mediaId: target.mediaId,
      });
    }
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
    const cachedReco = recommendationsCache.get(request.userId);
    if (cachedReco) return cachedReco;
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
    if (byMedia.size === 0) {
      const empty = { items: [] };
      recommendationsCache.set(request.userId, empty);
      return empty;
    }

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
    const result = { items };
    recommendationsCache.set(request.userId, result);
    return result;
  });

  // --- Défi hebdo ----------------------------------------------------------
  // Minutes vues depuis lundi 00:00 Europe/Paris, pour moi + mes abonnements.
  // Agrégation en SQL brut (pattern leaderboard stats) sur les STATUTS, pas
  // sur les WatchEvents : un marquage en masse (mark-all-watched,
  // watched-previous) upserte N UserEpisodeStatus mais ne crée qu'UN SEUL
  // événement média-niveau — compter les événements sous-comptait donc les
  // saisons cochées d'un coup (~0 min au lieu de N × runtime). Séries via
  // UserEpisodeStatus.watchedAt, films via UserMediaStatus.completedAt (posé
  // par POST /api/movies/:id/watched, remis à null par /unwatched).
  app.get('/api/social/challenge/weekly', async (request) => {
    const cachedWeekly = weeklyChallengeCache.get(request.userId);
    if (cachedWeekly) return cachedWeekly;
    const weekStart = mondayStartParis();
    // Blocage : les comptes que j'ai bloqués sortent de MON défi hebdo (même
    // règle que gamification/routes.ts — un vieux follow peut subsister).
    const [followingIds, blockedIds] = await Promise.all([
      followingIdSet(request.userId),
      blockedIdSet(request.userId),
    ]);
    const ids = [request.userId, ...[...followingIds].filter((id) => !blockedIds.has(id))];
    const [epRows, mvRows, users] = await Promise.all([
      prisma.$queryRaw<{ userId: string; minutes: bigint | number | null }[]>`
        SELECT ues.userId AS userId,
               SUM(CASE WHEN e.runtime > 0 THEN e.runtime
                        WHEN m.runtime > 0 THEN m.runtime
                        ELSE ${EP_FALLBACK_MIN} END) AS minutes
        FROM "UserEpisodeStatus" ues
        JOIN "Episode" e ON e.id = ues.episodeId
        JOIN "Show" s ON s.id = e.showId
        JOIN "Media" m ON m.id = s.mediaId
        WHERE ues.status = 'watched'
          AND ues.userId IN (${Prisma.join(ids)})
          AND ues.watchedAt >= ${weekStart.getTime()}
        GROUP BY ues.userId`,
      prisma.$queryRaw<{ userId: string; minutes: bigint | number | null }[]>`
        SELECT ums.userId AS userId,
               SUM(CASE WHEN m.runtime > 0 THEN m.runtime ELSE ${MOVIE_FALLBACK_MIN} END) AS minutes
        FROM "UserMediaStatus" ums
        JOIN "Media" m ON m.id = ums.mediaId
        WHERE ums.status = 'completed'
          AND m.type = 'movie'
          AND ums.userId IN (${Prisma.join(ids)})
          AND ums.completedAt >= ${weekStart.getTime()}
        GROUP BY ums.userId`,
      prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true, avatarUrl: true },
      }),
    ]);
    const minutesById = new Map<string, number>();
    for (const r of [...epRows, ...mvRows]) {
      minutesById.set(r.userId, (minutesById.get(r.userId) ?? 0) + Number(r.minutes ?? 0));
    }
    const entries = users
      .map((u) => ({
        userId: u.id,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        minutes: minutesById.get(u.id) ?? 0, // les 0 restent visibles
        isMe: u.id === request.userId,
      }))
      .sort((a, b) => b.minutes - a.minutes);
    const result = { weekStart: weekStart.toISOString(), entries };
    weeklyChallengeCache.set(request.userId, result);
    return result;
  });

  // --- Confidentialité -----------------------------------------------------
  app.post('/api/social/privacy', async (request) => {
    const { isPrivate } = z.object({ isPrivate: z.boolean() }).parse(request.body);
    await prisma.user.update({ where: { id: request.userId }, data: { isPrivate } });
    return { ok: true, isPrivate };
  });

  // --- Commentaires (avec fils de discussion) + réactions -----------------
  app.get('/api/media/:id/comments', async (request, reply) => {
    const { id } = request.params as { id: string };
    // `take` : borne le nombre de commentaires RACINES renvoyés (leurs réponses
    // suivent toujours). Le mobile n'envoie rien → défaut 100 : un fil de
    // discussion viral ne charge plus tout l'historique d'un coup. La forme de
    // la réponse ({ comments: [...] }) est inchangée.
    const { episodeId, take } = z
      .object({
        episodeId: z.string().optional(),
        take: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(request.query ?? {});
    // Anti-spoiler : le fil d'un épisode n'est lisible que si on l'a vu.
    if (episodeId && !(await hasWatchedEpisode(request.userId, episodeId))) {
      return reply.code(403).send({ error: 'episode_not_watched' });
    }
    const rootTake = take ?? 100;
    // Blocage : les commentaires ET réponses des utilisateurs que j'ai bloqués
    // disparaissent de ma vue (un Set chargé une fois, pas de N+1).
    const blockedIds = await blockedIdSet(request.userId);
    // Racines d'abord (plus récentes en premier, bornées), puis LEURS réponses
    // uniquement — au lieu de charger tous les commentaires du média. Comme
    // avant, les réponses d'une racine bloquée disparaissent avec elle.
    const roots = (
      await prisma.comment.findMany({
        where: { mediaId: id, parentId: null, ...(episodeId ? { episodeId } : { episodeId: null }) },
        include: { user: true, reactions: true },
        orderBy: { createdAt: 'desc' },
        take: rootTake,
      })
    ).filter((c) => !blockedIds.has(c.userId));
    const replies = roots.length
      ? (
          await prisma.comment.findMany({
            // Même filtre episodeId que la requête d'origine (qui portait sur
            // racines ET réponses) : le comportement visible ne change pas.
            where: { parentId: { in: roots.map((c) => c.id) }, ...(episodeId ? { episodeId } : { episodeId: null }) },
            include: { user: true, reactions: true },
            orderBy: { createdAt: 'asc' },
          })
        ).filter((c) => !blockedIds.has(c.userId))
      : [];
    const me = request.userId;
    const serialize = (c: (typeof roots)[number]) => ({
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
    for (const c of replies) {
      if (!c.parentId) continue;
      const arr = repliesByParent.get(c.parentId) ?? [];
      arr.push(serialize(c));
      repliesByParent.set(c.parentId, arr);
    }
    // Commentaires racines, plus récents d'abord ; réponses en ordre chronologique.
    const comments = roots.map((c) => ({ ...serialize(c), replies: repliesByParent.get(c.id) ?? [] }));
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
      // Anti-spoiler : on ne poste (commentaire OU réponse) sur un épisode que
      // si on l'a vu.
      if (!(await hasWatchedEpisode(request.userId, body.episodeId))) {
        return reply.code(403).send({ error: 'episode_not_watched' });
      }
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
