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
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { token?: string } };
    const token = data.data?.token;
    if (!token) return null;
    // Le jeton dure ~1 mois ; on le rafraîchit chaque jour par prudence.
    cachedToken = { token, expiresAt: Date.now() + DAY };
    return token;
  } catch {
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

  const token = await getToken();
  if (!token) return cached ? (JSON.parse(cached.responseJson) as T) : null;

  try {
    const res = await fetch(`${TVDB_BASE}${cacheKey}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return cached ? (JSON.parse(cached.responseJson) as T) : null;
    const json = (await res.json()) as T;
    await prisma.apiCache.upsert({
      where: { source_cacheKey: { source: 'tvdb', cacheKey } },
      create: { source: 'tvdb', cacheKey, responseJson: JSON.stringify(json), expiresAt: new Date(Date.now() + ttlMs) },
      update: { responseJson: JSON.stringify(json), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return json;
  } catch {
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
};

export async function tvdbSearch(query: string): Promise<TvdbSearchResult[]> {
  const data = await tvdbGet<{ data?: TvdbSearchResult[] }>(
    '/search',
    { query, type: 'series', limit: '20' },
    7 * DAY,
  );
  return (data?.data ?? []).filter((r) => r.tvdb_id);
}

export type TvdbSeasonRef = { number: number; type?: { type?: string } };
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

// Épisodes "default" (paginés). On borne à 20 pages pour éviter les séries fleuves.
export async function tvdbSeriesEpisodes(tvdbId: string): Promise<TvdbEpisode[]> {
  const all: TvdbEpisode[] = [];
  for (let page = 0; page < 20; page++) {
    const data = await tvdbGet<{ data?: { episodes?: TvdbEpisode[] } }>(
      `/series/${tvdbId}/episodes/default`,
      { page: String(page) },
      3 * DAY,
    );
    const eps = data?.data?.episodes ?? [];
    if (eps.length === 0) break;
    all.push(...eps);
    if (eps.length < 100) break; // dernière page
  }
  return all;
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
