import { parse as parseCsvSync } from 'csv-parse/sync';

export type RawRecord = Record<string, unknown>;

export type ParsedFile = {
  path: string;
  kind: FileKind;
  rows: RawRecord[];
  error?: string;
};

export type FileKind =
  | 'episodes_watched'
  | 'shows'
  | 'movies'
  | 'watchlist'
  | 'favorites'
  | 'ratings'
  | 'lists'
  | 'profile'
  | 'unknown';

const FILE_KEYWORDS: [FileKind, RegExp][] = [
  ['episodes_watched', /(seen[-_ ]?episode|episode|episodes|watched[-_ ]?episode|tracking)/i],
  ['watchlist', /(watch[-_ ]?list|watchlist|to[-_ ]?watch)/i],
  ['favorites', /(favorite|favourites|favorites|favoris)/i],
  ['ratings', /(rating|ratings|note)/i],
  ['lists', /(^|[/_-])lists?([/_-]|\.|$)/i],
  ['movies', /(movie|movies|film|films)/i],
  ['shows', /(show|shows|series|serie|followed)/i],
  ['profile', /(user|profile)/i],
];

// Fichiers de l'export TV Time qu'on sait traiter, mappés explicitement.
// L'export réel contient ~60 fichiers ; sans cette liste blanche, l'heuristique
// par mots-clés classe à tort commentaires, votes d'émotion, images perso, etc.
// comme des séries/films → camelote. On ne traite QUE ces fichiers-là.
const TVTIME_KNOWN: [RegExp, FileKind][] = [
  [/^followed_tv_show(_source)?\.csv$/i, 'shows'],
  [/^user_tv_show_data\.csv$/i, 'shows'],
  [/^user_show_special_status\.csv$/i, 'shows'],
  [/^tracking-prod-records(-v2)?\.csv$/i, 'episodes_watched'],
  [/^(show[_-])?seen[_-]?episode.*\.csv$/i, 'episodes_watched'],
  [/^watched_on_episode\.csv$/i, 'episodes_watched'],
];

// Fichiers système / bruyants de l'export TV Time : toujours ignorés. Sans ça,
// ex. comments-prod-comments.csv devient 60 « films », where-to-watch 10 « à
// voir », recommended_show_excluded des séries suivies… (constaté sur un export réel).
const TVTIME_IGNORE =
  /(comment|emotion|where-to-watch|recommend|custom_show_image|addiction|character|count-by-timeframe|deployment|install|badge|friend|token|device|ip_address|notification|webhook|session|leaderboard|social|facebook|setting|personal_data|statistic|connection|customization|appsflyer|ad_identifier|gdpr|platform|mail_sent|last_updated|votes|lists-prod|stats-prod)/i;

// Column keywords that refine detection when the filename is ambiguous.
const EPISODE_COLUMNS = /^(episode(_?number)?|season(_?number)?|episode_season_number|s\d+e\d+)$/i;
const MOVIE_COLUMNS = /^(movie_?(title|name|id)|release_date)$/i;

export function detectFileKind(path: string, rows: RawRecord[]): FileKind {
  const columns = rows.length > 0 ? Object.keys(rows[0] ?? {}) : [];
  const hasEpisodeColumns = columns.some((c) => EPISODE_COLUMNS.test(c.trim()));
  const hasMovieColumns = columns.some((c) => MOVIE_COLUMNS.test(c.trim()));

  const base = path.split('/').pop() ?? path;

  // 1) Fichiers TV Time connus : mapping explicite (prioritaire).
  for (const [re, kind] of TVTIME_KNOWN) {
    if (re.test(base)) {
      if (kind === 'shows' && hasEpisodeColumns) return 'episodes_watched';
      return kind;
    }
  }
  // 2) Fichiers système/bruyants de l'export TV Time : ignorés.
  if (TVTIME_IGNORE.test(base)) return 'unknown';

  // 3) Heuristique générique par mots-clés (autres sources / fixtures de test).
  for (const [kind, re] of FILE_KEYWORDS) {
    if (re.test(base)) {
      if (kind === 'shows' && hasEpisodeColumns) return 'episodes_watched';
      return kind;
    }
  }
  if (hasEpisodeColumns) return 'episodes_watched';
  if (hasMovieColumns) return 'movies';
  return 'unknown';
}

