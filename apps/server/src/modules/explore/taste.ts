// Profil de goût pour le flux Explorer : pondère les genres des médias de
// l'utilisateur pour tirer, à chaque refresh, des viviers TMDb/IGDB alignés
// sur ses goûts (exploitation) + un genre hors profil (exploration).
//
// Format constaté de Media.genres : CSV de NOMS de genres ("Drame, Comédie" —
// noms TMDb dans la langue serveur fr-FR, ou noms IGDB anglais pour les jeux),
// jamais des ids. TMDb Discover attend des IDS de genres → mapping statique
// nom→id ci-dessous (liste TMDb standard, stable depuis des années).

// Pondération d'un statut utilisateur : favoris ×3, watchlist/en cours ×2
// (wishlist/playing côté jeux), terminé ×1, disliké (isHidden) ×−2.
export function statusWeight(s: { isHidden: boolean; isFavorite: boolean; status: string }): number {
  if (s.isHidden) return -2;
  if (s.isFavorite) return 3;
  if (s.status === 'watchlist' || s.status === 'watching' || s.status === 'wishlist' || s.status === 'playing') return 2;
  if (s.status === 'completed') return 1;
  return 0;
}

// Normalisation d'un nom de genre : minuscules, accents retirés, espaces réduits.
export function normGenre(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export type TasteRow = { genres: string | null; isHidden: boolean; isFavorite: boolean; status: string };

// Profil de goût : score cumulé par nom de genre normalisé. Un genre peut
// finir négatif (dislikes) — il sera alors ignoré par le tirage pondéré.
export function genreProfile(rows: TasteRow[]): Map<string, number> {
  const profile = new Map<string, number>();
  for (const row of rows) {
    const w = statusWeight(row);
    if (w === 0 || !row.genres) continue;
    for (const raw of row.genres.split(',')) {
      const g = normGenre(raw);
      if (!g) continue;
      profile.set(g, (profile.get(g) ?? 0) + w);
    }
  }
  return profile;
}

// Tirage pondéré SANS remise de n clés (seuls les poids > 0 participent).
export function pickWeighted(
  weights: Map<string, number>,
  n: number,
  rand: () => number = Math.random,
): string[] {
  const pool = [...weights].filter(([, w]) => w > 0);
  const picked: string[] = [];
  while (picked.length < n && pool.length > 0) {
    const total = pool.reduce((sum, [, w]) => sum + w, 0);
    let r = rand() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i += 1) {
      r -= pool[i]![1];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(pool.splice(idx, 1)[0]![0]);
  }
  return picked;
}

// --- TMDb (séries + films) ---------------------------------------------------

// Genres TMDb standards (tv + movie). `names` = variantes normalisées (fr par
// défaut du serveur + anglais, TVDB/TMDb selon la source d'import). Les genres
// combinés TV ("Action & Adventure", "Sci-Fi & Fantasy"…) sont rattachés au
// genre canonique le plus proche.
export type TmdbGenreEntry = { slug: string; tvId?: number; movieId?: number; names: string[] };

export const TMDB_GENRES: TmdbGenreEntry[] = [
  { slug: 'action', tvId: 10759, movieId: 28, names: ['action', 'action & adventure', 'action et aventure'] },
  { slug: 'aventure', tvId: 10759, movieId: 12, names: ['aventure', 'adventure'] },
  { slug: 'animation', tvId: 16, movieId: 16, names: ['animation'] },
  { slug: 'comedie', tvId: 35, movieId: 35, names: ['comedie', 'comedy'] },
  { slug: 'crime', tvId: 80, movieId: 80, names: ['crime'] },
  { slug: 'documentaire', tvId: 99, movieId: 99, names: ['documentaire', 'documentary'] },
  { slug: 'drame', tvId: 18, movieId: 18, names: ['drame', 'drama'] },
  { slug: 'familial', tvId: 10751, movieId: 10751, names: ['familial', 'family'] },
  { slug: 'fantastique', tvId: 10765, movieId: 14, names: ['fantastique', 'fantasy'] },
  { slug: 'histoire', movieId: 36, names: ['histoire', 'history'] },
  { slug: 'horreur', movieId: 27, names: ['horreur', 'horror'] },
  { slug: 'musique', movieId: 10402, names: ['musique', 'music'] },
  { slug: 'mystere', tvId: 9648, movieId: 9648, names: ['mystere', 'mystery'] },
  { slug: 'romance', movieId: 10749, names: ['romance'] },
  {
    slug: 'science-fiction',
    tvId: 10765,
    movieId: 878,
    names: ['science-fiction', 'science fiction', 'sci-fi', 'sci-fi & fantasy', 'science-fiction & fantastique'],
  },
  { slug: 'thriller', movieId: 53, names: ['thriller'] },
  { slug: 'guerre', tvId: 10768, movieId: 10752, names: ['guerre', 'war', 'war & politics', 'guerre & politique'] },
  { slug: 'western', tvId: 37, movieId: 37, names: ['western'] },
  { slug: 'enfants', tvId: 10762, names: ['enfants', 'kids'] },
  { slug: 'realite', tvId: 10764, names: ['realite', 'reality', 'tele-realite', 'tele realite'] },
];

const TMDB_GENRE_BY_SLUG = new Map(TMDB_GENRES.map((g) => [g.slug, g]));

export function tmdbGenreBySlug(slug: string): TmdbGenreEntry | undefined {
  return TMDB_GENRE_BY_SLUG.get(slug);
}

// Projette le profil (noms de genres) sur les genres TMDb canoniques : score
// par slug — utilisable directement par pickWeighted.
export function tmdbGenreWeights(profile: Map<string, number>): Map<string, number> {
  const bySlug = new Map<string, number>();
  for (const g of TMDB_GENRES) {
    let score = 0;
    let hit = false;
    for (const name of g.names) {
      const w = profile.get(name);
      if (w !== undefined) {
        score += w;
        hit = true;
      }
    }
    if (hit) bySlug.set(g.slug, score);
  }
  return bySlug;
}

// Genre d'EXPLORATION : tiré uniformément parmi les genres hors profil (jamais
// vus ou score ≤ 0), pour que le flux ne s'enferme pas dans une bulle.
export function pickExplorationSlug(
  weights: Map<string, number>,
  exclude: string[],
  rand: () => number = Math.random,
): string | null {
  const candidates = TMDB_GENRES.filter(
    (g) => !exclude.includes(g.slug) && (weights.get(g.slug) ?? 0) <= 0,
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rand() * candidates.length)]!.slug;
}

