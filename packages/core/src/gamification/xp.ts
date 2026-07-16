import type { GamificationStats } from './types.js';

// Barème XP (spec §1). `episodeDayOne` est la valeur TOTALE (10 base + 10
// bonus), pas seulement le bonus — un épisode "jour J" ne compte jamais
// aussi dans `episode`.
export const XP_RULES = {
  episode: 10,
  episodeDayOne: 20,
  movie: 30,
  gameCompleted: 100,
  showCompleted: 200,
  comment: 5,
  challenge: 100,
} as const;

// XP total recalculé depuis les compteurs (recompute idempotent, spec §0/§1).
// `dayOneEpisodes` est un sous-ensemble de `episodesWatched` : on retire donc
// ces épisodes du barème standard avant d'appliquer le barème "jour J".
export function totalXp(stats: GamificationStats): number {
  const standardEpisodes = Math.max(0, stats.episodesWatched - stats.dayOneEpisodes);
  return (
    standardEpisodes * XP_RULES.episode +
    stats.dayOneEpisodes * XP_RULES.episodeDayOne +
    stats.moviesWatched * XP_RULES.movie +
    stats.gamesCompleted * XP_RULES.gameCompleted +
    stats.showsCompleted * XP_RULES.showCompleted +
    stats.comments * XP_RULES.comment +
    stats.challengesDone * XP_RULES.challenge
  );
}

// Progression quadratique (spec §2) : niveau 10 = 5 000 XP, niveau 30 =
// 45 000 XP, niveau 60 = 180 000 XP.
export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(xp / 50)));
}

// XP requis pour atteindre le niveau suivant (barre de progression).
export function nextLevelXp(level: number): number {
  return 50 * (level + 1) ** 2;
}

// Titre du plus haut palier atteint (spec §2, paliers ordonnés croissants).
const LEVEL_TITLES: { level: number; title: string }[] = [
  { level: 1, title: 'Novice' },
  { level: 5, title: 'Curieux du dimanche' },
  { level: 10, title: 'Sérievore' },
  { level: 15, title: 'Accro au générique' },
  { level: 20, title: 'Binge-watcheur' },
  { level: 25, title: "Boulimique d'épisodes" },
  { level: 30, title: 'Marathonien' },
  { level: 40, title: 'Critique confirmé' },
  { level: 50, title: 'Encyclopédie vivante' },
  { level: 60, title: 'Légende du canapé' },
  { level: 75, title: 'Maître du temps' },
  { level: 90, title: 'Immortel du petit écran' },
];

export function levelTitle(level: number): string {
  let title = 'Novice';
  for (const entry of LEVEL_TITLES) {
    if (level < entry.level) break;
    title = entry.title;
  }
  return title;
}
