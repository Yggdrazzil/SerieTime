import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type {
  ImportAnalysisSummary,
  NormalizedImportedEpisode,
  NormalizedImportedMedia,
} from '@serietime/types';
import {
  bestCandidate,
  decideMatch,
  normalizeImportedEpisode,
  normalizeImportedMedia,
  normalizeTitle,
  parseFileContent,
  scoreMatch,
  type MatchCandidate,
  type ParsedFile,
} from '@serietime/core/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/client.js';
import { env } from '../../config/env.js';
import { toJson, fromJson } from '../../utils/json.js';
import {
  tmdbEnabled,
  tmdbSearch,
  ensureMediaFromTmdb,
  tmdbFindByExternalId,
} from '../../services/tmdb/index.js';
import { syncShowEpisodesFromTmdb } from '../../services/tmdb/index.js';
import { syncEpisodesFromTvdb, tvdbEnabled } from '../../services/tvdb/index.js';
import { markEpisodeWatched, recalculateShowStatus } from '../media/actions.js';

const IMPORTS_DIR = path.resolve('data/imports');

export function importDir(importId: string): string {
  return path.join(IMPORTS_DIR, importId);
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export async function saveUpload(importId: string, buffer: Buffer): Promise<void> {
  const dir = importDir(importId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'original.zip'), buffer);
}

type MappingRaw = {
  normalized: NormalizedImportedMedia;
  suggestions: SuggestionEntry[];
  decision: 'existing' | 'create' | 'tmdb' | null;
  tmdbId?: string;
};

type SuggestionEntry = {
  mediaId?: string;
  tmdbId?: string;
  title: string;
  year?: number;
  posterPath?: string | null;
  score: number;
};

const TVTIME_STATUS_MAP: Record<string, string> = {
  watching: 'watching',
  up_to_date: 'watching',
  'up to date': 'watching',
  continuing: 'watching',
  finished: 'completed',
  completed: 'completed',
  watched: 'completed',
  stopped_watching: 'abandoned',
  'stopped watching': 'abandoned',
  stopped: 'abandoned',
  dropped: 'abandoned',
  for_later: 'watchlist',
  'for later': 'watchlist',
  watchlist: 'watchlist',
  planned: 'watchlist',
  paused: 'paused',
  on_hold: 'paused',
  not_started: 'not_started',
};

export function mapImportedStatus(raw: string | undefined, mediaType: string): string {
  if (raw) {
    const mapped = TVTIME_STATUS_MAP[raw.trim().toLowerCase()];
    if (mapped) return mapped;
  }
  return mediaType === 'movie' ? 'watchlist' : 'not_started';
}

// ————— Analyse —————

