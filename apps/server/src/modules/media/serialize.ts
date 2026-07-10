import type { Media, Episode, UserMediaStatus } from '@prisma/client';
import type { EpisodeDto, MediaDto } from '@serietime/types';

export function serializeMedia(media: Media, status?: UserMediaStatus | null): MediaDto {
  return {
    id: media.id,
    type: media.type as MediaDto['type'],
    title: media.localizedTitle ?? media.title,
    originalTitle: media.originalTitle,
    overview: media.localizedOverview ?? media.overview,
    posterPath: media.posterPath,
    backdropPath: media.backdropPath,
    year: media.year,
    firstAirDate: media.firstAirDate?.toISOString() ?? null,
    releaseDate: media.releaseDate?.toISOString() ?? null,
    status: media.status,
    runtime: media.runtime,
    genres: media.genres,
    voteAverage: media.voteAverage,
    tmdbId: media.tmdbId,
    tvdbId: media.tvdbId,
    imdbId: media.imdbId,
    userStatus: (status?.status as MediaDto['userStatus']) ?? null,
    isFavorite: status?.isFavorite ?? false,
    favoriteOrder: status?.favoriteOrder ?? null,
    favoritedAt: status?.favoritedAt?.toISOString() ?? null,
    rating: status?.rating ?? null,
  };
}

export function serializeEpisode(
  episode: Episode,
  show: { mediaId: string; network: string | null; platform: string | null },
  showTitle: string,
  userStatus?: { status: string; watchedAt: Date | null } | null,
): EpisodeDto {
  return {
    id: episode.id,
    showId: episode.showId,
    showMediaId: show.mediaId,
    showTitle,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    absoluteNumber: episode.absoluteNumber,
    title: episode.localizedTitle ?? episode.title,
    overview: episode.localizedOverview ?? episode.overview,
    stillPath: episode.stillPath,
    airDate: episode.airDate?.toISOString() ?? null,
    airTime: episode.airTime,
    runtime: episode.runtime,
    network: show.platform ?? show.network,
    watched: userStatus?.status === 'watched',
    watchedAt: userStatus?.watchedAt?.toISOString() ?? null,
  };
}
