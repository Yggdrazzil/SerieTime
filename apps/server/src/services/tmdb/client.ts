import { env } from '../../config/env.js';
import { prisma } from '../../db/client.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';

export function tmdbEnabled(): boolean {
  return Boolean(env.TMDB_API_KEY || env.TMDB_READ_ACCESS_TOKEN);
}

// Spec §16.4 : jamais d'appel live à chaque affichage — cache ApiCache obligatoire.
async function cachedFetch<T>(path: string, params: Record<string, string>, ttlMs: number): Promise<T | null> {
  if (!tmdbEnabled()) return null;
  const search = new URLSearchParams({ language: env.DEFAULT_LANGUAGE, ...params });
  if (env.TMDB_API_KEY) search.set('api_key', env.TMDB_API_KEY);
  const cacheKey = `${path}?${search.toString()}`;

  const cached = await prisma.apiCache.findUnique({
    where: { source_cacheKey: { source: 'tmdb', cacheKey } },
  });
  if (cached && cached.expiresAt > new Date()) {
    return JSON.parse(cached.responseJson) as T;
  }

  const headers: Record<string, string> = {};
  if (!env.TMDB_API_KEY && env.TMDB_READ_ACCESS_TOKEN) {
    headers['Authorization'] = `Bearer ${env.TMDB_READ_ACCESS_TOKEN}`;
  }
  try {
    const res = await fetch(`${TMDB_BASE}${path}?${search.toString()}`, { headers });
    if (!res.ok) return cached ? (JSON.parse(cached.responseJson) as T) : null;
    const data = (await res.json()) as T;
    await prisma.apiCache.upsert({
      where: { source_cacheKey: { source: 'tmdb', cacheKey } },
      create: {
        source: 'tmdb',
        cacheKey,
        responseJson: JSON.stringify(data),
        expiresAt: new Date(Date.now() + ttlMs),
      },
      update: { responseJson: JSON.stringify(data), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return data;
  } catch {
    return cached ? (JSON.parse(cached.responseJson) as T) : null;
  }
}

const DAY = 86_400_000;

export type TmdbSearchResult = {
  id: number;
  media_type?: string;
  name?: string;
  title?: string;
  original_name?: string;
  original_title?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string;
  release_date?: string;
  popularity?: number;
  vote_average?: number;
  genre_ids?: number[];
  original_language?: string;
  origin_country?: string[];
};

export async function tmdbSearch(
  query: string,
  type: 'tv' | 'movie' | 'multi',
  year?: number,
): Promise<TmdbSearchResult[]> {
  const params: Record<string, string> = { query };
  if (year && type === 'movie') params['year'] = String(year);
  if (year && type === 'tv') params['first_air_date_year'] = String(year);
  const data = await cachedFetch<{ results: TmdbSearchResult[] }>(`/search/${type}`, params, 7 * DAY);
  return (data?.results ?? []).filter((r) => type !== 'multi' || r.media_type === 'tv' || r.media_type === 'movie');
}

export async function tmdbSearchPerson(query: string): Promise<unknown[]> {
  const data = await cachedFetch<{ results: unknown[] }>(`/search/person`, { query }, 7 * DAY);
  return data?.results ?? [];
}

export async function tmdbFindByExternalId(
  externalId: string,
  source: 'tvdb_id' | 'imdb_id',
): Promise<{ tv_results: TmdbSearchResult[]; movie_results: TmdbSearchResult[] } | null> {
  return cachedFetch(`/find/${externalId}`, { external_source: source }, 30 * DAY);
}

export type TmdbShowDetails = {
  id: number;
  name: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string;
  status?: string;
  in_production?: boolean;
  number_of_seasons?: number;
  number_of_episodes?: number;
  episode_run_time?: number[];
  genres?: { id: number; name: string }[];
  networks?: { name: string }[];
  origin_country?: string[];
  original_language?: string;
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  external_ids?: { tvdb_id?: number | null; imdb_id?: string | null };
  seasons?: {
    id: number;
    season_number: number;
    name?: string;
    overview?: string;
    poster_path?: string | null;
    air_date?: string;
    episode_count?: number;
  }[];
  next_episode_to_air?: { air_date?: string } | null;
  last_episode_to_air?: { air_date?: string } | null;
};

export async function tmdbShowDetails(tmdbId: string, ended: boolean): Promise<TmdbShowDetails | null> {
  return cachedFetch(`/tv/${tmdbId}`, { append_to_response: 'external_ids' }, (ended ? 90 : 3) * DAY);
}

export type TmdbSeasonDetails = {
  season_number: number;
  episodes?: {
    id: number;
    season_number: number;
    episode_number: number;
    name?: string;
    overview?: string;
    still_path?: string | null;
    air_date?: string;
    runtime?: number | null;
  }[];
};

export async function tmdbSeasonDetails(
  tmdbShowId: string,
  seasonNumber: number,
  ended: boolean,
): Promise<TmdbSeasonDetails | null> {
  return cachedFetch(`/tv/${tmdbShowId}/season/${seasonNumber}`, {}, (ended ? 90 : 1) * DAY);
}

export type TmdbMovieDetails = {
  id: number;
  title: string;
  original_title?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  runtime?: number | null;
  status?: string;
  genres?: { id: number; name: string }[];
  original_language?: string;
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  imdb_id?: string | null;
  homepage?: string | null;
};

export async function tmdbMovieDetails(tmdbId: string): Promise<TmdbMovieDetails | null> {
  return cachedFetch(`/movie/${tmdbId}`, {}, 180 * DAY);
}

export type TmdbCredits = {
  cast?: { id: number; name: string; character?: string; profile_path?: string | null; order?: number }[];
};

export async function tmdbCredits(type: 'tv' | 'movie', tmdbId: string): Promise<TmdbCredits | null> {
  return cachedFetch(`/${type}/${tmdbId}/credits`, {}, 30 * DAY);
}

export type TmdbProviders = {
  results?: Record<
    string,
    {
      link?: string;
      flatrate?: { provider_name: string; logo_path?: string | null }[];
      rent?: { provider_name: string; logo_path?: string | null }[];
      buy?: { provider_name: string; logo_path?: string | null }[];
    }
  >;
};

export async function tmdbWatchProviders(type: 'tv' | 'movie', tmdbId: string): Promise<TmdbProviders | null> {
  return cachedFetch(`/${type}/${tmdbId}/watch/providers`, {}, 7 * DAY);
}

export async function tmdbRecommendations(type: 'tv' | 'movie', tmdbId: string): Promise<TmdbSearchResult[]> {
  const data = await cachedFetch<{ results: TmdbSearchResult[] }>(`/${type}/${tmdbId}/recommendations`, {}, 7 * DAY);
  return data?.results ?? [];
}

export async function tmdbTrending(type: 'tv' | 'movie', page = 1): Promise<TmdbSearchResult[]> {
  const data = await cachedFetch<{ results: TmdbSearchResult[] }>(
    `/trending/${type}/week`,
    page > 1 ? { page: String(page) } : {},
    1 * DAY,
  );
  return data?.results ?? [];
}

// Découverte ciblée : sert à remplir chaque catégorie du flux Explorer (ex. les
// animés, quasi absents des « tendances »). `genres` = ids TMDb, `language` =
// langue d'origine (ex. 'ja' pour l'anime japonais).
export async function tmdbDiscover(
  type: 'tv' | 'movie',
  opts: {
    genres?: number[];
    language?: string;
    page?: number;
    sort?: string;
    // Fenêtre d'années (incluse) pour varier les époques du flux Explorer.
    yearGte?: number;
    yearLte?: number;
  } = {},
): Promise<TmdbSearchResult[]> {
  const params: Record<string, string> = {
    sort_by: opts.sort ?? 'popularity.desc',
    page: String(opts.page ?? 1),
    'vote_count.gte': '20',
  };
  if (opts.genres?.length) params.with_genres = opts.genres.join(',');
  if (opts.language) params.with_original_language = opts.language;
  const dateField = type === 'tv' ? 'first_air_date' : 'primary_release_date';
  if (opts.yearGte) params[`${dateField}.gte`] = `${opts.yearGte}-01-01`;
  if (opts.yearLte) params[`${dateField}.lte`] = `${opts.yearLte}-12-31`;
  const data = await cachedFetch<{ results: TmdbSearchResult[] }>(`/discover/${type}`, params, 1 * DAY);
  return data?.results ?? [];
}

export async function tmdbVideos(type: 'tv' | 'movie', tmdbId: string): Promise<{ results?: { site?: string; type?: string; key?: string }[] } | null> {
  return cachedFetch(`/${type}/${tmdbId}/videos`, {}, 30 * DAY);
}