export async function analyzeImport(importId: string): Promise<ImportAnalysisSummary> {
  const importRow = await prisma.import.findUniqueOrThrow({ where: { id: importId } });
  const zipPath = path.join(importDir(importId), 'original.zip');
  const zip = new AdmZip(zipPath);

  const parsedFiles: ParsedFile[] = [];
  // Bornes anti « zip bomb » : nombre d'entrées et volume décompressé TOTAL
  // plafonnés (la taille déclarée par l'en-tête peut mentir, on mesure le réel).
  const MAX_ENTRIES = 500;
  const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
  let entries = 0;
  let totalBytes = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    // Protection Zip Slip : les entrées ne sont jamais extraites sur disque,
    // et les noms suspects sont ignorés.
    const name = entry.entryName;
    if (name.includes('..') || path.isAbsolute(name)) continue;
    const lower = name.toLowerCase();
    if (!lower.endsWith('.csv') && !lower.endsWith('.json') && !lower.endsWith('.txt')) continue;
    if (++entries > MAX_ENTRIES) break;
    if (entry.header.size > MAX_ENTRY_BYTES) continue;
    const data = entry.getData();
    totalBytes += data.length;
    if (data.length > MAX_ENTRY_BYTES || totalBytes > MAX_TOTAL_BYTES) break;
    const content = data.toString('utf-8');
    parsedFiles.push(parseFileContent(name, content));
  }

  // Normalisation
  const mediaByKey = new Map<string, NormalizedImportedMedia>();
  const episodesByKey = new Map<string, NormalizedImportedEpisode[]>();
  let episodesWatchedDetected = 0;
  let duplicatesIgnored = 0;
  const episodeDedup = new Set<string>();

  const mediaKey = (m: { tvdbId?: string; tmdbId?: string; imdbId?: string; title: string; mediaType: string }) => {
    if (m.tvdbId) return `tvdb:${m.tvdbId}`;
    if (m.tmdbId && m.mediaType === 'movie') return `tmdb-movie:${m.tmdbId}`;
    if (m.tmdbId) return `tmdb:${m.tmdbId}`;
    if (m.imdbId) return `imdb:${m.imdbId}`;
    return `${m.mediaType}:${normalizeTitle(m.title)}`;
  };

  const mergeMedia = (m: NormalizedImportedMedia) => {
    const key = mediaKey(m);
    const existing = mediaByKey.get(key);
    if (!existing) {
      mediaByKey.set(key, m);
      return;
    }
    // fusion : ne jamais perdre d'info
    existing.year = existing.year ?? m.year;
    existing.tvdbId = existing.tvdbId ?? m.tvdbId;
    existing.tmdbId = existing.tmdbId ?? m.tmdbId;
    existing.imdbId = existing.imdbId ?? m.imdbId;
    existing.status = existing.status ?? m.status;
    existing.rating = existing.rating ?? m.rating;
    existing.isFavorite = existing.isFavorite || m.isFavorite;
    existing.addedAt = existing.addedAt ?? m.addedAt;
    existing.watchedAt = existing.watchedAt ?? m.watchedAt;
    if (m.mediaType !== 'unknown' && existing.mediaType === 'unknown') existing.mediaType = m.mediaType;
    if (m.listNames?.length) existing.listNames = [...new Set([...(existing.listNames ?? []), ...m.listNames])];
  };

  // Films : TV Time ne les met pas dans un fichier dédié, ils sont noyés dans
  // les tracking records (entity_type=movie, movie_name, release_date, type).
  // On les collecte à part, « vu » l'emportant sur « à voir » (towatch).
  const movieSeen = new Map<string, { title: string; year?: number; watched: boolean }>();

  for (const file of parsedFiles) {
    if (file.kind === 'episodes_watched') {
      for (const row of file.rows) {
        const entity = String(row['entity_type'] ?? '').toLowerCase();
        if (entity === 'movie') {
          const title = String(row['movie_name'] ?? '').trim();
          if (!title) continue;
          const type = String(row['type'] ?? '').toLowerCase();
          const rd = String(row['release_date'] ?? '');
          const year = /^\d{4}/.test(rd) ? parseInt(rd.slice(0, 4), 10) : undefined;
          const watched = type !== 'towatch'; // watch/rewatch/follow => vu ; towatch => à voir
          const key = `movie:${normalizeTitle(title)}`;
          const prev = movieSeen.get(key);
          movieSeen.set(key, { title, year, watched: (prev?.watched ?? false) || watched });
          continue;
        }
        const ep = normalizeImportedEpisode(row);
        if (!ep) continue;
        const showKey = ep.tvdbShowId ? `tvdb:${ep.tvdbShowId}` : `show:${normalizeTitle(ep.showTitle)}`;
        const dedupKey = `${showKey}|${ep.seasonNumber ?? '?'}|${ep.episodeNumber ?? '?'}`;
        if (ep.seasonNumber !== undefined && ep.episodeNumber !== undefined) {
          if (episodeDedup.has(dedupKey)) {
            duplicatesIgnored++;
            continue;
          }
          episodeDedup.add(dedupKey);
        }
        episodesByKey.set(showKey, [...(episodesByKey.get(showKey) ?? []), ep]);
        episodesWatchedDetected++;
        // la série elle-même doit exister comme mapping
        mergeMedia({
          source: 'tvtime',
          mediaType: 'show',
          title: ep.showTitle,
          tvdbId: ep.tvdbShowId,
          tmdbId: ep.tmdbShowId,
          raw: {},
        });
      }
    } else if (file.kind !== 'unknown' && file.kind !== 'profile') {
      for (const row of file.rows) {
        const media = normalizeImportedMedia(row, file.kind);
        if (media) mergeMedia(media);
      }
    }
  }

  for (const m of movieSeen.values()) {
    mergeMedia({
      source: 'tvtime',
      mediaType: 'movie',
      title: m.title,
      year: m.year,
      status: m.watched ? 'watched' : 'watchlist',
      raw: {},
    });
  }

  // Matching
  const localMedia = await prisma.media.findMany({
    select: {
      id: true,
      type: true,
      title: true,
      originalTitle: true,
      localizedTitle: true,
      year: true,
      tvdbId: true,
      tmdbId: true,
      imdbId: true,
      posterPath: true,
    },
  });

  await prisma.importMapping.deleteMany({ where: { importId } });

  let autoImport = 0;
  let toVerify = 0;
  let unresolvedCount = 0;
  let ratingsDetected = 0;
  let favoritesDetected = 0;
  const listNames = new Set<string>();
  // Insertion GROUPÉE des mappings : sur un gros import (~1500 séries), 1500
  // create() séquentiels prenaient ~80s → l'analyse dépassait le timeout nginx
  // et l'app tournait dans le vide. createMany() en une passe = quelques secondes.
  const mappingRows: Prisma.ImportMappingCreateManyInput[] = [];

  for (const media of mediaByKey.values()) {
    if (media.rating !== undefined) ratingsDetected++;
    if (media.isFavorite) favoritesDetected++;
    for (const l of media.listNames ?? []) listNames.add(l);

    const target = {
      title: media.title,
      year: media.year,
      tvdbId: media.tvdbId,
      tmdbId: media.tmdbId,
      imdbId: media.imdbId,
    };

    const candidates: MatchCandidate[] = localMedia
      .filter((m) => media.mediaType === 'unknown' || m.type === media.mediaType)
      .map((m) => ({
        mediaId: m.id,
        title: m.title,
        originalTitle: m.originalTitle ?? undefined,
        localizedTitle: m.localizedTitle ?? undefined,
        year: m.year ?? undefined,
        tvdbId: m.tvdbId ?? undefined,
        tmdbId: m.tmdbId ?? undefined,
        imdbId: m.imdbId ?? undefined,
      }));

    const suggestions: SuggestionEntry[] = [];
    let best = bestCandidate(target, candidates);
    let decision: MappingRaw['decision'] = best && best.score >= 70 ? 'existing' : null;
    let tmdbSuggestionId: string | undefined;

    // TMDb : suggestions supplémentaires si configuré. On saute la recherche
    // quand le média a déjà un id externe (tvdb/tmdb/imdb) : il s'auto-résout
    // (score 100) et une recherche serait inutile — crucial pour les gros
    // imports (ex. ~945 séries TV Time, toutes avec un id TheTVDB : sinon
    // l'analyse ferait ~945 appels TMDb et dépasserait le temps d'une requête).
    const hasExternalId = Boolean(media.tvdbId || media.tmdbId || media.imdbId);
    // Les films (title+année, sans id) sont enrichis en tâche de fond, pas à
    // l'analyse : sinon ~1000 recherches TMDb feraient exploser le temps d'analyse.
    if ((!best || best.score < 90) && tmdbEnabled() && media.mediaType === 'show' && !hasExternalId) {
      const remote = await tmdbSearch(media.title, 'tv', media.year).catch(() => []);
      for (const r of remote.slice(0, 5)) {
        const candidate: MatchCandidate = {
          tmdbId: String(r.id),
          title: r.name ?? r.title ?? '',
          originalTitle: r.original_name ?? r.original_title,
          year: (r.first_air_date ?? r.release_date)
            ? new Date((r.first_air_date ?? r.release_date)!).getFullYear()
            : undefined,
        };
        const score = scoreMatch(target, candidate);
        suggestions.push({
          tmdbId: candidate.tmdbId,
          title: candidate.title,
          year: candidate.year,
          posterPath: r.poster_path ?? null,
          score,
        });
        if (!best || score > best.score) {
          best = { candidate, score };
          decision = score >= 70 ? 'tmdb' : decision;
          tmdbSuggestionId = candidate.tmdbId;
        }
      }
    }

    // Candidat synthétique : créer le média depuis les données importées.
    // Score selon la table spec : id externe = 100, titre+année = 90, titre seul = 50.
    const selfScore = media.tvdbId || media.tmdbId || media.imdbId ? 100 : media.year ? 90 : 50;
    if ((!best || best.score < selfScore) && media.mediaType !== 'unknown') {
      best = {
        candidate: { title: media.title, year: media.year },
        score: selfScore,
      };
      decision = 'create';
    }

    for (const c of candidates) {
      const score = scoreMatch(target, c);
      if (score >= 50) {
        const local = localMedia.find((m) => m.id === c.mediaId);
        suggestions.push({
          mediaId: c.mediaId,
          title: c.title,
          year: c.year,
          posterPath: local?.posterPath ?? null,
          score,
        });
      }
    }
    suggestions.sort((a, b) => b.score - a.score);

    const score = best?.score ?? 0;
    const mode = decideMatch(score);
    const matchStatus = mode === 'manual' ? 'unresolved' : 'matched_auto';
    if (mode === 'auto') autoImport++;
    else if (mode === 'auto_flagged') {
      autoImport++;
      toVerify++;
    } else unresolvedCount++;

    const raw: MappingRaw = {
      normalized: media,
      suggestions: suggestions.slice(0, 8),
      decision: matchStatus === 'matched_auto' ? decision ?? 'create' : null,
      tmdbId: decision === 'tmdb' ? tmdbSuggestionId : undefined,
    };

    mappingRows.push({
      importId,
      sourceRawId: media.sourceRawId,
      sourceUrl: media.sourceUrl,
      sourceTitle: media.title,
      sourceType: media.mediaType,
      matchedMediaId: decision === 'existing' ? best?.candidate.mediaId : undefined,
      matchStatus,
      matchScore: score,
      rawJson: toJson(raw),
    });
  }
  await prisma.importMapping.createMany({ data: mappingRows });

  const shows = [...mediaByKey.values()].filter((m) => m.mediaType === 'show');
  const movies = [...mediaByKey.values()].filter((m) => m.mediaType === 'movie');

  const summary: ImportAnalysisSummary = {
    showsDetected: shows.length,
    moviesDetected: movies.length,
    episodesWatchedDetected,
    ratingsDetected,
    favoritesDetected,
    listsDetected: listNames.size,
    autoImport,
    toVerify,
    unresolved: unresolvedCount,
    duplicatesIgnored,
    files: parsedFiles.map((f) => ({ path: f.path, kind: f.kind, rows: f.rows.length })),
  };

  const dir = importDir(importId);
  await writeFile(
    path.join(dir, 'parsed-files.json'),
    JSON.stringify(parsedFiles.map((f) => ({ path: f.path, kind: f.kind, rows: f.rows.length, error: f.error })), null, 2),
  );
  await writeFile(
    path.join(dir, 'episodes.json'),
    JSON.stringify(Object.fromEntries(episodesByKey.entries())),
  );
  await writeFile(path.join(dir, 'import-report.json'), JSON.stringify(summary, null, 2));

  await prisma.import.update({
    where: { id: importRow.id },
    data: { status: 'analyzed', summaryJson: toJson(summary) },
  });
  return summary;
}

