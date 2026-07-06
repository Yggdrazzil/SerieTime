import type { Media } from '@prisma/client';
import { prisma } from '../../db/client.js';
import {
  tvdbEnabled,
  tvdbLanguage,
  tvdbSeriesEpisodes,
  tvdbSeriesExtended,
  tvdbSeriesTranslation,
} from './client.js';

function parseDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Crée (ou retrouve) une série locale à partir d'un id TheTVDB, avec ses épisodes.
export async function ensureShowFromTvdb(tvdbId: string): Promise<Media | null> {
  const existing = await prisma.media.findFirst({ where: { type: 'show', tvdbId: String(tvdbId) } });
  if (existing) {
    // Resynchronise en arrière-plan (titres localisés, nouveaux épisodes) sans
    // faire attendre l'utilisateur.
    syncEpisodesFromTvdb(existing.id).catch(() => undefined);
    return existing;
  }
  if (!tvdbEnabled()) return null;

  const ext = await tvdbSeriesExtended(tvdbId);
  if (!ext) return null;
  // Traduction dans la langue de l'app, sinon anglais (utile pour les titres non latins).
  const fra =
    (await tvdbSeriesTranslation(tvdbId, tvdbLanguage())) ??
    (tvdbLanguage() !== 'eng' ? await tvdbSeriesTranslation(tvdbId, 'eng') : null);

  const officialSeasons = (ext.seasons ?? []).filter((s) => s.type?.type === 'official');

  const media = await prisma.media.create({
    data: {
      type: 'show',
      title: ext.name,
      localizedTitle: fra?.name ?? undefined,
      overview: ext.overview ?? undefined,
      localizedOverview: fra?.overview ?? undefined,
      posterPath: ext.image ?? undefined,
      firstAirDate: parseDate(ext.firstAired),
      year: ext.year ? Number(ext.year) : parseDate(ext.firstAired)?.getFullYear(),
      status: ext.status?.name,
      originalLanguage: ext.originalLanguage,
      genres: ext.genres?.map((g) => g.name).join(', '),
      tvdbId: String(tvdbId),
      sourcePriority: 'tvdb',
      lastSyncedAt: new Date(),
      show: {
        create: {
          numberOfSeasons: officialSeasons.length || undefined,
          network: ext.latestNetwork?.name,
        },
      },
    },
    include: { show: true },
  });

  await syncEpisodesFromTvdb(media.id);
  return media;
}

// Importe les épisodes TheTVDB (+ saisons) d'une série déjà créée localement.
// Optimisé pour les séries fleuves (>1000 épisodes) : une seule écriture de
// saison par saison, épisodes triés entre créations en masse (createMany) et
// mises à jour, le tout par lots transactionnels.
export async function syncEpisodesFromTvdb(mediaId: string): Promise<void> {
  if (!tvdbEnabled()) return;
  const media = await prisma.media.findUnique({ where: { id: mediaId }, include: { show: true } });
  if (!media?.show || !media.tvdbId) return;
  const showId = media.show.id;

  const episodes = (await tvdbSeriesEpisodes(media.tvdbId)).filter(
    (ep) => ep.seasonNumber != null && ep.number != null,
  );
  if (episodes.length === 0) return;

  // 1) Une saison = un upsert.
  const seasonNumbers = [...new Set(episodes.map((e) => e.seasonNumber))];
  const seasonIdByNumber = new Map<number, string>();
  for (const seasonNumber of seasonNumbers) {
    const season = await prisma.season.upsert({
      where: { showId_seasonNumber: { showId, seasonNumber } },
      create: {
        showId,
        seasonNumber,
        title: seasonNumber === 0 ? 'Spéciaux' : `Saison ${seasonNumber}`,
      },
      update: {},
    });
    seasonIdByNumber.set(seasonNumber, season.id);
  }

  // 2) Épisodes existants en une requête, pour séparer créations et mises à jour.
  const existing = await prisma.episode.findMany({
    where: { showId },
    select: { seasonNumber: true, episodeNumber: true },
  });
  const existingKeys = new Set(existing.map((e) => `${e.seasonNumber}:${e.episodeNumber}`));
  const toCreate = episodes.filter((e) => !existingKeys.has(`${e.seasonNumber}:${e.number}`));
  const toUpdate = episodes.filter((e) => existingKeys.has(`${e.seasonNumber}:${e.number}`));

  // 3) Créations en masse.
  if (toCreate.length > 0) {
    await prisma.episode.createMany({
      data: toCreate.map((ep) => ({
        showId,
        seasonId: seasonIdByNumber.get(ep.seasonNumber),
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.number,
        title: ep.name ?? `Épisode ${ep.number}`,
        overview: ep.overview,
        stillPath: ep.image,
        airDate: parseDate(ep.aired),
        runtime: ep.runtime ?? undefined,
        tvdbId: String(ep.id),
      })),
    });
  }

  // 4) Mises à jour par lots transactionnels (une resync de série existante).
  for (let i = 0; i < toUpdate.length; i += 200) {
    await prisma.$transaction(
      toUpdate.slice(i, i + 200).map((ep) =>
        prisma.episode.update({
          where: {
            showId_seasonNumber_episodeNumber: {
              showId,
              seasonNumber: ep.seasonNumber,
              episodeNumber: ep.number,
            },
          },
          data: {
            seasonId: seasonIdByNumber.get(ep.seasonNumber),
            title: ep.name ?? undefined,
            overview: ep.overview,
            stillPath: ep.image,
            airDate: parseDate(ep.aired) ?? null,
            runtime: ep.runtime ?? undefined,
          },
        }),
      ),
    );
  }
}