export function parseCsv(content: string): RawRecord[] {
  const records = parseCsvSync(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    bom: true,
    trim: true,
  }) as RawRecord[];
  return records;
}

export function parseJsonRecords(content: string): RawRecord[] {
  const data = JSON.parse(content) as unknown;
  if (Array.isArray(data)) {
    return data.filter((r): r is RawRecord => typeof r === 'object' && r !== null);
  }
  if (typeof data === 'object' && data !== null) {
    // Object wrapping one or more arrays: flatten every array value.
    const rows: RawRecord[] = [];
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) {
        for (const r of value) {
          if (typeof r === 'object' && r !== null) rows.push(r as RawRecord);
        }
      }
    }
    if (rows.length > 0) return rows;
    return [data as RawRecord];
  }
  return [];
}

export function parseFileContent(path: string, content: string): ParsedFile {
  const lower = path.toLowerCase();
  try {
    let rows: RawRecord[] = [];
    if (lower.endsWith('.json')) {
      rows = parseJsonRecords(content);
    } else if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
      const trimmed = content.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        rows = parseJsonRecords(trimmed);
      } else {
        rows = parseCsv(content);
      }
    } else {
      return { path, kind: 'unknown', rows: [], error: 'unsupported extension' };
    }
    return { path, kind: detectFileKind(path, rows), rows };
  } catch (err) {
    return { path, kind: 'unknown', rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

const FIELD_ALIASES: Record<string, string[]> = {
  title: ['title', 'name', 'show_name', 'series_name', 'movie_title', 'movie_name', 'show_title', 'serie_name', 'tv_show_name'],
  episodeTitle: ['episode_title', 'episode_name'],
  seasonNumber: ['season', 'season_number', 'episode_season_number', 'seasonnumber', 'season_num'],
  episodeNumber: ['episode', 'episode_number', 'number', 'episodenumber', 'episode_num'],
  absoluteNumber: ['absolute_number', 'absolute'],
  watchedAt: ['watched_at', 'watched_date', 'watch_date', 'date_watched', 'watched_on', 'created_at', 'updated_at', 'is_watched_date'],
  addedAt: ['added_at', 'created_at', 'followed_at', 'date_added'],
  rating: ['rating', 'note', 'score', 'stars'],
  status: ['status', 'state', 'show_status', 'watch_status'],
  favorite: ['favorite', 'is_favorite', 'favourite', 'favorited', 'is_favorited'],
  tvdbId: ['tvdb_id', 'tvdbid', 'thetvdb_id', 'series_id', 'tv_show_id', 'show_id', 's_id'],
  tvdbEpisodeId: ['episode_id', 'tvdb_episode_id'],
  tmdbId: ['tmdb_id', 'tmdbid', 'themoviedb_id', 'movie_id'],
  imdbId: ['imdb_id', 'imdbid'],
  url: ['url', 'link', 'tvtime_url'],
  year: ['year', 'release_year', 'first_air_year'],
  releaseDate: ['release_date', 'first_air_date', 'air_date'],
  type: ['type', 'media_type', 'kind', 'entity_type', 'item_type'],
  listName: ['list', 'list_name', 'list_title'],
  isWatched: ['is_watched', 'watched', 'seen'],
  note: ['comment', 'private_comment', 'notes', 'personal_note'],
};

export function pickField(record: RawRecord, field: keyof typeof FIELD_ALIASES): unknown {
  const aliases = FIELD_ALIASES[field] ?? [];
  const keys = Object.keys(record);
  for (const alias of aliases) {
    const key = keys.find((k) => k.trim().toLowerCase() === alias);
    if (key !== undefined) {
      const v = record[key];
      if (v !== undefined && v !== null && v !== '') return v;
    }
  }
  return undefined;
}