// ————— Application d'un mapping —————

async function loadEpisodesIndex(importId: string): Promise<Map<string, NormalizedImportedEpisode[]>> {
  try {
    const content = await readFile(path.join(importDir(importId), 'episodes.json'), 'utf-8');
    return new Map(Object.entries(JSON.parse(content) as Record<string, NormalizedImportedEpisode[]>));
  } catch {
    return new Map();
  }
}

async function ensureMediaForMapping(raw: MappingRaw, matchedMediaId: string | null): Promise<string | null> {
  if (matchedMediaId) return matchedMediaId;
  const normalized = raw.normalized;

  if (raw.decision === 'tmdb' && raw.tmdbId) {
    const media = await ensureMediaFromTmdb(normalized.mediaType === 'movie' ? 'movie' : 'show', raw.tmdbId);
    if (media) return media.id;
  }

  // Recherche TMDb par id externe si possible (enrichit automatiquement).
  if (tmdbEnabled() && normalized.tmdbId) {
    const media = await ensureMediaFromTmdb(normalized.mediaType === 'movie' ? 'movie' : 'show', normalized.tmdbId);
    if (media) return media.id;
  }

  if (normalized.mediaType === 'unknown') return null;

  // Garde anti-doublon : réutilise un média existant portant le même id externe
  // (tvdb/tmdb) avant d'en créer un. Sans ça, un show déjà présent (créé par le
  // flux TMDb/l'explorateur, ou lors d'un ré-import) était dupliqué. On préfère
  // le média le mieux renseigné (tmdbId + affiche non nuls trient en premier).
  const externalOr: Prisma.MediaWhereInput[] = [];
  if (normalized.tvdbId) externalOr.push({ tvdbId: normalized.tvdbId });
  if (normalized.tmdbId) externalOr.push({ tmdbId: normalized.tmdbId });
  if (externalOr.length > 0) {
    const existing = await prisma.media.findFirst({
      where: { type: normalized.mediaType, OR: externalOr },
      orderBy: [{ tmdbId: 'desc' }, { posterPath: 'desc' }],
    });
    if (existing) return existing.id;
  }

  // Création locale depuis les données importées (fonctionne hors ligne / sans clé TMDb).
  const media = await prisma.media.create({
    data: {
      type: normalized.mediaType,
      title: normalized.title,
      year: normalized.year,
      tvdbId: normalized.tvdbId,
      tmdbId: normalized.tmdbId,
      imdbId: normalized.imdbId,
      sourcePriority: 'import',
      ...(normalized.mediaType === 'show' ? { show: { create: {} } } : { movie: { create: {} } }),
    },
  });
  return media.id;
}

