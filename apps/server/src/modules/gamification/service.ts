// Gamification — collecte des stats + recompute idempotent (spec 2026-07-16 §9).
// Tout est recalculé depuis les données existantes : jamais d'incrément à la
// main, donc l'import TV Time donne l'XP rétroactivement et un recompute
// supplémentaire ne change rien (idempotence).
import {
  BADGES,
  badgeProgress,
  computeStreaks,
  evaluateBadges,
  evaluateChallenge,
  levelForXp,
  levelTitle,
  monthlyChallenges,
  nextLevelXp,
  totalXp,
  type GamificationStats,
  type MonthStats,
} from '@serietime/core';
import { prisma } from '../../db/client.js';
import { dayKeyParis, monthKeyParis, parisMidnightUtc, weekStartParis } from '../../lib/parisTime.js';

// Repères Europe/Paris : logique partagée dans lib/parisTime.ts (réutilisée par
// les stats détaillées). Ré-exportés ici pour les consommateurs historiques.
export { dayKeyParis, monthKeyParis, weekStartParis };

// Max d'épisodes vus dans une fenêtre glissante de 24 h (deux pointeurs, O(n)).
function maxInSlidingDay(timestamps: number[]): number {
  const sorted = [...timestamps].sort((a, b) => a - b);
  let best = 0;
  let left = 0;
  for (let right = 0; right < sorted.length; right++) {
    while ((sorted[right] as number) - (sorted[left] as number) > 86_400_000) left++;
    if (right - left + 1 > best) best = right - left + 1;
  }
  return best;
}

function splitGenres(raw: string | null | undefined): string[] {
  return (raw ?? '').split(',').map((g) => g.trim()).filter(Boolean);
}

type Collected = {
  stats: GamificationStats;
  currentStreak: number;
  monthStats: MonthStats;
};

// Requêtes MINIMALES : counts + colonnes seules (`watchedAt`, `genres`…) — la
// plus grosse bibliothèque dépasse 20 000 épisodes vus, on ne charge JAMAIS de
// lignes complètes. Retourne null si l'utilisateur n'existe pas (supprimé
// entre le débounce et l'exécution).
async function collect(userId: string, now = new Date()): Promise<Collected | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  if (!user) return null;

  const monthStart = parisMidnightUtc(`${monthKeyParis(now)}-01`);

  const [
    episodesWatched,
    watchedRows,
    moviesWatched,
    gamesCompleted,
    showsCompleted,
    movieDays,
    genreRows,
    followers,
    comments,
    reactionsReceived,
    challengesDone,
    showsCompletedThisMonth,
    mediaAddedThisMonth,
  ] = await Promise.all([
    prisma.userEpisodeStatus.count({ where: { userId, status: 'watched' } }),
    prisma.userEpisodeStatus.findMany({
      where: { userId, status: 'watched', watchedAt: { not: null } },
      select: { watchedAt: true, episode: { select: { airDate: true } } },
    }),
    prisma.userMediaStatus.count({ where: { userId, status: 'completed', media: { type: 'movie' } } }),
    prisma.userMediaStatus.count({ where: { userId, status: 'completed', media: { type: 'game' } } }),
    prisma.userMediaStatus.count({ where: { userId, status: 'completed', media: { type: 'show' } } }),
    prisma.userMediaStatus.findMany({
      where: { userId, status: 'completed', media: { type: 'movie' } },
      select: { completedAt: true, lastWatchedAt: true },
    }),
    prisma.userMediaStatus.findMany({ where: { userId }, select: { media: { select: { genres: true } } } }),
    prisma.follow.count({ where: { followingId: userId } }),
    prisma.comment.count({ where: { userId } }),
    // Réactions reçues sur ses commentaires, hors auto-réactions.
    prisma.commentReaction.count({ where: { comment: { userId }, userId: { not: userId } } }),
    prisma.userChallenge.count({ where: { userId } }),
    prisma.userMediaStatus.count({
      where: { userId, status: 'completed', media: { type: 'show' }, completedAt: { gte: monthStart } },
    }),
    prisma.userMediaStatus.count({ where: { userId, createdAt: { gte: monthStart } } }),
  ]);

  // Jour J, fenêtre 24 h, jours actifs et défi « marathon » : une seule passe
  // sur les timestamps d'épisodes vus.
  const monthKey = monthKeyParis(now);
  const activeDays = new Set<string>();
  const timestamps: number[] = [];
  let dayOneEpisodes = 0;
  let episodesThisMonth = 0;
  for (const row of watchedRows) {
    const watchedAt = row.watchedAt as Date;
    const day = dayKeyParis(watchedAt);
    activeDays.add(day);
    timestamps.push(watchedAt.getTime());
    if (day.startsWith(monthKey)) episodesThisMonth++;
    if (row.episode.airDate && dayKeyParis(row.episode.airDate) === day) dayOneEpisodes++;
  }
  // Un film coché compte aussi comme jour actif (spec §4).
  for (const m of movieDays) {
    const date = m.completedAt ?? m.lastWatchedAt;
    if (date) activeDays.add(dayKeyParis(date));
  }

  const genres = new Set<string>();
  for (const row of genreRows) for (const g of splitGenres(row.media.genres)) genres.add(g);

  const streaks = computeStreaks([...activeDays].sort(), dayKeyParis(now));

  return {
    stats: {
      episodesWatched,
      dayOneEpisodes,
      moviesWatched,
      gamesCompleted,
      showsCompleted,
      maxEpisodes24h: maxInSlidingDay(timestamps),
      distinctGenres: genres.size,
      followers,
      comments,
      reactionsReceived,
      bestStreak: streaks.best,
      accountCreatedAt: user.createdAt.toISOString(),
      challengesDone,
    },
    currentStreak: streaks.current,
    monthStats: { episodesThisMonth, showsCompletedThisMonth, mediaAddedThisMonth },
  };
}

