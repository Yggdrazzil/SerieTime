import { containsAdultContent } from '@serietime/core';
import { igdbQuery, igdbEnabled } from './client.js';
export { igdbEnabled };

const DAY = 86_400_000;

export type IgdbGame = {
  id: number;
  name: string;
  summary?: string;
  first_release_date?: number;
  cover?: { image_id: string };
  artworks?: { image_id: string }[];
  genres?: { name: string }[];
  platforms?: { name: string }[];
  involved_companies?: { developer: boolean; publisher: boolean; company: { name: string } }[];
  game_modes?: { name: string }[];
  rating?: number; // note des JOUEURS IGDB (0-100)
  total_rating?: number;
  total_rating_count?: number;
  release_dates?: { date?: number; human?: string; platform?: { name: string } }[];
  dlcs?: { id: number; name: string }[];
  expansions?: { id: number; name: string }[];
  videos?: { video_id: string; name?: string }[];
  screenshots?: { image_id: string }[];
  // Filtrage éditions/DLC : type de jeu (0=jeu principal, 14=update…) et
  // version parente (Deluxe/GOTY pointent le jeu de base) ; parent_game =
  // jeu de base d'un DLC/extension.
  game_type?: number;
  version_parent?: number;
  parent_game?: number;
  // Note presse agrégée (0-100) — le plus proche d'un Metacritic via IGDB.
  aggregated_rating?: number;
  // Thèmes IGDB : sert à exclure le thème « Erotic » (id 42) — contenu sexuel.
  themes?: { id: number; name?: string }[];
  // Nombre de « follows » avant sortie : proxy IGDB des jeux les plus attendus.
  hypes?: number;
};

// Thème IGDB « Erotic » = id 42. Clause Apicalypse ajoutée à chaque `where` de
// découverte/recherche : on garde les jeux SANS thème (`themes = null`).
const SAFE_THEMES = '(themes != (42) | themes = null)';

// Garde applicative (ceinture + bretelles au filtre Apicalypse) : exclut un jeu
// dont un thème est « Erotic » (id 42 ou nom contenant « erotic »/« sexual »).
// Appliquée APRÈS isMainGame dans les listes de découverte/recherche.
export function isSafeGame(g: IgdbGame): boolean {
  // Post-filtre porno : les visual novels / eroge explicites qui n'ont pas le
  // thème 42 mais un nom/résumé sans ambiguïté sont écartés (name + summary
  // font partie des FIELDS). La violence n'est PAS visée.
  if (containsAdultContent(g.name, g.summary)) return false;
  if (!g.themes || g.themes.length === 0) return true;
  return !g.themes.some((t) => t.id === 42 || (t.name != null && /erotic|sexual/i.test(t.name)));
}

// Champs demandés à IGDB (Apicalypse). Réutilisé par search/game/popular/upcoming.
const FIELDS =
  'fields name,summary,first_release_date,cover.image_id,artworks.image_id,genres.name,' +
  'platforms.name,involved_companies.developer,involved_companies.publisher,involved_companies.company.name,' +
  'game_modes.name,total_rating,total_rating_count,release_dates.date,release_dates.human,release_dates.platform.name,' +
  'dlcs.name,expansions.name,videos.video_id,videos.name,screenshots.image_id,game_type,version_parent,parent_game,rating,aggregated_rating,themes.id,themes.name,hypes';

// « Vrai jeu » pour la recherche/découverte : exclut les rééditions (Deluxe,
// GOTY… = version_parent), les DLC/extensions/bundles/updates (game_type 1, 2,
// 3, 5, 6, 7, 13, 14) — vérifié en live sur « Clair Obscur » (base=0,
// Deluxe=version_parent, Thank You Update=14). Remakes/remasters/ports gardés.
export function isMainGame(g: IgdbGame): boolean {
  if (g.version_parent) return false;
  const t = g.game_type;
  if (t === undefined) return true;
  return t === 0 || t === 4 || t === 8 || t === 9 || t === 10 || t === 11;
}

export function igdbImageUrl(imageId: string, size = 't_cover_big'): string {
  return `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
}

// Corps Apicalypse exposés pour les tests (le cache ApiCache est adressé par
// ce corps exact — les tests le pré-remplissent pour tourner sans réseau).
export function searchQueryBody(q: string, allowAdult = false): string {
  // NB : le champ IGDB `category` a été déprécié (migré vers `game_type`) et
  // `where category = 0` ne matche plus RIEN → on ne filtre plus par type ici.
  // allowAdult (utilisateur 18+) : on retire la clause thème 42 (SAFE_THEMES).
  // La clause fait partie du corps Apicalypse = clé de cache → isolation entre
  // comptes 18+ et comptes standards.
  const where = allowAdult ? '' : ` where ${SAFE_THEMES};`;
  return `search "${q.replace(/"/g, '')}"; ${FIELDS};${where} limit 50;`;
}