export async function applyMapping(
  userId: string,
  importId: string,
  mappingId: string,
  preloadedEpisodes?: Map<string, NormalizedImportedEpisode[]>,
): Promise<void> {
  const mapping = await prisma.importMapping.findUniqueOrThrow({ where: { id: mappingId } });
  const raw = fromJson<MappingRaw | null>(mapping.rawJson, null);
  if (!raw) return;
  const normalized = raw.normalized;

  const mediaId = await ensureMediaForMapping(raw, mapping.matchedMediaId);
  if (!mediaId) return;
  if (!mapping.matchedMediaId) {
    await prisma.importMapping.update({ where: { id: mappingId }, data: { matchedMediaId: mediaId } });
  }

  const media = await prisma.media.findUniqueOrThrow({ where: { id: mediaId }, include: { show: true } });

  // Statut + favori + note
  const isMovieWatched =
    media.type === 'movie' &&
    (normalized.status === 'watched' || normalized.status === 'completed' || !!normalized.watchedAt);
  const status = isMovieWatched ? 'completed' : mapImportedStatus(normalized.status, media.type);
  const watchedAt = normalized.watchedAt ? new Date(normalized.watchedAt) : undefined;

  await prisma.userMediaStatus.upsert({
    where: { userId_mediaId: { userId, mediaId } },
    create: {
      userId,
      mediaId,
      status,
      isFavorite: normalized.isFavorite ?? false,
      rating: normalized.rating,
      addedAt: normalized.addedAt ? new Date(normalized.addedAt) : new Date(),
      lastWatchedAt: watchedAt,
      completedAt: isMovieWatched ? watchedAt ?? new Date() : undefined,
    },
    update: {
      ...(normalized.isFavorite ? { isFavorite: true } : {}),
      ...(normalized.rating !== undefined ? { rating: normalized.rating } : {}),
      ...(isMovieWatched ? { status: 'completed', lastWatchedAt: watchedAt, completedAt: watchedAt ?? new Date() } : {}),
    },
  });

  if (isMovieWatched) {
    await prisma.watchEvent.create({
      data: {
        userId,
        mediaId,
        eventType: 'watched',
        eventDate: watchedAt ?? new Date(),
        source: 'import:tvtime',
      },
    });
  }

  // Listes personnelles
  for (const listName of normalized.listNames ?? []) {
    let list = await prisma.mediaList.findFirst({ where: { userId, title: listName } });
    if (!list) list = await prisma.mediaList.create({ data: { userId, title: listName } });
    const count = await prisma.listItem.count({ where: { listId: list.id } });
    await prisma.listItem
      .create({ data: { listId: list.id, mediaId, position: count } })
      .catch(() => undefined); // déjà présent
  }

  // Épisodes vus
  if (media.type === 'show' && media.show) {
    const episodesIndex = preloadedEpisodes ?? (await loadEpisodesIndex(importId));
    const keys = new Set<string>();
    if (normalized.tvdbId) keys.add(`tvdb:${normalized.tvdbId}`);
    keys.add(`show:${normalizeTitle(normalized.title)}`);
    const episodes = [...keys].flatMap((k) => episodesIndex.get(k) ?? []);

    let lastWatched: Date | null = null;
    for (const ep of episodes) {
      if (ep.seasonNumber === undefined || ep.episodeNumber === undefined) continue;
      const dbEpisode = await prisma.episode.upsert({
        where: {
          showId_seasonNumber_episodeNumber: {
            showId: media.show.id,
            seasonNumber: ep.seasonNumber,
            episodeNumber: ep.episodeNumber,
          },
        },
        create: {
          showId: media.show.id,
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
          title: ep.episodeTitle ?? `Épisode ${ep.episodeNumber}`,
          absoluteNumber: ep.absoluteNumber,
          tvdbId: ep.tvdbEpisodeId,
        },
        update: {},
      });
      const epWatchedAt = ep.watchedAt ? new Date(ep.watchedAt) : new Date();
      if (!lastWatched || epWatchedAt > lastWatched) lastWatched = epWatchedAt;
      await prisma.userEpisodeStatus.upsert({
        where: { userId_episodeId: { userId, episodeId: dbEpisode.id } },
        create: {
          userId,
          episodeId: dbEpisode.id,
          status: 'watched',
          watchedAt: epWatchedAt,
          rating: ep.rating,
        },
        update: { status: 'watched', watchedAt: epWatchedAt },
      });
      // Pas de watchEvent par épisode ici : un import TV Time peut contenir des
      // dizaines de milliers d'épisodes, ça inonderait le fil d'activité. Le
      // statut « vu » (userEpisodeStatus) suffit à la progression.
    }
    if (episodes.length > 0) {
      await recalculateShowStatus(userId, media.show.id, lastWatched);
    }
  }
}

