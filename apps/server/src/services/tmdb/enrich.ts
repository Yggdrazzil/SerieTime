import type { Media } from '@prisma/client';
import { prisma } from '../../db/client.js';
import {
  CONTENT_LANGS,
  tmdbCredits,
  tmdbFindByExternalId,
  tmdbEnabled,
  tmdbMovieDetails,
  tmdbSeasonDetails,
  tmdbShowDetails,
  tmdbTranslations,
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

// Plateformes de simulcast anime disponibles en France (les plus à jour pour
// les nouveaux épisodes). Pour un anime, on les remonte en tête ; sinon on garde
// l'ordre TMDb (priorité commerciale, où Netflix passe souvent devant).
const ANIME_FIRST_PROVIDERS = ['crunchyroll', 'animation digital network', 'adn', 'wakanim'];

export function isAnimeMedia(media: {
  genres?: string | null;
  originalLanguage?: string | null;
  originCountry?: string | null;
}): boolean {
  return (
    (media.genres ?? '').toLowerCase().includes('animation') &&
    (media.originalLanguage === 'ja' || (media.originCountry ?? '').includes('JP'))
  );
}

// Ordre d'affichage des plateformes (déjà limitées à la France en amont) :
// abonnement d'abord, puis gratuit/pub, puis location/achat. Pour un anime, les
// plateformes de simulcast FR (Crunchyroll, ADN) passent devant Netflix & co.
export function orderProvidersForMedia<T extends { providerName: string; offerType: string }>(
  providers: T[],
  media: { genres?: string | null; originalLanguage?: string | null; originCountry?: string | null },
): T[] {
  const anime = isAnimeMedia(media);
  const rank = (p: T): number => {
    if (anime) {
      const idx = ANIME_FIRST_PROVIDERS.findIndex((n) => p.providerName.toLowerCase().includes(n));
      if (idx !== -1) return idx - 100;
    }
    return p.offerType === 'flatrate' ? 0 : p.offerType === 'free' || p.offerType === 'ads' ? 1 : 2;
  };
  return [...providers].sort((a, b) => rank(a) - rank(b));
}

// Les animés ajoutés via TheTVDB seul n'ont pas de tmdbId : on le retrouve via
// /find (id TVDB) pour débloquer distribution, recommandations, bande-annonce
// et plateformes — comme TV Time.
export async function ensureTmdbIdFromTvdb(mediaId: string): Promise<boolean> {
  if (!tmdbEnabled()) return false;
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media || media.tmdbId || !media.tvdbId) return false;
  const found = await tmdbFindByExternalId(media.tvdbId, 'tvdb_id');
  const hit = media.type === 'show' ? found?.tv_results?.[0] : found?.movie_results?.[0];
  if (!hit?.id) return false;
  await prisma.media.update({ where: { id: mediaId }, data: { tmdbId: String(hit.id) } });
  return true;
}

// Traductions de titres/résumés (langue de contenu par utilisateur) : UNE seule
// requête TMDb (/translations) récupère les 5 langues cibles (en/es/de/it/pt),
// stockées dans Media.translationsJson. Le français reste porté par
// localizedTitle/localizedOverview. Retourne le JSON à jour (ou null si skip).
export async function syncTranslationsFromTmdb(
  media: Pick<Media, 'id' | 'type' | 'tmdbId' | 'translationsJson'>,
): Promise<string | null> {
  if (!media.tmdbId || !tmdbEnabled()) return null; // skip silencieux (ex. série TVDB seule)
  if (media.type !== 'show' && media.type !== 'movie') return null;
  const data = await tmdbTranslations(media.type === 'show' ? 'tv' : 'movie', media.tmdbId);
  if (!data?.translations) return null;
  const existing = parseTranslations(media.translationsJson);
  const next: Record<string, { title?: string; overview?: string }> = { ...existing };
  for (const lang of CONTENT_LANGS) {
    const t = data.translations.find((tr) => tr.iso_639_1 === lang);
    const title = (t?.data?.name || t?.data?.title || '').trim();
    if (!title) continue;
    const overview = (t?.data?.overview ?? '').trim();
    next[lang] = { title, ...(overview ? { overview } : {}) };
  }
  const json = JSON.stringify(next);
  await prisma.media.update({ where: { id: media.id }, data: { translationsJson: json } });
  return json;
}

export function parseTranslations(
  json: string | null | undefined,
): Record<string, { title?: string; overview?: string }> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, { title?: string; overview?: string }>;
  } catch {
    return {};
  }
}

// Backfill (changement de langue dans les Paramètres) : traduit EN SÉRIE toute
// la bibliothèque suivie de l'utilisateur (séries + films avec tmdbId auxquels
// il manque la langue), avec throttle — même pattern que la phase sync de
// l'import TV Time. Un seul backfill à la fois par utilisateur.
const backfillRunning = new Set<string>();

