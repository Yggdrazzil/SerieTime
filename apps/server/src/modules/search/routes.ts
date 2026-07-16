import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { mediaTitle, serializeMedia } from '../media/serialize.js';
import { getUserLang } from '../media/userLang.js';
import { parseTranslations, tmdbEnabled, tmdbKeywordNames, tmdbSearch, tmdbSearchPerson, tmdbTrending } from '../../services/tmdb/index.js';
import { tvdbEnabled, tvdbLanguage, tvdbSearch } from '../../services/tvdb/index.js';
import { allowsAdultContent } from '../settings/adultContent.js';
import { attachSocialStats } from './socialStats.js';
import { filterSeenWithFallback, loadRecentImpressions, recordImpressions } from '../explore/impressions.js';
import { genreProfile, pickExplorationSlug, pickWeighted, tmdbGenreBySlug, tmdbGenreWeights } from '../explore/taste.js';
import { containsAdultContent, isKnownAdultTmdbId, containsAmbiguousAdultCjk } from '@serietime/core';

// Contenu pornographique exclu du flux et de la recherche : marqueur TMDb
// `adult` OU signaux porno (titre/résumé) via containsAdultContent. La violence
// (gore, meurtre…) N'EST PAS visée — seul le porno est écarté.
type AdultCheckable = {
  adult?: boolean;
  name?: string;
  title?: string;
  original_name?: string;
  original_title?: string;
  overview?: string;
};
function isAdultContent(r: AdultCheckable & { id?: number | string }): boolean {
  return (
    r.adult === true ||
    isKnownAdultTmdbId(r.id != null ? String(r.id) : null) ||
    containsAdultContent(r.name, r.title, r.original_name, r.original_title, r.overview)
  );
}

// Vérification hentai par mots-clés PAR ITEM, sur la sélection FINALE d'items
// d'ANIMATION uniquement (les hentai passent parfois le flag `adult` et
// containsAdultContent — cf. « Jimihen », taggé « erotic » sans « hentai »). On
// exclut si un mot-clé TMDb ∈ ensemble adulte. Coût borné : seulement les
// items animés retenus, en parallèle. Débrayé pour les comptes 18+.
const ADULT_ITEM_KEYWORDS = new Set([
  'hentai', 'erotic', 'pornographic animation', 'pornographic video', 'pornography',
  'porno', 'erotic movie', 'softcore', 'hardcore',
  // Pink films / softcore live-action / JAV : ces « movie » japonais passent le
  // flag `adult` ET containsAdultContent (titre anodin), mais leurs mots-clés
  // TMDb les trahissent. Étendu au-delà de l'animation pour couvrir la RECHERCHE.
  'pink film', 'erotica', 'sexploitation', 'adult video', 'av idol', 'jav', 'roman porno',
  // « ecchi » : fan-service très suggestif, classé 18+ dans de nombreux pays
  // (ex. « Takamine-san » : BR 18, KR 19, IT VM18…). Écarté par défaut, comme
  // le reste du 18+ ; l'interrupteur « Contenu 18+ » le fait réapparaître.
  'ecchi',
]);
// Passe anti-porno sur la sélection FINALE (débrayée pour les comptes 18+).
// 1) id TMDb banni (liste noire) ; 2) titre/résumé porno (marqueurs latins +
// CJK non ambigus) ; 3) mots-clés TMDb adultes (pink film/softcore/hentai/…) ;
// 4) marqueur CJK AMBIGU (変態/エロ/성인) MAIS uniquement si l'œuvre n'a AUCUN
// mot-clé TMDb — les animés grand public en ont toujours, les porno obscurs à
// titre kanji n'en ont pas → on écarte ces derniers sans toucher « 変態王子 ».
// `matches` limite la requête /keywords (coût API) : flux = animés seulement ;
// recherche = tous les items avec tmdbId. Les checks 1-2 sont gratuits (locaux).
async function dropAdultResults<T extends { tmdbId: string | null; type: 'show' | 'movie'; title: string; overview: string | null }>(
  items: T[],
  matches: (item: T) => boolean,
): Promise<T[]> {
  const ok = await Promise.all(
    items.map(async (item) => {
      if (isKnownAdultTmdbId(item.tmdbId)) return false;
      if (containsAdultContent(item.title, item.overview)) return false;
      if (!item.tmdbId || !matches(item)) return true;
      const names = await tmdbKeywordNames(item.type === 'movie' ? 'movie' : 'tv', item.tmdbId);
      if (names.some((n) => ADULT_ITEM_KEYWORDS.has(n.trim().toLowerCase()))) return false;
      if (names.length === 0 && containsAmbiguousAdultCjk(item.title)) return false;
      return true;
    }),
  );
  return items.filter((_, i) => ok[i]);
}