export type ImportProgress = {
  phase: 'apply' | 'artwork' | 'sync' | 'done';
  done: number;
  total: number;
};

// Progression stockée dans summaryJson (à côté du résumé d'analyse) : pas de
// migration nécessaire, l'app la lit via GET /api/import/tvtime/:id.
async function setProgress(importId: string, progress: ImportProgress): Promise<void> {
  const row = await prisma.import.findUnique({ where: { id: importId } });
  const summary = fromJson<Record<string, unknown>>(row?.summaryJson ?? null, {});
  summary.progress = progress;
  await prisma.import.update({ where: { id: importId }, data: { summaryJson: toJson(summary) } });
}

// Pose l'affiche (et l'id TMDb) d'un média importé. Série : résout l'id TheTVDB
// → TMDb (l'export TV Time ne donne que des ids TheTVDB). Film : recherche TMDb
// par titre + année (l'export ne donne aucun id pour les films). On ne
// synchronise PAS la liste complète des épisodes ici : c'est trop lourd (ça
// bloquait l'app) et elle se charge à l'ouverture d'une série. La progression,
// elle, vient déjà du CSV (épisodes cochés posés à l'étape 1).
async function enrichImportedMedia(mediaId: string): Promise<void> {
  if (!tmdbEnabled()) return;
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media || media.tmdbId) return; // déjà enrichi
  if (media.type === 'show' && media.tvdbId) {
    const found = await tmdbFindByExternalId(String(media.tvdbId), 'tvdb_id').catch(() => null);
    const tv = found?.tv_results?.[0];
    if (tv) {
      await prisma.media.update({
        where: { id: mediaId },
        data: {
          tmdbId: String(tv.id),
          posterPath: media.posterPath ?? tv.poster_path ?? undefined,
          backdropPath: media.backdropPath ?? tv.backdrop_path ?? undefined,
          overview: media.overview ?? tv.overview ?? undefined,
          year: media.year ?? (tv.first_air_date ? new Date(tv.first_air_date).getFullYear() : undefined),
        },
      });
    }
  } else if (media.type === 'movie') {
    const results = await tmdbSearch(media.title, 'movie', media.year ?? undefined).catch(() => []);
    const m = results[0];
    if (m) {
      await prisma.media.update({
        where: { id: mediaId },
        data: {
          tmdbId: String(m.id),
          posterPath: media.posterPath ?? m.poster_path ?? undefined,
          backdropPath: media.backdropPath ?? m.backdrop_path ?? undefined,
          overview: media.overview ?? m.overview ?? undefined,
          year: media.year ?? (m.release_date ? new Date(m.release_date).getFullYear() : undefined),
        },
      });
    }
  }
}