// Repli PRÉFIXE : le `search` plein-texte IGDB ne matche pas les mots partiels
// (« assassin's creed ori » → 0 résultat tant que « origins » n'est pas fini).
// `where name ~ *"…"*` (joker, insensible à la casse) attrape la saisie en cours.
export function prefixQueryBody(q: string, allowAdult = false): string {
  const safe = q.replace(/["\\]/g, '');
  const themes = allowAdult ? '' : ` & ${SAFE_THEMES}`;
  // limit élevé + tri par popularité (nb de notes) : TOUS les jeux dont le nom
  // contient le terme remontent (ex. « Mario »), les plus connus en tête.
  return `${FIELDS}; where name ~ *"${safe}"*${themes}; sort total_rating_count desc; limit 120;`;
}

export async function igdbSearch(q: string, allowAdult = false): Promise<IgdbGame[]> {
  const games = ((await igdbQuery<IgdbGame[]>('games', searchQueryBody(q, allowAdult), DAY)) ?? []).filter(isMainGame);
  // On fusionne TOUJOURS la requête « nom contient » (joker) : le `search`
  // plein-texte d'IGDB est limité et manque des titres (saisie partielle, longue
  // liste « Mario »…). Le joker garantit l'exhaustivité par nom ; dédup par id.
  const viaPrefix = ((await igdbQuery<IgdbGame[]>('games', prefixQueryBody(q, allowAdult), DAY)) ?? []).filter(isMainGame);
  const seen = new Set(games.map((g) => g.id));
  for (const g of viaPrefix) if (!seen.has(g.id)) games.push(g);
  return allowAdult ? games : games.filter(isSafeGame);
}

export async function igdbGame(id: number): Promise<IgdbGame | null> {
  const body = gameQueryBody(id);
  const r = await igdbQuery<IgdbGame[]>('games', body, 7 * DAY);
  return r && r.length ? r[0]! : null;
}

// `offset N;` Apicalypse : fenêtre glissante dans le classement — le flux
// Explorer tire un offset aléatoire pour varier le vivier à chaque appel.
// NB cache : la clé ApiCache est le corps Apicalypse EXACT (endpoint + body,
// cf. igdbQuery) — un offset/genre différent = une entrée de cache différente,
// le hasard n'est donc jamais figé par le cache.
const offsetClause = (offset?: number) => (offset ? ` offset ${offset};` : '');

// allowAdult (18+) : retire ` & SAFE_THEMES` du `where` et le post-filtre
// isSafeGame. La clause étant dans le corps Apicalypse (= clé de cache), les
// comptes 18+ et standards n'utilisent jamais la même entrée de cache.
const themesClause = (allowAdult: boolean) => (allowAdult ? '' : ` & ${SAFE_THEMES}`);
const applySafe = (games: IgdbGame[], allowAdult: boolean) =>
  allowAdult ? games : games.filter(isSafeGame);

// « Populaires » du MOMENT : gros succès sortis dans les 18 derniers mois
// (la fenêtre glissante suit d'elle-même la saisonnalité des sorties),
// classés par nombre de notes (proxy de popularité, pas la note elle-même
// qui figeait le carrousel sur le top all-time : Zelda/Metroid éternels).
// Le timestamp est arrondi au JOUR pour que la clé de cache reste stable 24 h ;
// `offset` (flux Explorer) et `allowAdult` (18+) restent supportés.
export function popularQueryBody(opts: { offset?: number; allowAdult?: boolean } = {}): string {
  const today = Math.floor(Date.now() / 86_400_000) * 86_400; // minuit UTC, en secondes
  const window = today - 548 * 86_400; // ~18 mois
  return `${FIELDS}; where first_release_date > ${window} & first_release_date < ${today} & total_rating_count > 5${themesClause(opts.allowAdult ?? false)}; sort total_rating_count desc; limit 60;${offsetClause(opts.offset)}`;
}

export async function igdbPopular(opts: { offset?: number; allowAdult?: boolean } = {}): Promise<IgdbGame[]> {
  return applySafe(((await igdbQuery<IgdbGame[]>('games', popularQueryBody(opts), DAY)) ?? []).filter(isMainGame), opts.allowAdult ?? false);
}

// Sorties récentes bien notées (2 dernières années) : élargit le vivier du
// flux Explorer au-delà du top all-time, pour que chaque tirage varie.
// Sorties récentes bien notées (2 dernières années) : timestamp arrondi au jour
// (cache stable 24 h), `offset`/`allowAdult` supportés pour le flux Explorer.
export async function igdbRecent(opts: { offset?: number; allowAdult?: boolean } = {}): Promise<IgdbGame[]> {
  const today = Math.floor(Date.now() / 86_400_000) * 86_400;
  const twoYearsAgo = today - 2 * 365 * 86_400;
  const body = `${FIELDS}; where first_release_date > ${twoYearsAgo} & first_release_date < ${today} & total_rating_count > 20${themesClause(opts.allowAdult ?? false)}; sort total_rating desc; limit 50;${offsetClause(opts.offset)}`;
  return applySafe(((await igdbQuery<IgdbGame[]>('games', body, DAY)) ?? []).filter(isMainGame), opts.allowAdult ?? false);
}

// Vivier par genres IGDB (profil de goût du flux Explorer jeux). Corps exposé
// pour les tests (pré-remplissage du cache ApiCache adressé par ce corps).
export function genresQueryBody(genreIds: number[], opts: { offset?: number; allowAdult?: boolean } = {}): string {
  return `${FIELDS}; where genres = (${genreIds.join(',')}) & total_rating_count > 50${themesClause(opts.allowAdult ?? false)}; sort total_rating desc; limit 50;${offsetClause(opts.offset)}`;
}

export async function igdbByGenres(genreIds: number[], opts: { offset?: number; allowAdult?: boolean } = {}): Promise<IgdbGame[]> {
  if (genreIds.length === 0) return [];
  return applySafe(
    ((await igdbQuery<IgdbGame[]>('games', genresQueryBody(genreIds, opts), DAY)) ?? []).filter(isMainGame),
    opts.allowAdult ?? false,
  );
}

// « À venir » : les jeux LES PLUS ATTENDUS (hypes = follows IGDB avant sortie),
// pas les prochaines dates du fond du store — trier par date seule remontait du
// shovelware obscur (« Slime Slider »…). `allowAdult` (18+) supporté.
export function upcomingQueryBody(allowAdult = false): string {
  const today = Math.floor(Date.now() / 86_400_000) * 86_400;
  return `${FIELDS}; where first_release_date > ${today} & hypes > 4${themesClause(allowAdult)}; sort hypes desc; limit 60;`;
}

export async function igdbUpcoming(allowAdult = false): Promise<IgdbGame[]> {
  return applySafe(((await igdbQuery<IgdbGame[]>('games', upcomingQueryBody(allowAdult), DAY)) ?? []).filter(isMainGame), allowAdult);
}

export function igdbToMedia(g: IgdbGame) {
  const norm = (arr?: { name: string }[]) => (arr && arr.length ? arr.map((x) => x.name).join(', ') : null);
  const dev = g.involved_companies?.find((c) => c.developer)?.company.name ?? null;
  const pub = g.involved_companies?.find((c) => c.publisher)?.company.name ?? null;
  const release = g.first_release_date ? new Date(g.first_release_date * 1000) : null;
  return {
    media: {
      type: 'game' as const,
      igdbId: String(g.id),
      title: g.name,
      overview: g.summary ?? null,
      posterPath: g.cover ? igdbImageUrl(g.cover.image_id) : null,
      backdropPath: g.artworks?.length ? igdbImageUrl(g.artworks[0]!.image_id, 't_1080p') : null,
      releaseDate: release,
      year: release ? release.getFullYear() : null,
      genres: norm(g.genres),
      voteAverage: typeof g.total_rating === 'number' ? g.total_rating / 10 : null,
      voteCount: typeof g.total_rating_count === 'number' ? g.total_rating_count : null,
    },
    game: {
      platforms: norm(g.platforms),
      developer: dev,
      publisher: pub,
      gameModes: norm(g.game_modes),
      // Édition (Deluxe…) ou extension/DLC : exclu de la recherche « jeux »
      // (seul le jeu de base y apparaît), mais fiche ouvrable normalement.
      isDlc: !isMainGame(g),
    },
    dlcNames: (g.dlcs ?? []).map((d) => d.name),
  };
}

// Éditions (Deluxe, GOTY… = version_parent) et extensions/DLC (parent_game)
// d'un jeu de base — la section « Éditions et extensions » de la fiche.
const RELATED_FIELDS =
  'fields name,first_release_date,cover.image_id,game_type,version_parent,parent_game';

export function igdbRelatedBody(igdbId: number): string {
  return `${RELATED_FIELDS}; where parent_game = ${igdbId} | version_parent = ${igdbId}; sort first_release_date asc; limit 25;`;
}

export type IgdbRelated = {
  id: number;
  name: string;
  first_release_date?: number;
  cover?: { image_id: string };
  game_type?: number;
  version_parent?: number;
  parent_game?: number;
};

export async function igdbRelated(igdbId: number): Promise<IgdbRelated[]> {
  return (await igdbQuery<IgdbRelated[]>('games', igdbRelatedBody(igdbId), 7 * DAY)) ?? [];
}

export function gameQueryBody(id: number): string {
  return `${FIELDS}; where id = ${id};`;
}
