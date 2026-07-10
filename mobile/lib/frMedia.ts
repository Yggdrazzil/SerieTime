// Traductions françaises des métadonnées TVDB/TMDb (genres, statuts, jours)
// pour la fiche façon TV Time (« Terminée », « Fantastique, Comédie… »).

const GENRE_FR: Record<string, string> = {
  'Action': 'Action', 'Action & Adventure': 'Action & Aventure', 'Adventure': 'Aventure',
  'Animation': 'Animation', 'Anime': 'Anime', 'Children': 'Enfants', 'Comedy': 'Comédie',
  'Crime': 'Crime', 'Documentary': 'Documentaire', 'Drama': 'Drame', 'Family': 'Famille',
  'Fantasy': 'Fantastique', 'Food': 'Cuisine', 'Game Show': 'Jeu télévisé', 'History': 'Histoire',
  'Home and Garden': 'Maison & Jardin', 'Horror': 'Horreur', 'Indie': 'Indépendant',
  'Kids': 'Enfants', 'Martial Arts': 'Arts martiaux', 'Mini-Series': 'Mini-série',
  'Music': 'Musique', 'Musical': 'Comédie musicale', 'Mystery': 'Mystère', 'News': 'Actualités',
  'Reality': 'Téléréalité', 'Romance': 'Romance', 'Science Fiction': 'Science-fiction',
  'Science-Fiction': 'Science-fiction', 'Sci-Fi & Fantasy': 'Science-fiction & Fantastique',
  'Soap': 'Soap', 'Sport': 'Sport', 'Suspense': 'Suspense', 'Talk Show': 'Talk-show',
  'Thriller': 'Thriller', 'Travel': 'Voyage', 'TV Movie': 'Téléfilm', 'War': 'Guerre',
  'War & Politics': 'Guerre & Politique', 'Western': 'Western',
};

export function genresFr(genres?: string | null): string | null {
  if (!genres) return null;
  const list = genres.split(',').map((g) => g.trim()).filter(Boolean);
  if (list.length === 0) return null;
  return list.map((g) => GENRE_FR[g] ?? g).join(', ');
}

export function statusFr(status?: string | null): string | null {
  if (!status) return null;
  if (/ended/i.test(status)) return 'Terminée';
  if (/cancell?ed/i.test(status)) return 'Annulée';
  if (/continuing|returning/i.test(status)) return 'En cours';
  if (/upcoming|in production|planned|pilot/i.test(status)) return 'À venir';
  if (/released/i.test(status)) return 'Sorti';
  return status;
}

const DAY_FR: Record<string, string> = {
  monday: 'lun.', tuesday: 'mar.', wednesday: 'mer.', thursday: 'jeu.',
  friday: 'ven.', saturday: 'sam.', sunday: 'dim.',
};

export function airDayFr(day?: string | null): string | null {
  if (!day) return null;
  return DAY_FR[day.trim().toLowerCase()] ?? day;
}

// « 1,09 M » façon TV Time (compteur « ajoutée par N personnes »).
export function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace('.', ',')} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.', ',')} k`;
  return String(n);
}