// Lance l'import en tâche de fond et rend la main immédiatement : le volume
// (jusqu'à ~1000 séries / des dizaines de milliers d'épisodes) dépasse de loin
// le temps d'une requête HTTP. L'app suit la progression via le statut.
export async function confirmImport(userId: string, importId: string): Promise<{ status: string; total: number }> {
  // Anti-relance : tout import précédent encore « en cours » de cet utilisateur
  // est marqué échoué ; son job de fond s'arrêtera à sa prochaine vérification
  // (plus de jobs qui se marchent dessus quand on relance).
  await prisma.import.updateMany({
    where: { userId, status: 'importing', id: { not: importId } },
    data: { status: 'failed' },
  });
  const mappings = await prisma.importMapping.findMany({
    where: { importId, matchStatus: { in: ['matched_auto', 'matched_manual'] } },
    select: { id: true },
  });
  const total = mappings.length;
  await setProgress(importId, { phase: 'apply', done: 0, total });
  await prisma.import.update({ where: { id: importId }, data: { status: 'importing', errorJson: null } });
  void runImportJob(userId, importId, mappings.map((m) => m.id)).catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.import
      .update({ where: { id: importId }, data: { status: 'failed', errorJson: toJson({ message }) } })
      .catch(() => undefined);
  });
  return { status: 'importing', total };
}