export async function collectStats(userId: string): Promise<GamificationStats> {
  const collected = await collect(userId);
  if (!collected) throw new Error(`user_not_found: ${userId}`);
  return collected.stats;
}

const TIER_LABELS = ['', 'bronze', 'argent', 'or', 'platine'];

// Recompute complet + persistance : défis accomplis, XP/niveau, badges,
// UserProgress, et notifications pour les NOUVEAUTÉS uniquement. Au tout
// premier calcul d'un utilisateur (pas encore de UserProgress — backfill,
// import initial), tout est posé silencieusement : pas de spam de 15 notifs.
// Sérialisation par utilisateur : deux recomputes concurrents (binge de coches
// + backfill, ou deux actions quasi simultanées) liraient en parallèle le même
// `existingBadges`/`existingProgress` et enverraient les notifications level_up
// /badge EN DOUBLE. On chaîne donc les recomputes d'un même user : le suivant
// attend la fin du précédent (qui a déjà persisté les nouveaux paliers), si
// bien que le diff est vu une seule fois.
const recomputeChain = new Map<string, Promise<void>>();

export function recomputeUser(userId: string, now = new Date()): Promise<void> {
  const previous = recomputeChain.get(userId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => recomputeUserInner(userId, now));
  recomputeChain.set(userId, next);
  void next.finally(() => {
    // Libère l'entrée seulement si personne n'a chaîné après nous.
    if (recomputeChain.get(userId) === next) recomputeChain.delete(userId);
  });
  return next;
}

async function recomputeUserInner(userId: string, now = new Date()): Promise<void> {
  const collected = await collect(userId, now);
  if (!collected) return;
  const { stats, currentStreak, monthStats } = collected;

  const existingProgress = await prisma.userProgress.findUnique({ where: { userId } });
  const isFirstCompute = !existingProgress;

  // Défis du mois courant : insère les accomplis manquants (idempotent).
  const existingChallenges = await prisma.userChallenge.findMany({ where: { userId }, select: { challengeId: true } });
  const doneIds = new Set(existingChallenges.map((c) => c.challengeId));
  const newChallenges = monthlyChallenges(monthKeyParis(now)).filter(
    (def) => !doneIds.has(def.id) && evaluateChallenge(def, monthStats).completed,
  );
  if (newChallenges.length > 0) {
    await prisma.userChallenge.createMany({ data: newChallenges.map((def) => ({ userId, challengeId: def.id })) });
    stats.challengesDone += newChallenges.length;
  }

  const xp = totalXp(stats);
  const level = levelForXp(xp);

  // Badges : diff avec l'existant, insère les nouveaux paliers.
  const existingBadges = await prisma.userBadge.findMany({ where: { userId }, select: { badgeId: true, tier: true } });
  const owned = new Set(existingBadges.map((b) => `${b.badgeId}:${b.tier}`));
  const newBadges = evaluateBadges(stats).filter((b) => !owned.has(`${b.badgeId}:${b.tier}`));
  if (newBadges.length > 0) {
    await prisma.userBadge.createMany({ data: newBadges.map((b) => ({ userId, badgeId: b.badgeId, tier: b.tier })) });
  }

  await prisma.userProgress.upsert({
    where: { userId },
    create: { userId, xp, level, currentStreak, bestStreak: stats.bestStreak },
    update: { xp, level, currentStreak, bestStreak: stats.bestStreak },
  });

  if (isFirstCompute) return;

  // Notifications — uniquement les nouveautés de CE recompute.
  const date = now;
  const notifications: { userId: string; type: string; title: string; body?: string; date: Date; metadataJson: string }[] = [];
  if (level > existingProgress.level) {
    notifications.push({
      userId,
      type: 'level_up',
      title: `Niveau ${level} !`,
      body: 'Continue comme ça.',
      date,
      metadataJson: JSON.stringify({ level }),
    });
  }
  for (const b of newBadges) {
    const def = BADGES.find((d) => d.id === b.badgeId);
    if (!def) continue;
    notifications.push({
      userId,
      type: 'badge_unlocked',
      title: `Badge débloqué : ${def.label}`,
      body: `Palier ${TIER_LABELS[b.tier] ?? b.tier} — ${def.description.toLowerCase()}.`,
      date,
      metadataJson: JSON.stringify({ badgeId: b.badgeId, tier: b.tier }),
    });
  }
  for (const def of newChallenges) {
    notifications.push({
      userId,
      type: 'challenge_completed',
      title: 'Défi du mois accompli !',
      body: `${def.label} — +100 XP.`,
      date,
      metadataJson: JSON.stringify({ challengeId: def.id }),
    });
  }
  if (notifications.length > 0) await prisma.notification.createMany({ data: notifications });
}

