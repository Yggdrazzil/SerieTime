import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { tmdbPerson, tmdbSearchPerson, type TmdbPersonCredit } from '../../services/tmdb/index.js';

// Genres TMDb (ids standard) en français — pour la filmographie façon TV Time.
const GENRES_FR: Record<number, string> = {
  28: 'Action', 12: 'Aventure', 16: 'Animation', 35: 'Comédie', 80: 'Crime',
  99: 'Documentaire', 18: 'Drame', 10751: 'Famille', 14: 'Fantastique',
  36: 'Histoire', 27: 'Horreur', 10402: 'Musique', 9648: 'Mystère',
  10749: 'Romance', 878: 'Science-fiction', 10770: 'Téléfilm', 53: 'Thriller',
  10752: 'Guerre', 37: 'Western', 10759: 'Action & Aventure', 10762: 'Enfants',
  10763: 'Actualités', 10764: 'Téléréalité', 10765: 'Science-fiction & Fantastique',
  10766: 'Soap', 10767: 'Talk-show', 10768: 'Guerre & Politique',
};

function filmographyOf(credits: TmdbPersonCredit[] | undefined) {
  const seen = new Set<string>();
  return (credits ?? [])
    .filter((c) => (c.media_type === 'tv' || c.media_type === 'movie') && (c.name || c.title))
    .filter((c) => {
      const key = `${c.media_type}:${c.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.first_air_date ?? b.release_date ?? '').localeCompare(a.first_air_date ?? a.release_date ?? ''))
    .slice(0, 60)
    .map((c) => ({
      tmdbId: String(c.id),
      mediaType: c.media_type === 'tv' ? 'show' : 'movie',
      title: c.name ?? c.title ?? '',
      character: c.character || null,
      year: (c.first_air_date ?? c.release_date ?? '').slice(0, 4) || null,
      posterPath: c.poster_path ?? null,
      episodeCount: c.episode_count ?? null,
      rating: typeof c.vote_average === 'number' ? c.vote_average : null, // sur 10
      genres: (c.genre_ids ?? []).map((g) => GENRES_FR[g]).filter(Boolean).slice(0, 5),
    }));
}

// Fiche personne (acteur / doubleur) façon TV Time : photo, bio, naissance,
// réseaux, filmographie. Données TMDb (gratuites), mises en cache 30 j.
export async function peopleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/people/:tmdbId', async (request, reply) => {
    const { tmdbId } = request.params as { tmdbId: string };
    const p = await tmdbPerson(tmdbId);
    if (!p) return reply.code(404).send({ error: 'not_found' });
    return {
      person: {
        tmdbId: String(p.id),
        name: p.name,
        biography: p.biography || null,
        birthday: p.birthday ?? null,
        deathday: p.deathday ?? null,
        placeOfBirth: p.place_of_birth ?? null,
        profilePath: p.profile_path ?? null,
        twitter: p.external_ids?.twitter_id || null,
        instagram: p.external_ids?.instagram_id || null,
        filmography: filmographyOf(p.combined_credits?.cast),
      },
    };
  });

  // Résolution par nom (cast provenant de TheTVDB, sans id TMDb).
  app.get('/api/people/search', async (request, reply) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(request.query ?? {});
    const results = (await tmdbSearchPerson(name)) as { id?: number }[];
    const first = results.find((r) => r.id);
    if (!first?.id) return reply.code(404).send({ error: 'not_found' });
    return { tmdbId: String(first.id) };
  });
}
