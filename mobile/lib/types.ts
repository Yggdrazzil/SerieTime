export type MediaType = 'show' | 'movie';
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
};