// Auto-réparation : un import « importing » en base SANS job vivant dans ce
// process (crash / redémarrage serveur) est repris là où sa dernière
// progression s'était arrêtée. Appelé au polling du statut (GET :id) — le
// simple fait de rouvrir l'écran d'import relance donc un import interrompu.
export function resumeStalledImport(userId: string, importId: string): void {
  if (runningImportJobs.has(importId)) return;
  void (async () => {
    const row = await prisma.import.findUnique({ where: { id: importId } });
    if (!row || row.userId !== userId || row.status !== 'importing') return;
    const summary = fromJson<Record<string, unknown>>(row.summaryJson ?? null, {});
    const resume = (summary.progress as ImportProgress | undefined) ?? undefined;
    const mappings = await prisma.importMapping.findMany({
      where: { importId, matchStatus: { in: ['matched_auto', 'matched_manual'] } },
      select: { id: true },
    });
    await runImportJob(userId, importId, mappings.map((m) => m.id), resume);
  })().catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.import
      .update({ where: { id: importId }, data: { status: 'failed', errorJson: toJson({ message }) } })
      .catch(() => undefined);
  });
}

// Jobs d'import en cours DANS CE process : permet de détecter un import resté
// « importing » en base sans job vivant (crash / redémarrage serveur) et de le
// reprendre là où il s'était arrêté (cf. resumeStalledImport).
const runningImportJobs = new Set<string>();

async function runImportJob(
  userId: string,
  importId: string,
  mappingIds: string[],
  resume?: ImportProgress,
): Promise<void> {
  if (runningImportJobs.has(importId)) return;
  runningImportJobs.add(importId);
  try {
    await runImportJobInner(userId, importId, mappingIds, resume);
  } finally {
    runningImportJobs.delete(importId);
  }
}

