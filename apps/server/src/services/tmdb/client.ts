import { env } from '../../config/env.js';
import { prisma } from '../../db/client.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';

export function tmdbEnabled(): boolean {
  return Boolean(env.TMDB_API_KEY || env.TMDB_READ_ACCESS_TOKEN);
}

// Spec §16.4 : jamais d'appel live à chaque affichage — cache ApiCache obligatoire.
async function cachedFetch<T>(path: string, params: Record<string, string>, ttlMs: number): Promise<T | null> {
  if (!tmdbEnabled()) return null;
  // include_adult=false par défaut sur TOUTES les requêtes (TMDb ignore le
  // paramètre là où il ne s'applique pas). Ceinture ; les bretelles = filtrage
  // `adult === true` côté mapping (search/feed).
  const search = new URLSearchParams({ include_adult: 'false', language: env.DEFAULT_LANGUAGE, ...params });
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

// Langues de contenu proposées dans les Paramètres (hors fr, langue par défaut
// du serveur : env.DEFAULT_LANGUAGE). Clé = code app, valeur = code TMDb.
export const CONTENT_LANGS = ['en', 'es', 'de', 'it', 'pt'] as const;
export type ContentLang = (typeof CONTENT_LANGS)[number];
const TMDB_LANGUAGE: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-PT',
};

// Paramètre `language` TMDb pour une langue de contenu utilisateur.
// fr (ou langue inconnue) → {} : cachedFetch garde env.DEFAULT_LANGUAGE.
export function tmdbLangParam(lang?: string | null): Record<string, string> {
  const code = lang ? TMDB_LANGUAGE[lang] : undefined;
  return code ? { language: code } : {};
}

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
  // Contenu pour adultes (porno) : exclu du flux et de la recherche.
  adult?: boolean;
};

export async function tmdbSearch(
  query: string,
  type: 'tv' | 'movie' | 'multi',
  year?: number,
  lang?: string,
  // Utilisateur 18+ : `include_adult=true` (surchargé PAR APPEL et donc partie
  // de la clé de cache — un compte adulte n'empoisonne pas le cache des autres).
  allowAdult = false,
): Promise<TmdbSearchResult[]> {
  const params: Record<string, string> = { query, ...tmdbLangParam(lang), ...(allowAdult ? { include_adult: 'true' } : {}) };
  if (year && type === 'movie') params['year'] = String(year);
  if (year && type === 'tv') params['first_air_date_year'] = String(year);
  const data = await cachedFetch<{ results: TmdbSearchResult[] }>(`/search/${type}`, params, 7 * DAY);
  return (data?.results ?? []).filter((r) => type !== 'multi' || r.media_type === 'tv' || r.media_type === 'movie');
}

export async function tmdbSearchPerson(query: string): Promise<unknown[]> {
  const data = await cachedFetch<{ results: unknown[] }>(`/search/person`, { query }, 7 * DAY);
  return data?.results ?? [];
}

