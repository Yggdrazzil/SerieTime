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
  if (existing) return existing;
  if (!tvdbEnabled()) return null;

  const ext = await tvdbSeriesExtended(tvdbId);
  if (!ext) return null;
  const fra = await tvdbSeriesTranslation(tvdbId, tvdbLanguage());

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
export async function syncEpisodesFromTvdb(mediaId: string): Promise<void> {
  if (!tvdbEnabled()) return;
  const media = await prisma.media.findUnique({ where: { id: mediaId }, include: { show: true } });
  if (!media?.show || !media.tvdbId) return;

  const episodes = await tvdbSeriesEpisodes(media.tvdbId);
  for (const ep of episodes) {
    if (ep.seasonNumber == null || ep.number == null) continue;
    const season = await prisma.season.upsert({
      where: { showId_seasonNumber: { showId: media.show.id, seasonNumber: ep.seasonNumber } },
      create: {
        showId: media.show.id,
        seasonNumber: ep.seasonNumber,
        title: ep.seasonNumber === 0 ? 'Spéciaux' : `Saison ${ep.seasonNumber}`,
      },
      update: {},
    });
    await prisma.episode.upsert({
      where: {
        showId_seasonNumber_episodeNumber: {
          showId: media.show.id,
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.number,
        },
      },
      create: {
        showId: media.show.id,
        seasonId: season.id,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.number,
        title: ep.name ?? `Épisode ${ep.number}`,
        overview: ep.overview,
        stillPath: ep.image,
        airDate: parseDate(ep.aired),
        runtime: ep.runtime ?? undefined,
        tvdbId: String(ep.id),
      },
      update: {
        seasonId: season.id,
        title: ep.name ?? undefined,
        overview: ep.overview,
        stillPath: ep.image,
        airDate: parseDate(ep.aired) ?? null,
        runtime: ep.runtime ?? undefined,
      },
    });
  }
}
