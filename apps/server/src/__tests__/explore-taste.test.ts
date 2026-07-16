import { describe, expect, it } from 'vitest';
import {
  genreProfile,
  igdbGenreWeights,
  normGenre,
  pickExplorationSlug,
  pickWeighted,
  statusWeight,
  tmdbGenreBySlug,
  tmdbGenreWeights,
} from '../modules/explore/taste.js';
import { filterSeenWithFallback } from '../modules/explore/impressions.js';

// Fonctions PURES du flux Explorer (profil de goût + anti-répétition) : pas de
// DB ni de réseau — testées unitairement comme demandé par la spec.

describe('statusWeight — pondération du profil de goût', () => {
  it('favoris ×3, watchlist/en cours ×2, terminé ×1, disliké ×−2', () => {
    expect(statusWeight({ isHidden: false, isFavorite: true, status: 'completed' })).toBe(3);
    expect(statusWeight({ isHidden: false, isFavorite: false, status: 'watchlist' })).toBe(2);
    expect(statusWeight({ isHidden: false, isFavorite: false, status: 'watching' })).toBe(2);
    expect(statusWeight({ isHidden: false, isFavorite: false, status: 'wishlist' })).toBe(2);
    expect(statusWeight({ isHidden: false, isFavorite: false, status: 'playing' })).toBe(2);
    expect(statusWeight({ isHidden: false, isFavorite: false, status: 'completed' })).toBe(1);
    // isHidden prime sur tout (même un ex-favori disliké compte négatif).
    expect(statusWeight({ isHidden: true, isFavorite: true, status: 'completed' })).toBe(-2);
    expect(statusWeight({ isHidden: false, isFavorite: false, status: 'not_started' })).toBe(0);
  });
});

describe('genreProfile — genres pondérés (format CSV de Media.genres)', () => {
  it('cumule les poids par genre normalisé (accents/casse ignorés)', () => {
    const profile = genreProfile([
      { genres: 'Drame, Comédie', isHidden: false, isFavorite: true, status: 'completed' }, // ×3
      { genres: 'drame', isHidden: false, isFavorite: false, status: 'watchlist' }, // ×2
      { genres: 'Comédie, Horreur', isHidden: true, isFavorite: false, status: 'completed' }, // ×−2
    ]);
    expect(profile.get('drame')).toBe(5); // 3 + 2
    expect(profile.get('comedie')).toBe(1); // 3 − 2
    expect(profile.get('horreur')).toBe(-2); // disliké → négatif
  });

  it('ignore les lignes sans genres et les statuts sans poids', () => {
    const profile = genreProfile([
      { genres: null, isHidden: false, isFavorite: true, status: 'completed' },
      { genres: 'Drame', isHidden: false, isFavorite: false, status: 'not_started' },
    ]);
    expect(profile.size).toBe(0);
  });

  it('normGenre : accents et casse', () => {
    expect(normGenre(' Comédie ')).toBe('comedie');
    expect(normGenre('Mystère')).toBe('mystere');
  });
});

describe('tmdbGenreWeights — mapping nom → genres TMDb (fr + en)', () => {
  it('projette le profil sur les slugs canoniques avec les bons ids tv/movie', () => {
    const weights = tmdbGenreWeights(
      genreProfile([
        { genres: 'Science-Fiction & Fantastique', isHidden: false, isFavorite: true, status: 'watching' },
        { genres: 'Drama', isHidden: false, isFavorite: false, status: 'completed' },
        { genres: 'Horreur', isHidden: true, isFavorite: false, status: 'completed' },
      ]),
    );
    expect(weights.get('science-fiction')).toBe(3);
    expect(weights.get('drame')).toBe(1);
    expect(weights.get('horreur')).toBe(-2);
    expect(tmdbGenreBySlug('science-fiction')).toMatchObject({ tvId: 10765, movieId: 878 });
    expect(tmdbGenreBySlug('drame')).toMatchObject({ tvId: 18, movieId: 18 });
  });
});

describe('igdbGenreWeights — mapping nom IGDB → id', () => {
  it('projette les genres IGDB (CSV anglais) sur leurs ids', () => {
    const weights = igdbGenreWeights(
      genreProfile([
        { genres: 'Role-playing (RPG), Adventure', isHidden: false, isFavorite: true, status: 'playing' }, // ×3
        { genres: 'Shooter', isHidden: true, isFavorite: false, status: 'completed' }, // ×−2
      ]),
    );
    expect(weights.get('12')).toBe(3); // RPG
    expect(weights.get('31')).toBe(3); // Adventure
    expect(weights.get('5')).toBe(-2); // Shooter disliké
  });
});

describe('pickWeighted — tirage pondéré sans remise', () => {
  it('ne tire que des poids positifs, sans doublon', () => {
    const weights = new Map([
      ['a', 5],
      ['b', 1],
      ['c', -3],
      ['d', 0],
    ]);
    const picked = pickWeighted(weights, 4);
    expect(picked.length).toBe(2); // seuls a et b sont éligibles
    expect(new Set(picked)).toEqual(new Set(['a', 'b']));
  });

  it('est piloté par le générateur aléatoire (déterministe en test)', () => {
    const weights = new Map([
      ['a', 1],
      ['b', 9],
    ]);
    // rand → 0.99 : tombe dans la masse de b (poids 9/10).
    expect(pickWeighted(weights, 1, () => 0.99)).toEqual(['b']);
    // rand → 0.0 : premier de la liste (a).
    expect(pickWeighted(weights, 1, () => 0)).toEqual(['a']);
  });
});

describe('pickExplorationSlug — genre hors profil', () => {
  it('ne propose jamais un genre déjà exploité ou à score positif', () => {
    const weights = new Map([
      ['drame', 5],
      ['comedie', 3],
      ['horreur', -2],
    ]);
    for (let i = 0; i < 50; i += 1) {
      const slug = pickExplorationSlug(weights, ['drame', 'comedie']);
      expect(slug).not.toBeNull();
      expect(['drame', 'comedie']).not.toContain(slug);
      expect(weights.get(slug!) ?? 0).toBeLessThanOrEqual(0);
    }
  });
});

describe('filterSeenWithFallback — anti-répétition + anti-famine', () => {
  const keyOf = (s: string) => s;
  const days = (n: number) => new Date(Date.now() - n * 86_400_000);

  it('exclut les items vus quand le vivier frais suffit', () => {
    const seen = new Map([['b', days(1)]]);
    expect(filterSeenWithFallback(['a', 'b', 'c'], keyOf, seen, 2)).toEqual(['a', 'c']);
  });

  it('complète avec les items vus LES PLUS ANCIENS quand le frais manque', () => {
    const seen = new Map([
      ['b', days(1)],
      ['c', days(2)],
    ]);
    // 1 seul frais pour une cible de 2 → c (plus ancien que b) repasse d'abord.
    expect(filterSeenWithFallback(['a', 'b', 'c'], keyOf, seen, 2)).toEqual(['a', 'c']);
  });

  it('ne renvoie jamais vide : vivier minuscule entièrement vu → tout repasse', () => {
    const seen = new Map([
      ['a', days(1)],
      ['b', days(2)],
    ]);
    expect(filterSeenWithFallback(['a', 'b'], keyOf, seen, 10)).toEqual(['b', 'a']);
  });
});