export async function backfillUserTranslations(userId: string, lang: string): Promise<void> {
  if (backfillRunning.has(userId) || !tmdbEnabled()) return;
  backfillRunning.add(userId);
  try {
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId, media: { type: { in: ['show', 'movie'] }, tmdbId: { not: null } } },
      select: { media: { select: { id: true, type: true, tmdbId: true, translationsJson: true } } },
    });
    for (const { media } of statuses) {
      if (parseTranslations(media.translationsJson)[lang]?.title) continue;
      await syncTranslationsFromTmdb(media).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 150)); // throttle TMDb
    }
  } finally {
    backfillRunning.delete(userId);
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

// Année plausible tirée d'une chaîne de date (ou undefined). Utilisé par la
// resync : d'anciennes fiches portent une année aberrante (1, 0…) ; on la
// recalcule depuis la vraie date renvoyée par la source.
function plausibleYearFromDate(dateStr?: string | null): number | undefined {
  if (!dateStr) return undefined;
  const y = new Date(dateStr).getFullYear();
  const max = new Date().getFullYear() + 10;
  return Number.isFinite(y) && y >= 1888 && y <= max ? y : undefined;
}

export type MetadataResync = 'updated' | 'skipped' | 'unavailable';

// Rafraîchit les MÉTADONNÉES FACTUELLES d'un média EXISTANT depuis sa source
// (TMDb films/séries, TheTVDB séries sans tmdbId) : année, dates, durée,
// genres, notes, statut, langue, ids externes (+ sous-champs série). Ne touche
// VOLONTAIREMENT PAS : affiches/bannières (posterPath/backdropPath, souvent
// personnalisées), titres/résumés, traductions, épisodes, ni données
// utilisateur. Utilisé par le script de resync globale des métadonnées.
export async function refreshMediaMetadata(
  media: Pick<Media, 'id' | 'type' | 'tmdbId' | 'tvdbId'>,
): Promise<MetadataResync> {
  if (media.type === 'movie') {
    if (!media.tmdbId || !tmdbEnabled()) return 'skipped';
    const d = await tmdbMovieDetails(media.tmdbId);
    if (!d) return 'unavailable';
    await prisma.media.update({
      where: { id: media.id },
      data: {
        releaseDate: parseDate(d.release_date),
        // `?? null` : on efface explicitement une année aberrante quand la
        // source n'a pas de date (sinon `undefined` laisserait le « 1 »).
        year: plausibleYearFromDate(d.release_date) ?? null,
        runtime: d.runtime ?? undefined,
        status: d.status ?? undefined,
        genres: d.genres?.length ? d.genres.map((g) => g.name).join(', ') : undefined,
        originalLanguage: d.original_language ?? undefined,
        popularity: d.popularity ?? undefined,
        voteAverage: d.vote_average ?? undefined,
        voteCount: d.vote_count ?? undefined,
        imdbId: d.imdb_id ?? undefined,
        lastSyncedAt: new Date(),
      },
    });
    return 'updated';
  }

  // Série avec tmdbId : TMDb (métadonnées factuelles les plus riches).
  if (media.tmdbId && tmdbEnabled()) {
    const d = await tmdbShowDetails(media.tmdbId, false);
    if (!d) return 'unavailable';
    await prisma.media.update({
      where: { id: media.id },
      data: {
        firstAirDate: parseDate(d.first_air_date),
        year: plausibleYearFromDate(d.first_air_date) ?? null,
        status: d.status ?? undefined,
        genres: d.genres?.length ? d.genres.map((g) => g.name).join(', ') : undefined,
        originalLanguage: d.original_language ?? undefined,
        originCountry: d.origin_country?.join(',') ?? undefined,
        runtime: d.episode_run_time?.[0] ?? undefined,
        popularity: d.popularity ?? undefined,
        voteAverage: d.vote_average ?? undefined,
        voteCount: d.vote_count ?? undefined,
        imdbId: d.external_ids?.imdb_id ?? undefined,
        lastSyncedAt: new Date(),
        show: {
          update: {
            numberOfSeasons: d.number_of_seasons ?? undefined,
            numberOfEpisodes: d.number_of_episodes ?? undefined,
            inProduction: d.in_production ?? undefined,
            network: d.networks?.[0]?.name ?? undefined,
            nextEpisodeAirDate: parseDate(d.next_episode_to_air?.air_date),
            lastEpisodeAirDate: parseDate(d.last_episode_to_air?.air_date),
          },
        },
      },
    });
    return 'updated';
  }

  // Série sans tmdbId mais avec tvdbId : TheTVDB.
  if (media.tvdbId) {
    const { tvdbEnabled, tvdbSeriesExtended } = await import('../tvdb/client.js');
    if (!tvdbEnabled()) return 'skipped';
    const ext = await tvdbSeriesExtended(media.tvdbId);
    if (!ext) return 'unavailable';
    const tvdbYear = ext.year ? Number(ext.year) : NaN;
    const maxY = new Date().getFullYear() + 10;
    const year =
      Number.isFinite(tvdbYear) && tvdbYear >= 1888 && tvdbYear <= maxY
        ? tvdbYear
        : plausibleYearFromDate(ext.firstAired) ?? null;
    await prisma.media.update({
      where: { id: media.id },
      data: {
        firstAirDate: parseDate(ext.firstAired),
        year,
        status: ext.status?.name ?? undefined,
        genres: ext.genres?.length ? ext.genres.map((g) => g.name).join(', ') : undefined,
        originalLanguage: ext.originalLanguage ?? undefined,
        lastSyncedAt: new Date(),
      },
    });
    return 'updated';
  }

  // Jeux (IGDB) et fiches sans identifiant externe : hors périmètre.
  return 'skipped';
}
