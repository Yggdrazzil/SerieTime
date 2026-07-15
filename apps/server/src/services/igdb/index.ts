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
  total_rating?: number;
  total_rating_count?: number;
  release_dates?: { date?: number; human?: string; platform?: { name: string } }[];
  dlcs?: { id: number; name: string }[];
  expansions?: { id: number; name: string }[];
  videos?: { video_id: string; name?: string }[];
  screenshots?: { image_id: string }[];
  // Filtrage éditions/DLC : type de jeu (0=jeu principal, 14=update…) et
  // version parente (Deluxe/GOTY pointent le jeu de base).
  game_type?: number;
  version_parent?: number;
  // Note presse agrégée (0-100) — le plus proche d'un Metacritic via IGDB.
  aggregated_rating?: number;
};

// Champs demandés à IGDB (Apicalypse). Réutilisé par search/game/popular/upcoming.
const FIELDS =
  'fields name,summary,first_release_date,cover.image_id,artworks.image_id,genres.name,' +
  'platforms.name,involved_companies.developer,involved_companies.publisher,involved_companies.company.name,' +
  'game_modes.name,total_rating,total_rating_count,release_dates.date,release_dates.human,release_dates.platform.name,' +
  'dlcs.name,expansions.name,videos.video_id,videos.name,screenshots.image_id,game_type,version_parent,aggregated_rating';

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

export async function igdbSearch(q: string): Promise<IgdbGame[]> {
  // NB : le champ IGDB `category` a été déprécié (migré vers `game_type`) et
  // `where category = 0` ne matche plus RIEN → on ne filtre plus par type ici.
  const body = `search "${q.replace(/"/g, '')}"; ${FIELDS}; limit 30;`;
  return ((await igdbQuery<IgdbGame[]>('games', body, DAY)) ?? []).filter(isMainGame);
}

export async function igdbGame(id: number): Promise<IgdbGame | null> {
  const body = `${FIELDS}; where id = ${id};`;
  const r = await igdbQuery<IgdbGame[]>('games', body, 7 * DAY);
  return r && r.length ? r[0]! : null;
}

export async function igdbPopular(): Promise<IgdbGame[]> {
  const body = `${FIELDS}; where total_rating_count > 200; sort total_rating desc; limit 30;`;
  return ((await igdbQuery<IgdbGame[]>('games', body, DAY)) ?? []).filter(isMainGame);
}

export async function igdbUpcoming(): Promise<IgdbGame[]> {
  const now = Math.floor(Date.now() / 1000);
  const body = `${FIELDS}; where first_release_date > ${now}; sort first_release_date asc; limit 30;`;
  return ((await igdbQuery<IgdbGame[]>('games', body, DAY)) ?? []).filter(isMainGame);
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
    },
    dlcNames: (g.dlcs ?? []).map((d) => d.name),
  };
}
