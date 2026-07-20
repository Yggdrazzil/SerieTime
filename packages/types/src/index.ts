export type MediaType = 'show' | 'movie' | 'game';

export type UserMediaState =
  | 'watching'
  | 'completed'
  | 'watchlist'
  | 'paused'
  | 'abandoned'
  | 'not_started';

export type EpisodeState = 'watched' | 'unwatched';

export type ImportStatus = 'uploaded' | 'analyzed' | 'imported' | 'failed';

export type MatchStatus = 'matched_auto' | 'matched_manual' | 'unresolved' | 'ignored';

export type NormalizedImportedMedia = {
  source: 'tvtime';
  sourceRawId?: string;
  sourceUrl?: string;
  mediaType: 'show' | 'movie' | 'unknown';
  title: string;
  originalTitle?: string;
  year?: number;
  tvdbId?: string;
  tmdbId?: string;
  imdbId?: string;
  status?: string;
  rating?: number;
  isFavorite?: boolean;
  addedAt?: string;
  watchedAt?: string;
  listNames?: string[];
  raw: unknown;
};

export type NormalizedImportedEpisode = {
  source: 'tvtime';
  showTitle: string;
  episodeTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  absoluteNumber?: number;
  watchedAt?: string;
  rating?: number;
  tvdbShowId?: string;
  tvdbEpisodeId?: string;
  tmdbShowId?: string;
  tmdbEpisodeId?: string;
  raw: unknown;
};

export type ImportAnalysisSummary = {
  showsDetected: number;
  moviesDetected: number;
  episodesWatchedDetected: number;
  ratingsDetected: number;
  favoritesDetected: number;
  listsDetected: number;
  autoImport: number;
  toVerify: number;
  unresolved: number;
  duplicatesIgnored: number;
  files: { path: string; kind: string; rows: number }[];
};

export type MediaDto = {
  id: string;
  type: MediaType;
  title: string;
  originalTitle?: string | null;
  overview?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  year?: number | null;
  firstAirDate?: string | null;
  releaseDate?: string | null;
  status?: string | null;
  runtime?: number | null;
  genres?: string | null;
  voteAverage?: number | null;
  tmdbId?: string | null;
  tvdbId?: string | null;
  imdbId?: string | null;
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
  runtime?: number | null;
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
  // Progression de visionnage de la série (épisodes diffusés hors spéciaux),
  // même sémantique que /api/shows (bibliothèque). Optionnel : absent tant que
  // le serveur n'est pas redéployé — le client masque alors la barre.
  progress?: { watched: number; total: number };
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
  // Détail par statut (tuiles du profil). Optionnels : absents tant que le
  // serveur n'est pas redéployé — le client replie alors sur `gamesPlayed`.
  gamesPlaying?: number;
  gamesCompleted?: number;
  // Temps de jeu total en minutes (déclaratif + Steam). Optionnel : absent
  // tant que le serveur n'est pas redéployé.
  gamePlaytimeMinutes?: number;
};

export type ListDto = {
  id: string;
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  posterPaths: string[];
  itemCount: number;
  containsMediaId?: boolean;
};

export type UnresolvedMappingDto = {
  id: string;
  sourceTitle: string;
  sourceType: string;
  year?: number | null;
  externalIds: { tvdbId?: string; tmdbId?: string; imdbId?: string };
  matchScore?: number | null;
  matchStatus: MatchStatus;
  suggestions: { mediaId?: string; tmdbId?: string; title: string; year?: number; posterPath?: string; score: number }[];
};
