import type { Media } from '@prisma/client';
import { prisma } from '../../db/client.js';
import {
  tmdbCredits,
  tmdbEnabled,
  tmdbMovieDetails,
  tmdbSeasonDetails,
  tmdbShowDetails,
  tmdbWatchProviders,
} from './client.js';
import { env } from '../../config/env.js';

function parseDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Crée ou retrouve un Media local à partir d'un id TMDb.
export async function ensureMediaFromTmdb(type: 'show' | 'movie', tmdbId: string): Promise<Media | null> {
  const existing = await prisma.media.findFirst({ where: { type, tmdbId } });
  if (existing) return existing;
  if (!tmdbEnabled()) return null;

  if (type === 'movie') {
    const details = await tmdbMovieDetails(tmdbId);
    if (!details) return null;
    const media = await prisma.media.create({
      data: {
        type: 'movie',
        title: details.title,
        originalTitle: details.original_title,
        overview: details.overview,
        posterPath: details.poster_path,
        backdropPath: details.backdrop_path,
        releaseDate: parseDate(details.release_date),
        year: details.release_date ? new Date(details.release_date).getFullYear() : undefined,
        runtime: details.runtime ?? undefined,
        status: details.status,
        genres: details.genres?.map((g) => g.name).join(', '),
        originalLanguage: details.original_language,
        popularity: details.popularity,
        voteAverage: details.vote_average,
        voteCount: details.vote_count,
        tmdbId: String(details.id),
        imdbId: details.imdb_id ?? undefined,
        sourcePriority: 'tmdb',
        lastSyncedAt: new Date(),
        movie: { create: { homepage: details.homepage ?? undefined } },
      },
    });
    return media;
  }

  const details = await tmdbShowDetails(tmdbId, false);
  if (!details) return null;
  const media = await prisma.media.create({
    data: {
      type: 'show',
      title: details.name,
      originalTitle: details.original_name,
      overview: details.overview,
      posterPath: details.poster_path,
      backdropPath: details.backdrop_path,
      firstAirDate: parseDate(details.first_air_date),
      year: details.first_air_date ? new Date(details.first_air_date).getFullYear() : undefined,
      status: details.status,
      genres: details.genres?.map((g) => g.name).join(', '),
      originalLanguage: details.original_language,
      originCountry: details.origin_country?.join(','),
      runtime: details.episode_run_time?.[0],
      popularity: details.popularity,
      voteAverage: details.vote_average,
      voteCount: details.vote_count,
      tmdbId: String(details.id),
      tvdbId: details.external_ids?.tvdb_id ? String(details.external_ids.tvdb_id) : undefined,
      imdbId: details.external_ids?.imdb_id ?? undefined,
      sourcePriority: 'tmdb',
      lastSyncedAt: new Date(),
      show: {
        create: {
          numberOfSeasons: details.number_of_seasons,
          numberOfEpisodes: details.number_of_episodes,
          inProduction: details.in_production,
          network: details.networks?.[0]?.name,
          nextEpisodeAirDate: parseDate(details.next_episode_to_air?.air_date),
          lastEpisodeAirDate: parseDate(details.last_episode_to_air?.air_date),
        },
      },
    },
  });
  // Épisodes : pour un ANIMÉ, TheTVDB découpe correctement les saisons (S1/S2…)
  // et suit les nouvelles diffusions, alors que TMDb fusionne souvent les saisons
  // d'animés. On préfère donc TheTVDB quand l'ID est connu, et on marque la source
  // (sourcePriority='tvdb') pour rester cohérent aux rafraîchissements suivants.
  const isAnime =
    (media.genres ?? '').toLowerCase().includes('animation') &&
    (media.originalLanguage === 'ja' || (media.originCountry ?? '').includes('JP'));
  if (isAnime && media.tvdbId) {
    const { tvdbEnabled, syncEpisodesFromTvdb } = await import('../tvdb/index.js');
    if (tvdbEnabled()) {
      await syncEpisodesFromTvdb(media.id).catch(() => undefined);
      const count = await prisma.episode.count({ where: { show: { mediaId: media.id } } });
      if (count > 0) {
        await prisma.media.update({ where: { id: media.id }, data: { sourcePriority: 'tvdb' } });
        return media;
      }
    }
  }
  await syncShowEpisodesFromTmdb(media.id);
  return media;
}