// Fiche personne (acteur/doubleur) : détails + réseaux + filmographie complète.
// La bio française est souvent vide sur TMDb : on garde la langue par défaut et
// le client affiche ce qui existe (TV Time affiche aussi la bio anglaise).
export type TmdbPersonCredit = {
  id: number;
  media_type?: string;
  name?: string;
  title?: string;
  character?: string;
  poster_path?: string | null;
  first_air_date?: string;
  release_date?: string;
  episode_count?: number;
  genre_ids?: number[];
  vote_average?: number;
  popularity?: number;
};
export type TmdbPerson = {
  id: number;
  name: string;
  biography?: string;
  birthday?: string | null;
  deathday?: string | null;
  place_of_birth?: string | null;
  profile_path?: string | null;
  external_ids?: { twitter_id?: string | null; instagram_id?: string | null };
  combined_credits?: { cast?: TmdbPersonCredit[] };
};
export async function tmdbPerson(tmdbId: string): Promise<TmdbPerson | null> {
  return cachedFetch(`/person/${tmdbId}`, { append_to_response: 'external_ids,combined_credits' }, 30 * DAY);
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

export async function tmdbRecommendations(
  type: 'tv' | 'movie',
  tmdbId: string,
  lang?: string,
  allowAdult = false,
): Promise<TmdbSearchResult[]> {
  const data = await cachedFetch<{ results: TmdbSearchResult[] }>(
    `/${type}/${tmdbId}/recommendations`,
    { ...tmdbLangParam(lang), ...(allowAdult ? { include_adult: 'true' } : {}) },
    7 * DAY,
  );
  return data?.results ?? [];
}

export async function tmdbTrending(type: 'tv' | 'movie', page = 1, lang?: string, allowAdult = false): Promise<TmdbSearchResult[]> {
  const data = await cachedFetch<{ results: TmdbSearchResult[] }>(
    `/trending/${type}/week`,
    { ...(page > 1 ? { page: String(page) } : {}), ...tmdbLangParam(lang), ...(allowAdult ? { include_adult: 'true' } : {}) },
    1 * DAY,
  );
  return data?.results ?? [];
}

// Traductions d'une fiche (une seule requête TMDb pour TOUTES les langues).
export type TmdbTranslationsResponse = {
  translations?: {
    iso_639_1?: string;
    data?: { name?: string; title?: string; overview?: string };
  }[];
};

export async function tmdbTranslations(
  type: 'tv' | 'movie',
  tmdbId: string,
): Promise<TmdbTranslationsResponse | null> {
  return cachedFetch(`/${type}/${tmdbId}/translations`, {}, 7 * DAY);
}

// Mots-clés TMDb pornographiques : ids récupérés DYNAMIQUEMENT via
// GET /search/keyword (le catalogue de mots-clés TMDb bouge), pour être passés
// en `without_keywords` sur /discover (exclusion À LA SOURCE). Double cache :
// ApiCache (via cachedFetch, 30 j) + mémoire process (évite de relire ApiCache
// à chaque discover).
//
// BUG HISTORIQUE corrigé : on retenait TOUS les résultats flous de
// /search/keyword — « hentai » ramenait aussi sentai/senpai/mental, « porno »
// ramenait « porco » (Porco Rosso). On excluait donc EN SILENCE des animés
// légitimes. Désormais on n'accepte QUE les correspondances de NOM EXACT
// (insensible casse/espaces) contre une liste curée de noms pornographiques.
const ADULT_KEYWORD_QUERIES = ['hentai', 'pornography', 'pornographic', 'porn', 'porno', 'softcore', 'hardcore', 'eroge', 'sex film', 'erotic', 'ecchi'];
// Noms EXACTS acceptés (normalisés : casse, espaces réduits). « erotic » seul
// N'EST PAS ici (grand public — cf. « erotic thriller ») : il est traité à part
// et n'est appliqué qu'aux viviers ANIMÉS.
const ADULT_KEYWORD_EXACT = new Set([
  'hentai', 'pornography', 'pornographic', 'pornographic video', 'pornographic animation',
  'porn', 'porno', 'softcore', 'hardcore porn', 'sex film', 'erotic movie', 'eroge',
]);
// Mots-clés appliqués aux VIVIERS ANIMÉS uniquement (pas au live-action) :
// « erotic » (le hentai y est souvent taggé sans l'être « hentai ») et « ecchi »
// (fan-service 18+). Traités à part car « erotic » seul est grand public hors
// anime (« erotic thriller »).
const ANIME_ONLY_EXACT = new Set(['erotic', 'ecchi']);
const normKeyword = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

type AdultKeywords = { pornIds: string[]; animeOnlyIds: string[] };
let adultKeywordCache: { data: AdultKeywords; expiresAt: number } | null = null;

async function loadAdultKeywords(): Promise<AdultKeywords> {
  if (!tmdbEnabled()) return { pornIds: [], animeOnlyIds: [] };
  if (adultKeywordCache && adultKeywordCache.expiresAt > Date.now()) return adultKeywordCache.data;
  const pornIds = new Set<string>();
  const animeOnlyIds = new Set<string>();
  for (const term of ADULT_KEYWORD_QUERIES) {
    const data = await cachedFetch<{ results?: { id: number; name?: string }[] }>('/search/keyword', { query: term }, 30 * DAY);
    for (const k of data?.results ?? []) {
      const name = normKeyword(k.name ?? '');
      if (ADULT_KEYWORD_EXACT.has(name)) pornIds.add(String(k.id));
      if (ANIME_ONLY_EXACT.has(name)) animeOnlyIds.add(String(k.id));
    }
  }
  const result: AdultKeywords = { pornIds: [...pornIds], animeOnlyIds: [...animeOnlyIds] };
  adultKeywordCache = { data: result, expiresAt: Date.now() + 30 * DAY };
  return result;
}

// Ids des mots-clés PORNO (famille non ambiguë) pour `without_keywords`.
export async function getAdultKeywordIds(): Promise<string[]> {
  return (await loadAdultKeywords()).pornIds;
}

// Ids des mots-clés réservés aux viviers ANIMÉS (« erotic » + « ecchi »),
// ajoutés à leur `without_keywords`. Le premier est renvoyé pour rétro-compat
// des tests ; l'exclusion réelle utilise `animeOnlyIds` dans tmdbDiscover.
export async function getEroticKeywordId(): Promise<string | null> {
  return (await loadAdultKeywords()).animeOnlyIds[0] ?? null;
}

// Noms des mots-clés d'une fiche (vérification par item du hentai) : /tv/{id}/keywords
// (champ `results`) ou /movie/{id}/keywords (champ `keywords`). Caché 30 j.
export async function tmdbKeywordNames(type: 'tv' | 'movie', tmdbId: string): Promise<string[]> {
  const data = await cachedFetch<{ results?: { name?: string }[]; keywords?: { name?: string }[] }>(
    `/${type}/${tmdbId}/keywords`,
    {},
    30 * DAY,
  );
  const arr = type === 'tv' ? data?.results : data?.keywords;
  return (arr ?? []).map((k) => k.name ?? '').filter((n): n is string => n.length > 0);
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
    // Langue de contenu de l'utilisateur (titres/résumés des résultats).
    lang?: string;
    // Utilisateur 18+ : débraye tout le filtrage adulte (include_adult=true,
    // pas de without_keywords). Partie de la clé de cache → pas de contamination.
    allowAdult?: boolean;
    // Vivier ANIMÉ (genres:[16]/language:'ja') : ajoute le mot-clé EXACT
    // « erotic » au without_keywords (en plus de la famille porno) — le hentai
    // est souvent taggé « erotic ». N'a PAS d'effet quand allowAdult.
    excludeErotic?: boolean;
  } = {},
): Promise<TmdbSearchResult[]> {
  const params: Record<string, string> = {
    sort_by: opts.sort ?? 'popularity.desc',
    page: String(opts.page ?? 1),
    'vote_count.gte': '20',
    ...tmdbLangParam(opts.lang),
  };
  if (opts.genres?.length) params.with_genres = opts.genres.join(',');
  if (opts.language) params.with_original_language = opts.language;
  if (opts.allowAdult) {
    params.include_adult = 'true';
  } else {
    // Exclusion à la source du porno : /discover supporte `without_keywords`.
    const { pornIds, animeOnlyIds } = await loadAdultKeywords();
    const adultKw = [...pornIds];
    // Viviers animés : on écarte aussi « erotic » et « ecchi » (18+ suggestif),
    // jamais sur le live-action (pas d'`excludeErotic` là-bas).
    if (opts.excludeErotic) adultKw.push(...animeOnlyIds);
    if (adultKw.length) params.without_keywords = adultKw.join(',');
  }
  const dateField = type === 'tv' ? 'first_air_date' : 'primary_release_date';
  if (opts.yearGte) params[`${dateField}.gte`] = `${opts.yearGte}-01-01`;
  if (opts.yearLte) params[`${dateField}.lte`] = `${opts.yearLte}-12-31`;
  const data = await cachedFetch<{ results: TmdbSearchResult[] }>(`/discover/${type}`, params, 1 * DAY);
  return data?.results ?? [];
}

export async function tmdbVideos(type: 'tv' | 'movie', tmdbId: string): Promise<{ results?: { site?: string; type?: string; key?: string }[] } | null> {
  return cachedFetch(`/${type}/${tmdbId}/videos`, {}, 30 * DAY);
}
