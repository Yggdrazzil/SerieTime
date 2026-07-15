import type { NormalizedImportedEpisode, NormalizedImportedMedia } from '@serietime/types';
import { parseBoolSafe, parseDateSafe, parseFloatSafe, parseIntSafe } from '../utils/text.js';
import { pickField, type FileKind, type RawRecord } from './records.js';

export function extractExternalIds(record: RawRecord): { tvdbId?: string; tmdbId?: string; imdbId?: string } {
  const ids: { tvdbId?: string; tmdbId?: string; imdbId?: string } = {};
  const tvdb = pickField(record, 'tvdbId');
  const tmdb = pickField(record, 'tmdbId');
  const imdb = pickField(record, 'imdbId');
  if (tvdb !== undefined) ids.tvdbId = String(tvdb);
  if (tmdb !== undefined) ids.tmdbId = String(tmdb);
  if (imdb !== undefined) ids.imdbId = String(imdb);

  const url = pickField(record, 'url');
  if (typeof url === 'string') {
    // TV Time URLs: https://tvtime.com/en/show/375903, /movie/12345
    const showMatch = url.match(/\/(?:show|serie|series)\/(\d+)/);
    if (showMatch && !ids.tvdbId) ids.tvdbId = showMatch[1];
    const movieMatch = url.match(/\/movie\/(\d+)/);
    if (movieMatch && !ids.tmdbId) ids.tmdbId = movieMatch[1];
    const imdbMatch = url.match(/(tt\d{6,})/);
    if (imdbMatch && !ids.imdbId) ids.imdbId = imdbMatch[1];
  }
  return ids;
}

export function detectMediaType(record: RawRecord, fileKind: FileKind): 'show' | 'movie' | 'unknown' {
  const explicit = pickField(record, 'type');
  if (typeof explicit === 'string') {
    const t = explicit.toLowerCase();
    if (/(movie|film)/.test(t)) return 'movie';
    if (/(show|serie|series|tv)/.test(t)) return 'show';
  }
  const url = pickField(record, 'url');
  if (typeof url === 'string') {
    if (/\/movie\//.test(url)) return 'movie';
    if (/\/(show|serie|series)\//.test(url)) return 'show';
  }
  if (pickField(record, 'seasonNumber') !== undefined || pickField(record, 'episodeNumber') !== undefined) {
    return 'show';
  }
  if (fileKind === 'movies') return 'movie';
  if (fileKind === 'shows' || fileKind === 'episodes_watched') return 'show';
  return 'unknown';
}

export function normalizeImportedMedia(record: RawRecord, fileKind: FileKind): NormalizedImportedMedia | null {
  const title = pickField(record, 'title');
  const ids = extractExternalIds(record);
  if (typeof title !== 'string' || !title.trim()) {
    if (!ids.tvdbId && !ids.tmdbId && !ids.imdbId) return null;
  }

  const yearRaw = parseIntSafe(pickField(record, 'year'));
  const releaseDate = parseDateSafe(pickField(record, 'releaseDate'));
  const year = yearRaw ?? (releaseDate ? new Date(releaseDate).getFullYear() : undefined);
  const url = pickField(record, 'url');
  const rawId = record['id'] ?? record['uuid'] ?? undefined;
  const listName = pickField(record, 'listName');

  const isWatched = parseBoolSafe(pickField(record, 'isWatched'));
  let status = typeof pickField(record, 'status') === 'string' ? String(pickField(record, 'status')) : undefined;
  // TV Time range « favorite » et « for_later » dans la même colonne status
  // (user_show_special_status.csv). « favorite » n'est pas un statut de suivi :
  // on le bascule en favori et on laisse le statut se déduire ailleurs.
  let favoriteFromStatus = false;
  if (status && status.trim().toLowerCase() === 'favorite') {
    favoriteFromStatus = true;
    status = undefined;
  }
  if (!status) {
    if (fileKind === 'watchlist') status = 'watchlist';
    else if (isWatched === true) status = 'watched';
  }
  // TV Time n'exporte pas de colonne status pour « Arrêter de regarder » :
  // c'est `active = 0` dans followed_tv_show.csv (vérifié sur un export réel).
  if (!status && fileKind === 'shows' && parseBoolSafe(pickField(record, 'isActive')) === false) {
    status = 'stopped_watching';
  }
  const isFavorite =
    fileKind === 'favorites' || favoriteFromStatus || parseBoolSafe(pickField(record, 'favorite')) === true;

  return {
    source: 'tvtime',
    sourceRawId: rawId !== undefined ? String(rawId) : undefined,
    sourceUrl: typeof url === 'string' ? url : undefined,
    mediaType: detectMediaType(record, fileKind),
    title: typeof title === 'string' && title.trim() ? title.trim() : `#${ids.tvdbId ?? ids.tmdbId ?? ids.imdbId}`,
    year,
    ...ids,
    status,
    rating: parseFloatSafe(pickField(record, 'rating')),
    isFavorite,
    addedAt: parseDateSafe(pickField(record, 'addedAt')),
    watchedAt: parseDateSafe(pickField(record, 'watchedAt')),
    listNames: typeof listName === 'string' && listName.trim() ? [listName.trim()] : undefined,
    raw: record,
  };
}

export function normalizeImportedEpisode(record: RawRecord): NormalizedImportedEpisode | null {
  const showTitle = pickField(record, 'title');
  const ids = extractExternalIds(record);
  if ((typeof showTitle !== 'string' || !showTitle.trim()) && !ids.tvdbId && !ids.tmdbId) return null;

  const EPISODE_CODE = /s(\d{1,3})\s*[|x]?\s*e(\d{1,4})/i;
  const rawSeason = pickField(record, 'seasonNumber');
  const rawEpisode = pickField(record, 'episodeNumber');
  // "S01E13" style codes take precedence over naive digit extraction.
  const codeValue = [rawEpisode, rawSeason, ...Object.values(record)].find(
    (v): v is string => typeof v === 'string' && EPISODE_CODE.test(v),
  );
  let seasonNumber = typeof rawSeason === 'string' && EPISODE_CODE.test(rawSeason) ? undefined : parseIntSafe(rawSeason);
  let episodeNumber = typeof rawEpisode === 'string' && EPISODE_CODE.test(rawEpisode) ? undefined : parseIntSafe(rawEpisode);
  if ((seasonNumber === undefined || episodeNumber === undefined) && codeValue) {
    const m = codeValue.match(EPISODE_CODE);
    if (m && m[1] !== undefined && m[2] !== undefined) {
      seasonNumber = seasonNumber ?? parseInt(m[1], 10);
      episodeNumber = episodeNumber ?? parseInt(m[2], 10);
    }
  }

  const episodeTitle = pickField(record, 'episodeTitle');
  const tvdbEpisode = pickField(record, 'tvdbEpisodeId');

  return {
    source: 'tvtime',
    showTitle: typeof showTitle === 'string' && showTitle.trim() ? showTitle.trim() : `#${ids.tvdbId ?? ids.tmdbId}`,
    episodeTitle: typeof episodeTitle === 'string' ? episodeTitle : undefined,
    seasonNumber,
    episodeNumber,
    absoluteNumber: parseIntSafe(pickField(record, 'absoluteNumber')),
    watchedAt: parseDateSafe(pickField(record, 'watchedAt')),
    rating: parseFloatSafe(pickField(record, 'rating')),
    tvdbShowId: ids.tvdbId,
    tvdbEpisodeId: tvdbEpisode !== undefined ? String(tvdbEpisode) : undefined,
    tmdbShowId: ids.tmdbId,
    raw: record,
  };
}