// Synchronise saisons + épisodes d'une série depuis TMDb.
export async function syncShowEpisodesFromTmdb(mediaId: string): Promise<void> {
  if (!tmdbEnabled()) return;
  const media = await prisma.media.findUnique({ where: { id: mediaId }, include: { show: true } });
  if (!media?.show || !media.tmdbId) return;
  const ended = media.status ? /ended|canceled|cancelled/i.test(media.status) : false;
  const details = await tmdbShowDetails(media.tmdbId, ended);
  if (!details) return;

  await prisma.show.update({
    where: { id: media.show.id },
    data: {
      numberOfSeasons: details.number_of_seasons,
      numberOfEpisodes: details.number_of_episodes,
      inProduction: details.in_production,
      network: details.networks?.[0]?.name ?? media.show.network,
      nextEpisodeAirDate: parseDate(details.next_episode_to_air?.air_date) ?? null,
      lastEpisodeAirDate: parseDate(details.last_episode_to_air?.air_date) ?? null,
    },
  });
  await prisma.media.update({
    where: { id: mediaId },
    data: { status: details.status, lastSyncedAt: new Date() },
  });

  for (const season of details.seasons ?? []) {
    const dbSeason = await prisma.season.upsert({
      where: { showId_seasonNumber: { showId: media.show.id, seasonNumber: season.season_number } },
      create: {
        showId: media.show.id,
        seasonNumber: season.season_number,
        title: season.name,
        overview: season.overview,
        posterPath: season.poster_path,
        airDate: parseDate(season.air_date),
        episodeCount: season.episode_count,
        tmdbId: String(season.id),
      },
      update: {
        title: season.name,
        posterPath: season.poster_path,
        episodeCount: season.episode_count,
      },
    });
    const seasonDetails = await tmdbSeasonDetails(media.tmdbId, season.season_number, ended);
    for (const ep of seasonDetails?.episodes ?? []) {
      await prisma.episode.upsert({
        where: {
          showId_seasonNumber_episodeNumber: {
            showId: media.show.id,
            seasonNumber: ep.season_number,
            episodeNumber: ep.episode_number,
          },
        },
        create: {
          showId: media.show.id,
          seasonId: dbSeason.id,
          seasonNumber: ep.season_number,
          episodeNumber: ep.episode_number,
          title: ep.name ?? `Épisode ${ep.episode_number}`,
          overview: ep.overview,
          stillPath: ep.still_path,
          airDate: parseDate(ep.air_date),
          runtime: ep.runtime ?? undefined,
          tmdbId: String(ep.id),
        },
        update: {
          seasonId: dbSeason.id,
          title: ep.name ?? undefined,
          overview: ep.overview,
          stillPath: ep.still_path,
          airDate: parseDate(ep.air_date) ?? null,
          runtime: ep.runtime ?? undefined,
        },
      });
    }
  }
}

export async function syncProvidersFromTmdb(mediaId: string): Promise<void> {
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media?.tmdbId) return;
  const fresh = await prisma.provider.findFirst({
    where: { mediaId, fetchedAt: { gt: new Date(Date.now() - 7 * 86_400_000) } },
  });
  if (fresh) return;
  const data = await tmdbWatchProviders(media.type === 'show' ? 'tv' : 'movie', media.tmdbId);
  const country = data?.results?.[env.DEFAULT_COUNTRY];
  if (!country) return;
  await prisma.provider.deleteMany({ where: { mediaId } });
  const offers: { name: string; logo?: string | null; type: string }[] = [
    ...(country.flatrate ?? []).map((p) => ({ name: p.provider_name, logo: p.logo_path, type: 'flatrate' })),
    ...(country.rent ?? []).map((p) => ({ name: p.provider_name, logo: p.logo_path, type: 'rent' })),
    ...(country.buy ?? []).map((p) => ({ name: p.provider_name, logo: p.logo_path, type: 'buy' })),
  ];
  for (const offer of offers) {
    await prisma.provider.create({
      data: {
        mediaId,
        countryCode: env.DEFAULT_COUNTRY,
        providerName: offer.name,
        providerLogoPath: offer.logo,
        offerType: offer.type,
        url: country.link,
        source: 'tmdb',
        fetchedAt: new Date(),
      },
    });
  }
}

export async function syncCreditsFromTmdb(mediaId: string): Promise<void> {
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media?.tmdbId) return;
  const existing = await prisma.credit.count({ where: { mediaId } });
  if (existing > 0) return;
  const credits = await tmdbCredits(media.type === 'show' ? 'tv' : 'movie', media.tmdbId);
  for (const cast of (credits?.cast ?? []).slice(0, 20)) {
    let person = await prisma.person.findFirst({ where: { tmdbId: String(cast.id) } });
    if (!person) {
      person = await prisma.person.create({
        data: { name: cast.name, profilePath: cast.profile_path, tmdbId: String(cast.id) },
      });
    }
    await prisma.credit.create({
      data: {
        mediaId,
        personId: person.id,
        roleType: 'cast',
        characterName: cast.character,
        orderIndex: cast.order,
      },
    });
  }
}