async function runImportJobInner(
  userId: string,
  importId: string,
  mappingIds: string[],
  resume?: ImportProgress,
): Promise<void> {
  const errors: { mappingId: string; title: string; error: string }[] = [];
  const total = mappingIds.length;
  // S'arrête si l'import a été remplacé par un nouveau (anti-relance) ou annulé.
  const stillRunning = async () =>
    (await prisma.import.findUnique({ where: { id: importId }, select: { status: true } }))?.status === 'importing';

  // Reprise : les upserts étant idempotents, on saute simplement ce qui est déjà
  // fait (index `done` de la dernière progression écrite) et les phases passées.
  const resumePhase = resume?.phase ?? 'apply';
  const phaseRank: Record<ImportProgress['phase'], number> = { apply: 0, artwork: 1, sync: 2, done: 3 };

  // Étape 1/3 — statuts, favoris, épisodes vus (depuis le CSV, aucun appel réseau).
  if (phaseRank[resumePhase] <= 0) {
    const episodesIndex = await loadEpisodesIndex(importId);
    let done = resumePhase === 'apply' ? Math.max(0, (resume?.done ?? 0) - 20) : 0; // marge : la dernière tranche peut être partielle
    for (const mappingId of mappingIds.slice(done)) {
      try {
        await applyMapping(userId, importId, mappingId, episodesIndex);
      } catch (err) {
        const mapping = await prisma.importMapping.findUnique({ where: { id: mappingId } }).catch(() => null);
        errors.push({ mappingId, title: mapping?.sourceTitle ?? '?', error: err instanceof Error ? err.message : String(err) });
      }
      if (++done % 20 === 0 || done === total) {
        if (!(await stillRunning())) return;
        await setProgress(importId, { phase: 'apply', done, total });
      }
    }
  }

  const mediaMappings = await prisma.importMapping.findMany({
    where: { importId, matchStatus: { in: ['matched_auto', 'matched_manual'] }, matchedMediaId: { not: null } },
    select: { matchedMediaId: true },
  });
  const mediaIds = [...new Set(mediaMappings.map((m) => m.matchedMediaId).filter((x): x is string => !!x))];

  // Étape 2/3 — affiches (séries ET films).
  if (phaseRank[resumePhase] <= 1 && tmdbEnabled() && mediaIds.length > 0) {
    let done = resumePhase === 'artwork' ? Math.max(0, (resume?.done ?? 0) - 10) : 0;
    for (const mediaId of mediaIds.slice(done)) {
      await enrichImportedMedia(mediaId).catch(() => undefined);
      if (++done % 10 === 0 || done === mediaIds.length) {
        if (!(await stillRunning())) return;
        await setProgress(importId, { phase: 'artwork', done, total: mediaIds.length });
      }
    }
  }

  // Étape 3/3 — listes d'épisodes + DATES DE DIFFUSION des séries importées.
  // C'était l'étape supprimée « trop lourde » : sans elle, la file « À voir »
  // ignorait les séries importées (elle filtre sur airDate <= maintenant).
  // Ici elle tourne en tâche de fond (l'app n'attend pas), throttlée, et le
  // statut de chaque série est recalculé une fois ses épisodes connus.
  if (phaseRank[resumePhase] <= 2) {
    const shows = await prisma.media.findMany({
      where: { id: { in: mediaIds }, type: 'show' },
      select: { id: true, tvdbId: true, tmdbId: true, sourcePriority: true, show: { select: { id: true } } },
    });
    let done = resumePhase === 'sync' ? Math.max(0, (resume?.done ?? 0) - 10) : 0;
    for (const m of shows.slice(done)) {
      try {
        if (m.sourcePriority === 'tvdb' && m.tvdbId && tvdbEnabled()) await syncEpisodesFromTvdb(m.id);
        else if (m.tmdbId && tmdbEnabled()) await syncShowEpisodesFromTmdb(m.id);
        else if (m.tvdbId && tvdbEnabled()) await syncEpisodesFromTvdb(m.id);
        else {
          done++;
          continue;
        }
        await prisma.media.update({ where: { id: m.id }, data: { lastSyncedAt: new Date() } });
        if (m.show) await recalculateShowStatus(userId, m.show.id, null).catch(() => undefined);
      } catch {
        /* best-effort : une série en échec n'arrête pas l'import */
      }
      if (++done % 10 === 0 || done === shows.length) {
        if (!(await stillRunning())) return;
        await setProgress(importId, { phase: 'sync', done, total: shows.length });
      }
      await new Promise((r) => setTimeout(r, 150)); // throttle TVDB/TMDb
    }
  }

  await setProgress(importId, { phase: 'done', done: total, total });
  await prisma.import.update({
    where: { id: importId },
    data: { status: 'imported', errorJson: errors.length > 0 ? toJson(errors) : null },
  });
  await prisma.notification.create({
    data: {
      userId,
      type: 'import_done',
      title: 'Import terminé',
      body: `${total - errors.length} séries et films importés depuis votre archive TV Time.`,
      date: new Date(),
    },
  });
}

export { markEpisodeWatched };
