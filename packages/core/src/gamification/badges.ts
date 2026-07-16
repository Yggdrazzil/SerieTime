import type { GamificationStats } from './types.js';

export type BadgeDef = {
  id: string;
  label: string;
  description: string;
  icon: string;
  thresholds: number[];
  measure: (stats: GamificationStats) => number;
};

// Pionnier : compte créé avant la sortie officielle (spec §3). Comparaison
// temporelle ; un `accountCreatedAt` absent ou invalide n'est jamais pionnier.
export const PIONEER_DEADLINE = '2026-12-31T23:59:59Z';

function isPioneer(stats: GamificationStats): number {
  if (!stats.accountCreatedAt) return 0;
  const created = new Date(stats.accountCreatedAt).getTime();
  if (Number.isNaN(created)) return 0;
  return created < new Date(PIONEER_DEADLINE).getTime() ? 1 : 0;
}

// Catalogue en dur (spec §3) : id stable, seuils par palier bronze→argent→or→platine.
export const BADGES: BadgeDef[] = [
  {
    id: 'episodes',
    label: 'Boulimique',
    description: 'Épisodes vus',
    icon: 'tv',
    thresholds: [10, 100, 1_000, 10_000],
    measure: (stats) => stats.episodesWatched,
  },
  {
    id: 'movies',
    label: 'Cinéphile',
    description: 'Films vus',
    icon: 'film',
    thresholds: [5, 50, 500],
    measure: (stats) => stats.moviesWatched,
  },
  {
    id: 'games',
    label: 'Joueur accompli',
    description: 'Jeux terminés',
    icon: 'game-controller',
    thresholds: [1, 10, 50],
    measure: (stats) => stats.gamesCompleted,
  },
  {
    id: 'finisher',
    label: 'Finisseur',
    description: 'Séries terminées à 100 %',
    icon: 'check-circle',
    thresholds: [1, 10, 50],
    measure: (stats) => stats.showsCompleted,
  },
  {
    id: 'day_one',
    label: 'Jour J',
    description: 'Épisodes vus le jour de leur diffusion',
    icon: 'zap',
    thresholds: [1, 10, 100],
    measure: (stats) => stats.dayOneEpisodes,
  },
  {
    id: 'marathon',
    label: 'Marathonien',
    description: "Max d'épisodes vus en 24 h glissantes",
    icon: 'activity',
    thresholds: [10, 20, 40],
    measure: (stats) => stats.maxEpisodes24h,
  },
  {
    id: 'explorer',
    label: 'Explorateur',
    description: 'Genres distincts dans les médias vus',
    icon: 'compass',
    thresholds: [5, 10, 20],
    measure: (stats) => stats.distinctGenres,
  },
  {
    id: 'popular',
    label: 'Célébrité',
    description: 'Abonnés',
    icon: 'users',
    thresholds: [1, 10, 100],
    measure: (stats) => stats.followers,
  },
  {
    id: 'commentator',
    label: 'Commentateur',
    description: 'Commentaires postés',
    icon: 'message-circle',
    thresholds: [1, 25, 100],
    measure: (stats) => stats.comments,
  },
  {
    id: 'beloved',
    label: 'Adoré',
    description: 'Réactions reçues sur ses commentaires',
    icon: 'heart',
    thresholds: [10, 100, 1_000],
    measure: (stats) => stats.reactionsReceived,
  },
  {
    id: 'streak',
    label: 'Assidu',
    description: 'Meilleur streak (jours consécutifs)',
    icon: 'flame',
    thresholds: [7, 30, 100],
    measure: (stats) => stats.bestStreak,
  },
  {
    id: 'pioneer',
    label: 'Pionnier',
    description: 'Compte créé avant la sortie officielle',
    icon: 'star',
    thresholds: [1],
    measure: isPioneer,
  },
];

// Tous les paliers atteints (tier 1-indexé), pas seulement le plus haut : un
// nouveau déblocage doit pouvoir notifier chaque palier franchi d'un coup
// (ex : import rétroactif qui fait sauter bronze + argent en même temps).
export function evaluateBadges(stats: GamificationStats): { badgeId: string; tier: number }[] {
  const unlocked: { badgeId: string; tier: number }[] = [];
  for (const badge of BADGES) {
    const value = badge.measure(stats);
    badge.thresholds.forEach((threshold, index) => {
      if (value >= threshold) unlocked.push({ badgeId: badge.id, tier: index + 1 });
    });
  }
  return unlocked;
}

// Progression vers le prochain palier non atteint ; `nextThreshold: null` au
// palier maximum (badge entièrement débloqué).
export function badgeProgress(
  stats: GamificationStats,
): { badgeId: string; value: number; nextThreshold: number | null }[] {
  return BADGES.map((badge) => {
    const value = badge.measure(stats);
    const nextThreshold = badge.thresholds.find((threshold) => threshold > value) ?? null;
    return { badgeId: badge.id, value, nextThreshold };
  });
}
