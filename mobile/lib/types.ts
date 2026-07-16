export type MediaType = 'show' | 'movie' | 'game';
// Tri des pages « préférés » (feuille TRIER PAR, façon TV Time).
export type FavSortKey = 'user' | 'recent' | 'oldest' | 'az' | 'za';
export type UserMediaState =
  | 'watching' | 'completed' | 'watchlist' | 'paused' | 'abandoned' | 'not_started';

export type MediaDto = {
  id: string;
  type: MediaType;
  title: string;
  overview?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  year?: number | null;
  status?: string | null;
  runtime?: number | null;
  genres?: string | null;
  voteAverage?: number | null;
  tmdbId?: string | null;
  userStatus?: UserMediaState | null;
  isFavorite?: boolean;
  // Ordre personnalisé + date d'ajout aux favoris (pages « préférés »).
  favoriteOrder?: number | null;
  favoritedAt?: string | null;
  rating?: number | null;
};

export type EpisodeDto = {
  id: string;
  showId: string;
  showMediaId: string;
  showTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  absoluteNumber?: number | null;
  title: string;
  overview?: string | null;
  stillPath?: string | null;
  airDate?: string | null;
  airTime?: string | null;
  network?: string | null;
  watched: boolean;
  watchedAt?: string | null;
};

export type QueueItemDto = {
  group: 'a_voir' | 'pas_regarde_depuis_un_moment' | 'pas_commence' | 'abandonne';
  media: MediaDto;
  nextEpisode: EpisodeDto | null;
  remainingCount: number;
  badges: ('PREMIERE' | 'NOUVEAU' | 'PLUS_RECENT')[];
};

export type UpcomingItemDto = {
  media: MediaDto;
  episodes: EpisodeDto[];
  date: string;
};

export type ProfileStatsDto = {
  showsCount: number;
  moviesCount: number;
  ratingsCount: number;
  episodesWatched: number;
  moviesWatched: number;
  showMinutes: number;
  movieMinutes: number;
  // Jeux vidéo : suivis + « joués » (en cours ou terminés).
  gamesCount: number;
  gamesPlayed: number;
};

// Gamification (spec 2026-07-16 §9/§10) — miroir de GET /api/gamification/me.
export type BadgeDto = {
  id: string;
  label: string;
  description: string;
  // Nom d'icône Feather (parfois Ionicons côté catalogue serveur, ex. « game-controller »,
  // « flame » : à faire passer par un fallback « award » côté rendu, cf. mobile/app/trophies.tsx).
  icon: string;
  tier: number; // 0 = pas encore débloqué, sinon index du palier atteint
  tierCount: number;
  unlockedAt: string | null;
  progress: number;
  nextThreshold: number | null; // null = palier max atteint
};

export type ChallengeDto = {
  id: string;
  label: string;
  target: number;
  progress: number;
  completed: boolean;
};

export type GamificationMeDto = {
  xp: number;
  level: number;
  levelTitle: string;
  nextLevelXp: number;
  currentStreak: number;
  bestStreak: number;
  badges: BadgeDto[];
  challenges: ChallengeDto[];
};

export type LeaderboardRowDto = {
  user: { id: string; displayName: string; avatarUrl: string | null; level: number };
  weeklyXp: number;
  rank: number;
};
