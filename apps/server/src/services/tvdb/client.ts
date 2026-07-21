import { env } from '../../config/env.js';
import { prisma } from '../../db/client.js';

// Client TheTVDB v4 (https://thetvdb.github.io/v4-api/).
// Auth : POST /login { apikey, pin? } -> JWT valable ~1 mois, mis en cache mémoire.
// Les réponses GET sont mises en cache en base (ApiCache) comme pour TMDb.
const TVDB_BASE = 'https://api4.thetvdb.com/v4';
const DAY = 86_400_000;

export function tvdbEnabled(): boolean {
  return env.TVDB_ENABLED && env.TVDB_API_KEY.trim().length > 0;
}

// Code langue TheTVDB (3 lettres) déduit de DEFAULT_LANGUAGE (ex. "fr-FR" -> "fra").
export function tvdbLanguage(): string {
  const map: Record<string, string> = {
    fr: 'fra', en: 'eng', es: 'spa', de: 'deu', it: 'ita', pt: 'por', nl: 'nld', ja: 'jpn',
  };
  return map[env.DEFAULT_LANGUAGE.slice(0, 2).toLowerCase()] ?? 'eng';
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  if (!tvdbEnabled()) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const body: Record<string, string> = { apikey: env.TVDB_API_KEY };
  if (env.TVDB_PIN.trim()) body.pin = env.TVDB_PIN.trim();
  try {
    const res = await fetch(`${TVDB_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[tvdb] login refusé (HTTP ${res.status}) — vérifiez TVDB_API_KEY/TVDB_PIN`);
      return null;
    }
    const data = (await res.json()) as { data?: { token?: string } };
    const token = data.data?.token;
    if (!token) {
      console.warn('[tvdb] login sans jeton dans la réponse');
      return null;
    }
    // Le jeton dure ~1 mois ; on le rafraîchit chaque jour par prudence.
    cachedToken = { token, expiresAt: Date.now() + DAY };
    return token;
  } catch (err) {
    console.warn(`[tvdb] login injoignable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// GET authentifié avec cache en base (source 'tvdb'). Renvoie la réponse JSON complète.
async function tvdbGet<T>(path: string, params: Record<string, string>, ttlMs: number): Promise<T | null> {
  if (!tvdbEnabled()) return null;
  const qs = new URLSearchParams(params).toString();
  const cacheKey = `${path}${qs ? `?${qs}` : ''}`;

  const cached = await prisma.apiCache.findUnique({
    where: { source_cacheKey: { source: 'tvdb', cacheKey } },
  });
  if (cached && cached.expiresAt > new Date()) return JSON.parse(cached.responseJson) as T;

  let token = await getToken();
  if (!token) return cached ? (JSON.parse(cached.responseJson) as T) : null;

  try {
    let res = await fetch(`${TVDB_BASE}${cacheKey}`, { headers: { Authorization: `Bearer ${token}` } });
    // Jeton expiré/révoqué : on en redemande un et on réessaie une fois.
    if (res.status === 401) {
      cachedToken = null;
      token = await getToken();
      if (!token) return cached ? (JSON.parse(cached.responseJson) as T) : null;
      res = await fetch(`${TVDB_BASE}${cacheKey}`, { headers: { Authorization: `Bearer ${token}` } });
    }
    if (!res.ok) {
      console.warn(`[tvdb] GET ${path} -> HTTP ${res.status}`);
      return cached ? (JSON.parse(cached.responseJson) as T) : null;
    }
    const json = (await res.json()) as T;
    await prisma.apiCache.upsert({
      where: { source_cacheKey: { source: 'tvdb', cacheKey } },
      create: { source: 'tvdb', cacheKey, responseJson: JSON.stringify(json), expiresAt: new Date(Date.now() + ttlMs) },
      update: { responseJson: JSON.stringify(json), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return json;
  } catch (err) {
    console.warn(`[tvdb] GET ${path} en échec: ${err instanceof Error ? err.message : String(err)}`);
    return cached ? (JSON.parse(cached.responseJson) as T) : null;
  }
}

export type TvdbSearchResult = {
  tvdb_id: string;
  name: string;
  overview?: string;
  image_url?: string;
  year?: string;
  first_air_time?: string;
  primary_type?: string;
  overviews?: Record<string, string>;
  translations?: Record<string, string>;
};

export async function tvdbSearch(query: string): Promise<TvdbSearchResult[]> {
  const data = await tvdbGet<{ data?: TvdbSearchResult[] }>(
    '/search',
    { query, type: 'series', limit: '20' },
    7 * DAY,
  );
  return (data?.data ?? []).filter((r) => r.tvdb_id);
}

export type TvdbSeasonRef = { number: number; type?: { type?: string; name?: string } };
export type TvdbSeriesExtended = {
  id: number;
  name: string;
  overview?: string;
  image?: string;
  firstAired?: string;
  year?: string;
  originalLanguage?: string;
  status?: { name?: string };
  latestNetwork?: { name?: string };
  seasons?: TvdbSeasonRef[];
  genres?: { name: string }[];
};

export async function tvdbSeriesExtended(tvdbId: string): Promise<TvdbSeriesExtended | null> {
  const data = await tvdbGet<{ data?: TvdbSeriesExtended }>(
    `/series/${tvdbId}/extended`,
    { short: 'true' },
    3 * DAY,
  );
  return data?.data ?? null;
}

export type TvdbEpisode = {
  id: number;
  seasonNumber: number;
  number: number;
  name?: string;
  overview?: string;
  image?: string;
  aired?: string;
  runtime?: number;
};

// Épisodes "default" (paginés, page_size=500). On suit links.next jusqu'à null,
// borné à 50 pages par sécurité. `lang` interroge la variante traduite
// (/episodes/default/{lang}) — les champs name/overview y sont localisés.
async function fetchEpisodePages(tvdbId: string, lang?: string, ttlMs: number = 3 * DAY): Promise<TvdbEpisode[]> {
  const base = `/series/${tvdbId}/episodes/default${lang ? `/${lang}` : ''}`;
  const all: TvdbEpisode[] = [];
  for (let page = 0; page < 50; page++) {
    const data = await tvdbGet<{
      data?: { episodes?: TvdbEpisode[] };
      links?: { next?: string | null };
    }>(base, { page: String(page) }, ttlMs);
    all.push(...(data?.data?.episodes ?? []));
    if (!data?.links?.next) break;
  }
  return all;
}

// Épisodes d'un ORDRE (season type) donné : official / dvd / absolute /
// alternate / regional / altdvd… Même pagination que fetchEpisodePages —
// seule la numérotation (seasonNumber/number) nous intéresse ici, pas de
// variante traduite. Sert aux ordres d'épisodes alternatifs (Disney+…).
export async function tvdbSeriesEpisodesByType(
  tvdbId: string,
  seasonType: string,
  ttlMs: number = 3 * DAY,
): Promise<TvdbEpisode[]> {
  const base = `/series/${tvdbId}/episodes/${encodeURIComponent(seasonType)}`;
  const all: TvdbEpisode[] = [];
  for (let page = 0; page < 50; page++) {
    const data = await tvdbGet<{
      data?: { episodes?: TvdbEpisode[] };
      links?: { next?: string | null };
    }>(base, { page: String(page) }, ttlMs);
    all.push(...(data?.data?.episodes ?? []));
    if (!data?.links?.next) break;
  }
  return all;
}

// Épisodes avec titres/synopsis localisés quand ils existent : la liste
// canonique (numérotation, dates, images) est fusionnée avec la traduction.
// `ttlMs` : durée du cache HTTP — courte pour une série EN COURS (une saison
// qui démarre doit apparaître vite), longue pour une série terminée.
export async function tvdbSeriesEpisodes(tvdbId: string, ttlMs: number = 3 * DAY): Promise<TvdbEpisode[]> {
  const canonical = await fetchEpisodePages(tvdbId, undefined, ttlMs);
  if (canonical.length === 0) return canonical;
  const translated = await fetchEpisodePages(tvdbId, tvdbLanguage(), ttlMs).catch(() => []);
  if (translated.length === 0) return canonical;
  const byId = new Map(translated.map((e) => [e.id, e]));
  return canonical.map((e) => {
    const t = byId.get(e.id);
    return t ? { ...e, name: t.name ?? e.name, overview: t.overview ?? e.overview } : e;
  });
}

// Illustrations d'une série (type 2 = affiches, type 3 = bannières/fonds).
export async function tvdbSeriesArtworks(tvdbId: string, type: 2 | 3): Promise<string[]> {
  const data = await tvdbGet<{ data?: { artworks?: { image?: string }[] } }>(
    `/series/${tvdbId}/artworks`,
    { type: String(type) },
    30 * DAY,
  );
  return (data?.data?.artworks ?? []).map((a) => a.image).filter((u): u is string => !!u);
}

export type TvdbTranslation = { name?: string; overview?: string };

export async function tvdbSeriesTranslation(tvdbId: string, lang: string): Promise<TvdbTranslation | null> {
  const data = await tvdbGet<{ data?: TvdbTranslation }>(
    `/series/${tvdbId}/translations/${lang}`,
    {},
    30 * DAY,
  );
  return data?.data ?? null;
}