type SearchResult = {
  id: string | null;
  tmdbId: string | null;
  tvdbId: string | null;
  type: 'show' | 'movie';
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
  inLibrary: boolean;
  // Catégorie du flux Explorer (filtre côté app) — absent des résultats de recherche.
  category?: 'serie' | 'film' | 'anime';
  // Signaux sociaux (toute l'app) + état perso — remplis par attachSocialStats sur le flux Explorer.
  stats?: { likes: number; watched: number; comments: number };
  me?: { liked: boolean; watched: boolean };
  // Note communautaire TMDb (échantillon large, /10) affichée sur la carte du flux TikTok.
  voteAverage?: number | null;
};

// Animé = animation (genre TMDb 16) d'origine japonaise.
function feedCategory(
  r: { genre_ids?: number[]; original_language?: string; origin_country?: string[] },
  type: 'show' | 'movie',
): 'serie' | 'film' | 'anime' {
  const anime =
    (r.genre_ids ?? []).includes(16) &&
    (r.original_language === 'ja' || (r.origin_country ?? []).includes('JP'));
  return anime ? 'anime' : type === 'show' ? 'serie' : 'film';
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/search', async (request) => {
    const query = z
      .object({ q: z.string().default(''), type: z.enum(['media', 'lists', 'people']).default('media') })
      .parse(request.query ?? {});
    const q = query.q.trim();
    const lang = await getUserLang(request.userId);
    const allowAdult = await allowsAdultContent(request.userId);
    // L'app affiche un message clair si aucune source externe n'est configurée.
    const sources = { tmdb: tmdbEnabled(), tvdb: tvdbEnabled() };
    if (!q) return { results: [], sources };

    if (query.type === 'lists') {
      const lists = await prisma.mediaList.findMany({
        where: { userId: request.userId, title: { contains: q } },
        include: { items: { include: { media: true }, orderBy: { position: 'asc' }, take: 4 } },
      });
      return {
        results: lists.map((l) => ({
          id: l.id,
          title: l.title,
          posterPaths: l.items.map((i) => i.media.posterPath).filter(Boolean),
        })),
      };
    }

    if (query.type === 'people') {
      const local = await prisma.person.findMany({ where: { name: { contains: q } }, take: 10 });
      const remote = tmdbEnabled() ? await tmdbSearchPerson(q) : [];
      const seen = new Set(local.map((p) => p.tmdbId));
      const people = [
        ...local.map((p) => ({ id: p.id, name: p.name, profilePath: p.profilePath })),
        ...(remote as { id: number; name?: string; profile_path?: string | null }[])
          .filter((p) => !seen.has(String(p.id)))
          .slice(0, 10)
          .map((p) => ({ id: `tmdb:${p.id}`, name: p.name ?? '', profilePath: p.profile_path ?? null })),
      ];
      return { results: people };
    }

    // Séries et films : local + TMDb. Le filtre de type est indispensable :
    // sans lui, les JEUX importés (IGDB) ressortaient dans « Séries et films »
    // étiquetés « Film » (ex. Clair Obscur: Expedition 33 + ses éditions).
    const local = await prisma.media.findMany({
      where: {
        type: { in: ['show', 'movie'] },
        OR: [
          { title: { contains: q } },
          { originalTitle: { contains: q } },
          { localizedTitle: { contains: q } },
        ],
      },
      include: { statuses: { where: { userId: request.userId } } },
      take: 20,
    });
    // Déduplication à travers local + TMDb + TVDB : un même show pouvait sortir
    // deux fois (ex. « Naruto » importé via TVDB + résultat TMDb au tmdbId
    // différent). On compare par id externe ET par type+titre normalisé+année.
    const results: SearchResult[] = [];
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
    const seen = new Set<string>();
    const keysFor = (o: { tmdbId?: string | null; tvdbId?: string | null; type: string; title: string; year?: number | null }) => {
      const k: string[] = [];
      if (o.tmdbId) k.push(`tmdb:${o.tmdbId}`);
      if (o.tvdbId) k.push(`tvdb:${o.tvdbId}`);
      k.push(`${o.type}:${norm(o.title)}:${o.year ?? ''}`);
      return k;
    };
    const add = (entry: SearchResult): boolean => {
      const keys = keysFor(entry);
      if (keys.some((key) => seen.has(key))) return false;
      keys.forEach((key) => seen.add(key));
      results.push(entry);
      return true;
    };

    for (const m of local) {
      add({
        id: m.id,
        tmdbId: m.tmdbId,
        tvdbId: m.tvdbId,
        type: m.type as 'show' | 'movie',
        title: mediaTitle(m, lang),
        year: m.year,
        posterPath: m.posterPath,
        backdropPath: m.backdropPath,
        overview: parseTranslations(m.translationsJson)[lang]?.overview ?? m.overview,
        inLibrary: m.statuses.length > 0,
      });
    }

    if (tmdbEnabled()) {
      let remote = await tmdbSearch(q, 'multi', undefined, lang, allowAdult);
      // Saisie en cours : TMDb ne matche pas un dernier mot PARTIEL
      // (« assassin's creed ori » → 0). On retente sans lui, l'utilisateur voit
      // des résultats pendant qu'il tape au lieu d'un écran vide.
      if (remote.length === 0 && /\s/.test(q)) {
        const withoutLastWord = q.replace(/\s+\S+$/, '').trim();
        if (withoutLastWord.length >= 3) {
          remote = await tmdbSearch(withoutLastWord, 'multi', undefined, lang, allowAdult);
        }
      }
      for (const r of remote.slice(0, 20)) {
        // isAdultContent voit le titre LOCALISÉ, le titre ORIGINAL (kanji inclus,
        // désormais détecté) et le résumé. Le filtre par mots-clés ci-dessous
        // (fin de route) attrape les pink films/softcore sans marqueur textuel.
        if (!allowAdult && isAdultContent(r)) continue; // exclut le contenu pornographique
        add({
          id: null,
          tmdbId: String(r.id),
          tvdbId: null,
          type: r.media_type === 'movie' ? 'movie' : 'show',
          title: r.name ?? r.title ?? '',
          year: (r.first_air_date ?? r.release_date)
            ? new Date((r.first_air_date ?? r.release_date)!).getFullYear()
            : null,
          posterPath: r.poster_path ?? null,
          backdropPath: r.backdrop_path ?? null,
          overview: r.overview ?? null,
          inLibrary: false,
        });
      }
    }

    // Séries TheTVDB (source alternative, ex. exports TV Time).
    if (tvdbEnabled()) {
      const remote = await tvdbSearch(q);
      const lang = tvdbLanguage();
      for (const r of remote.slice(0, 20)) {
        // Titre localisé (fra) sinon anglais sinon nom d'origine — évite « ワンピース ».
        const title = r.translations?.[lang] ?? r.translations?.['eng'] ?? r.name;
        add({
          id: null,
          tmdbId: null,
          tvdbId: r.tvdb_id,
          type: 'show',
          title,
          year: r.year ? Number(r.year) : r.first_air_time ? new Date(r.first_air_time).getFullYear() : null,
          posterPath: r.image_url ?? null,
          backdropPath: null,
          overview: r.overviews?.[tvdbLanguage()] ?? r.overview ?? null,
          inLibrary: false,
        });
      }
    }
    // Vérification par mots-clés TMDb sur TOUS les résultats ayant un tmdbId
    // (pas seulement les animés) : les pink films / softcore live-action
    // passent le flag `adult` ET containsAdultContent mais sont taggés
    // « softcore »/« pink film »/« erotica »… Jeu de résultats petit (≤ ~40),
    // /keywords caché 30 j → coût borné. Débrayé pour les comptes 18+.
    const finalResults = allowAdult
      ? results
      : await dropAdultResults(results, (i) => i.tmdbId != null);
    return { results: finalResults, sources };
  });

  // Spec §20.3 : flux personnel de recommandations, affiné selon les goûts.
  app.get('/api/explore/feed', async (request) => {
    // Langue de contenu : les titres/résumés des cartes viennent de TMDb, qui
    // les renvoie directement dans la langue demandée (cache par langue).
    const lang = await getUserLang(request.userId);
    const allowAdult = await allowsAdultContent(request.userId);
    // Graines de goût : ce que l'utilisateur a AIMÉ. Les favoris comptent le plus,
    // puis « à voir »/en cours/déjà vu (les swipes du mode Découvrir alimentent ça :
    // ♥ à voir = watchlist, ↓ déjà vu = completed). Plus il y en a, plus le flux
    // devient personnel.
    // Jusqu'à 30 candidats, puis 8 tirés AU HASARD à chaque appel : les
    // recommandations changent à chaque refresh (avant : toujours les 8 mêmes).
    const seedCandidates = await prisma.userMediaStatus.findMany({
      where: {
        userId: request.userId,
        isHidden: false,
        OR: [{ isFavorite: true }, { status: { in: ['watching', 'completed', 'watchlist'] } }],
      },
      include: { media: true },
      orderBy: [{ isFavorite: 'desc' }, { lastWatchedAt: 'desc' }],
      take: 30,
    });
    const tasteSeeds = [...seedCandidates].sort(() => Math.random() - 0.5).slice(0, 8);
    const mediaKeyFields = { tmdbId: true, type: true, title: true, originalTitle: true, year: true } as const;
    const disliked = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, isHidden: true },
      select: { media: { select: mediaKeyFields } },
    });
    const inLibrary = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId },
      select: { media: { select: mediaKeyFields } },
    });
    // Mémoire du flux : les items servis il y a moins de 3 jours sont exclus du
    // tirage (avec garde anti-famine plus bas) — cf. modules/explore/impressions.ts.
    const seenRecently = await loadRecentImpressions(request.userId);
    // Profil de goût par GENRES (favoris ×3, watchlist/en cours ×2, terminés ×1,
    // dislikés ×−2) : 2 genres au hasard PONDÉRÉ (exploitation) + 1 genre hors
    // profil (exploration) → viviers discover dédiés, différents à chaque refresh.
    const tasteRows = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, media: { type: { in: ['show', 'movie'] } } },
      select: { status: true, isFavorite: true, isHidden: true, media: { select: { genres: true } } },
    });
    const genreWeights = tmdbGenreWeights(
      genreProfile(
        tasteRows.map((r) => ({ status: r.status, isFavorite: r.isFavorite, isHidden: r.isHidden, genres: r.media.genres })),
      ),
    );
    const exploitSlugs = pickWeighted(genreWeights, 2);
    const explorationSlug = pickExplorationSlug(genreWeights, exploitSlugs);
    const genrePicks = [...exploitSlugs, ...(explorationSlug ? [explorationSlug] : [])]
      .map((slug) => tmdbGenreBySlug(slug))
      .filter((g): g is NonNullable<ReturnType<typeof tmdbGenreBySlug>> => Boolean(g));
    // Les médias ajoutés via TheTVDB n'ont pas toujours de tmdbId : on compare
    // alors type + titre normalisé (+ année quand elle est connue des deux côtés),
    // sinon une série déjà suivie réapparaît dans les recommandations.
    const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    type MediaKey = { tmdbId: string | null; type: string; title: string; originalTitle: string | null; year: number | null };
    const toEntry = (m: MediaKey) => ({
      tmdbId: m.tmdbId,
      type: m.type,
      titles: [m.title, m.originalTitle].filter((t): t is string => Boolean(t)).map(norm),
      year: m.year,
    });
    const dislikedEntries = disliked.map((d) => toEntry(d.media));
    const libraryEntries = inLibrary.map((d) => toEntry(d.media));
    const isKnown = (type: string, tmdbId: string, title: string, year: number | null) =>
      [...dislikedEntries, ...libraryEntries].some(
        (e) =>
          (e.tmdbId != null && e.tmdbId === tmdbId) ||
          (e.type === type &&
            e.titles.includes(norm(title)) &&
            (e.year == null || year == null || e.year === year)),
      );

    const cards: SearchResult[] = [];
    if (tmdbEnabled()) {
      const { tmdbRecommendations } = await import('../../services/tmdb/index.js');
      for (const status of tasteSeeds) {
        if (!status.media.tmdbId) continue;
        const recs = await tmdbRecommendations(status.media.type === 'show' ? 'tv' : 'movie', status.media.tmdbId, lang, allowAdult);
        // Échantillon aléatoire (le tirage change à chaque rafraîchissement) ; les
        // favoris pèsent plus lourd (plus de suggestions issues d'eux).
        const picks = [...recs].sort(() => Math.random() - 0.5).slice(0, status.isFavorite ? 5 : 3);
        for (const r of picks) {
          if (!allowAdult && isAdultContent(r)) continue; // exclut le contenu pornographique
          const recType = status.media.type === 'show' ? 'show' : 'movie';
          const recTitle = r.name ?? r.title ?? '';
          const recYear = (r.first_air_date ?? r.release_date)
            ? new Date((r.first_air_date ?? r.release_date)!).getFullYear()
            : null;
          if (isKnown(recType, String(r.id), recTitle, recYear)) continue;
          cards.push({
            id: null,
            tmdbId: String(r.id),
            tvdbId: null,
            type: recType,
            category: feedCategory(r, recType),
            title: recTitle,
            year: recYear,
            posterPath: r.poster_path ?? null,
            backdropPath: r.backdrop_path ?? null,
            overview: r.overview ?? null,
            inLibrary: false,
            voteAverage: r.vote_average ?? null,
          });
        }
      }
      // Pages tirées au hasard : 1..3 pour les tendances (classement court),
      // 1..8 pour les viviers discover/classiques/anime — le pull-to-refresh
      // change réellement le vivier, plus seulement l'ordre.
      const page = 1 + Math.floor(Math.random() * 3);
      const discPage = () => 1 + Math.floor(Math.random() * 8);
      // DEUX décennies aléatoires distinctes : le flux mélange les époques.
      const decades = [1980, 1990, 2000, 2010, 2020].sort(() => Math.random() - 0.5).slice(0, 2);
      const { tmdbDiscover } = await import('../../services/tmdb/index.js');
      // Viviers : tendances (récent) + découverte populaire + CLASSIQUES toutes
      // époques (tri par votes) + 2 DÉCENNIES aléatoires + un vivier ANIMÉ dédié
      // + jusqu'à 3 viviers PAR GENRE issus du profil de goût (tv + movie).
      const decadePools = decades.flatMap((d) => [
        tmdbDiscover('tv', { page: discPage(), yearGte: d, yearLte: d + 9, sort: 'vote_count.desc', lang, allowAdult }),
        tmdbDiscover('movie', { page: discPage(), yearGte: d, yearLte: d + 9, sort: 'vote_count.desc', lang, allowAdult }),
      ]);
      const genrePools = genrePicks.flatMap((g) => [
        ...(g.tvId ? [tmdbDiscover('tv', { genres: [g.tvId], page: discPage(), lang, allowAdult })] : []),
        ...(g.movieId ? [tmdbDiscover('movie', { genres: [g.movieId], page: discPage(), lang, allowAdult })] : []),
      ]);
      // Viviers ANIMÉS (genre 16 / VO japonaise) : `excludeErotic` ajoute le
      // mot-clé « erotic » au without_keywords (le hentai y est souvent taggé).
      const pools = await Promise.all([
        tmdbTrending('tv', page, lang, allowAdult),
        tmdbTrending('movie', page, lang, allowAdult),
        tmdbDiscover('tv', { page: discPage(), lang, allowAdult }),
        tmdbDiscover('movie', { page: discPage(), lang, allowAdult }),
        tmdbDiscover('tv', { page: discPage(), sort: 'vote_count.desc', lang, allowAdult }),
        tmdbDiscover('movie', { page: discPage(), sort: 'vote_count.desc', lang, allowAdult }),
        tmdbDiscover('tv', { genres: [16], language: 'ja', page: discPage(), lang, allowAdult, excludeErotic: true }),
        tmdbDiscover('movie', { genres: [16], language: 'ja', page: discPage(), lang, allowAdult, excludeErotic: true }),
        tmdbDiscover('tv', { genres: [16], language: 'ja', page: discPage(), sort: 'vote_count.desc', lang, allowAdult, excludeErotic: true }),
        ...decadePools,
        ...genrePools,
      ]);
      const pool = pools.flat().sort(() => Math.random() - 0.5);
      for (const r of pool) {
        if (!allowAdult && isAdultContent(r)) continue; // exclut le contenu pornographique
        const trendType = r.title ? 'movie' : 'show';
        const trendTitle = r.name ?? r.title ?? '';
        const trendYear = (r.first_air_date ?? r.release_date)
          ? new Date((r.first_air_date ?? r.release_date)!).getFullYear()
          : null;
        if (isKnown(trendType, String(r.id), trendTitle, trendYear)) continue;
        cards.push({
          id: null,
          tmdbId: String(r.id),
          tvdbId: null,
          type: trendType,
          category: feedCategory(r, trendType),
          title: trendTitle,
          year: trendYear,
          posterPath: r.poster_path ?? null,
          backdropPath: r.backdrop_path ?? null,
          overview: r.overview ?? null,
          inLibrary: false,
          voteAverage: r.vote_average ?? null,
        });
      }
    }
    // Déduplique en conservant l'ordre — par id TMDb ET par titre normalisé
    // (la même œuvre peut exister sous plusieurs ids selon la plateforme).
    const seen = new Set<string>();
    const deduped = cards.filter((c) => {
      const keys = [`${c.type}:${c.tmdbId}`, `${c.type}:${norm(c.title)}`];
      if (keys.some((k) => seen.has(k))) return false;
      keys.forEach((k) => seen.add(k));
      return true;
    });
    // Anti-répétition : exclut les items servis il y a moins de 3 jours, avec
    // garde anti-famine (les plus anciens repassent d'abord si le vivier
    // restant est trop maigre) — jamais de flux vide à cause du filtre.
    const FEED_TARGET = 66; // 3 catégories × PER_CAT
    const itemKey = (c: SearchResult) => `${c.type}:tmdb:${c.tmdbId}`;
    const varied = filterSeenWithFallback(deduped, itemKey, seenRecently, FEED_TARGET);
    // Plafond équilibré : au plus PER_CAT items par catégorie (serie/film/anime),
    // pour que chaque filtre de l'app reste fourni sans renvoyer une liste énorme.
    const PER_CAT = 22;
    const perCat = new Map<string, number>();
    const capped = varied.filter((c) => {
      const cat = c.category ?? (c.type === 'show' ? 'serie' : 'film');
      const n = perCat.get(cat) ?? 0;
      if (n >= PER_CAT) return false;
      perCat.set(cat, n + 1);
      return true;
    });
    // Vérification hentai par mots-clés sur les items d'ANIMATION retenus
    // (catégorie « anime ») — appliquée sur la sélection FINALE, en parallèle.
    const feed = allowAdult ? capped : await dropAdultResults(capped, (c) => c.category === 'anime');
    // Mémorise ce qui vient d'être servi (exclu des tirages pendant 3 jours).
    await recordImpressions(request.userId, feed.map(itemKey));
    const withStats = await attachSocialStats(feed, request.userId);
    return { feed: withStats };
  });

  app.get('/api/explore/discover', async (request) => {
    if (!tmdbEnabled()) return { shows: [], movies: [] };
    const allowAdult = await allowsAdultContent(request.userId);
    const [tv, movies] = await Promise.all([tmdbTrending('tv', 1, undefined, allowAdult), tmdbTrending('movie', 1, undefined, allowAdult)]);
    const map = (r: Awaited<ReturnType<typeof tmdbTrending>>[number], type: 'show' | 'movie') => ({
      tmdbId: String(r.id),
      type,
      title: r.name ?? r.title ?? '',
      posterPath: r.poster_path ?? null,
      backdropPath: r.backdrop_path ?? null,
    });
    const keep = (r: Awaited<ReturnType<typeof tmdbTrending>>[number]) => allowAdult || !isAdultContent(r);
    return {
      shows: tv.filter(keep).map((r) => map(r, 'show')),
      movies: movies.filter(keep).map((r) => map(r, 'movie')),
    };
  });

  app.get('/api/recommendations', async (request) => {
    const reply = await app.inject({
      method: 'GET',
      url: '/api/explore/feed',
      headers: { authorization: request.headers.authorization ?? '' },
    });
    return reply.json();
  });

  // Médias non appréciés (settings > recommandations).
  app.get('/api/disliked', async (request) => {
    const lang = await getUserLang(request.userId);
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId: request.userId, isHidden: true },
      include: { media: true },
    });
    return { items: statuses.map((s) => serializeMedia(s.media, s, lang)) };
  });

  app.post('/api/disliked/:mediaId', async (request) => {
    const { mediaId } = request.params as { mediaId: string };
    const { hidden } = z.object({ hidden: z.boolean() }).parse(request.body);
    await prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: request.userId, mediaId } },
      create: { userId: request.userId, mediaId, status: 'not_started', isHidden: hidden },
      update: { isHidden: hidden },
    });
    return { ok: true };
  });
}