// --- IGDB (jeux) --------------------------------------------------------------

// Genres IGDB (nom normalisé → id). Media.genres des jeux = CSV des noms IGDB
// anglais ("Role-playing (RPG), Adventure"), cf. igdbToMedia.
export const IGDB_GENRE_IDS: Record<string, number> = {
  'point-and-click': 2,
  fighting: 4,
  shooter: 5,
  music: 7,
  platform: 8,
  puzzle: 9,
  racing: 10,
  'real time strategy (rts)': 11,
  'role-playing (rpg)': 12,
  simulator: 13,
  sport: 14,
  strategy: 15,
  'turn-based strategy (tbs)': 16,
  tactical: 24,
  "hack and slash/beat 'em up": 25,
  'quiz/trivia': 26,
  pinball: 30,
  adventure: 31,
  indie: 32,
  arcade: 33,
  'visual novel': 34,
  'card & board game': 35,
  moba: 36,
};

// Projette le profil (noms IGDB) sur les ids de genres IGDB : score par id
// (clé = id en chaîne, pour pickWeighted).
export function igdbGenreWeights(profile: Map<string, number>): Map<string, number> {
  const byId = new Map<string, number>();
  for (const [name, w] of profile) {
    const id = IGDB_GENRE_IDS[name];
    if (id === undefined) continue;
    const key = String(id);
    byId.set(key, (byId.get(key) ?? 0) + w);
  }
  return byId;
}
