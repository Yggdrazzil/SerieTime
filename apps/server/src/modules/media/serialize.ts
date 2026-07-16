import type { Media, Episode, UserMediaStatus } from '@prisma/client';
import type { EpisodeDto, MediaDto } from '@serietime/types';
import { parseTranslations } from '../../services/tmdb/enrich.js';

type TranslatableMedia = Pick<Media, 'title' | 'localizedTitle' | 'translationsJson'>;

// Traduction pour la langue de contenu de l'utilisateur. fr (défaut) et jeux
// (pas de translationsJson) → {} : on retombe sur les champs existants.
function translationFor(
  media: Pick<Media, 'translationsJson'>,
  lang?: string | null,
): { title?: string; overview?: string } {
  if (!lang || lang === 'fr') return {};
  return parseTranslations(media.translationsJson)[lang] ?? {};
}

// Titre affiché d'un média dans la langue de contenu demandée (fallback
// silencieux sur localizedTitle/title) — pour les routes qui construisent le
// titre à la main (showTitle des épisodes, fil social, recherche locale).
export function mediaTitle(media: TranslatableMedia, lang?: string | null): string {
  return translationFor(media, lang).title ?? media.localizedTitle ?? media.title;
}

export function serializeMedia(media: Media, status?: UserMediaStatus | null, lang?: string | null): MediaDto {
  const translated = translationFor(media, lang);
  return {
    id: media.id,
    type: media.type as MediaDto['type'],
    title: translated.title ?? media.localizedTitle ?? media.title,
    originalTitle: media.originalTitle,
    overview: translated.overview ?? media.localizedOverview ?? media.overview,
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