// Vue `/api/gamification/me` : recompute LÉGER à la volée — collect + calculs
// purs, AUCUNE écriture (ni badge, ni défi, ni notification). Les écritures et
// notifications restent l'apanage du recompute débouncé post-action : si /me
// persistait les nouveaux badges, le recompute suivant ne verrait plus de diff
// et les notifications seraient perdues.
export async function meView(userId: string, now = new Date()) {
  const collected = await collect(userId, now);
  if (!collected) return null;
  const { stats, currentStreak, monthStats } = collected;

  const [badgeRows, challengeRows] = await Promise.all([
    prisma.userBadge.findMany({ where: { userId }, select: { badgeId: true, tier: true, unlockedAt: true } }),
    prisma.userChallenge.findMany({ where: { userId }, select: { challengeId: true } }),
  ]);
  const doneIds = new Set(challengeRows.map((c) => c.challengeId));

  // Défis du mois : état live, fusionné avec les accomplissements déjà persistés.
  const challenges = monthlyChallenges(monthKeyParis(now)).map((def) => {
    const live = evaluateChallenge(def, monthStats);
    const completed = live.completed || doneIds.has(def.id);
    return {
      id: def.id,
      label: def.label,
      target: def.target,
      progress: completed ? def.target : live.progress,
      completed,
    };
  });
  // XP : compte aussi les défis accomplis en live pas encore persistés.
  stats.challengesDone = doneIds.size + challenges.filter((c) => c.completed && !doneIds.has(c.id)).length;

  const xp = totalXp(stats);
  const level = levelForXp(xp);

  // Badges : TOUT le catalogue (tier 0 si rien), palier live + date de
  // déblocage du plus haut palier persisté.
  const tiers = new Map<string, number>();
  for (const b of evaluateBadges(stats)) tiers.set(b.badgeId, Math.max(tiers.get(b.badgeId) ?? 0, b.tier));
  const progressById = new Map(badgeProgress(stats).map((p) => [p.badgeId, p]));
  const badges = BADGES.map((def) => {
    const tier = tiers.get(def.id) ?? 0;
    const unlockedAt = badgeRows
      .filter((row) => row.badgeId === def.id && row.tier <= tier)
      .reduce<Date | null>((max, row) => (max && max > row.unlockedAt ? max : row.unlockedAt), null);
    const progress = progressById.get(def.id);
    return {
      id: def.id,
      label: def.label,
      description: def.description,
      icon: def.icon,
      tier,
      tierCount: def.thresholds.length,
      unlockedAt: unlockedAt ? unlockedAt.toISOString() : null,
      progress: progress?.value ?? 0,
      nextThreshold: progress?.nextThreshold ?? null,
    };
  });

  return {
    xp,
    level,
    levelTitle: levelTitle(level),
    nextLevelXp: nextLevelXp(level),
    currentStreak,
    bestStreak: stats.bestStreak,
    badges,
    challenges,
  };
}

// Débounce par utilisateur : les actions en rafale (binge de coche, réponse
// de l'app) ne déclenchent qu'un recompute. Fire-and-forget, échec silencieux.
const pendingRecomputes = new Map<string, NodeJS.Timeout>();
const RECOMPUTE_DEBOUNCE_MS = 750;

export function scheduleRecompute(userId: string): void {
  const existing = pendingRecomputes.get(userId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingRecomputes.delete(userId);
    void recomputeUser(userId).catch(() => undefined);
  }, RECOMPUTE_DEBOUNCE_MS);
  // Ne retient jamais le process (tests, arrêt du serveur).
  timer.unref?.();
  pendingRecomputes.set(userId, timer);
}

// Backfill au démarrage : premier calcul (silencieux) pour tous les
// utilisateurs sans UserProgress. Fire-and-forget, séquentiel pour ne pas
// saturer SQLite.
export async function backfillAllUsers(): Promise<void> {
  const users = await prisma.user.findMany({ where: { progress: null }, select: { id: true } });
  for (const user of users) {
    await recomputeUser(user.id).catch(() => undefined);
  }
}
