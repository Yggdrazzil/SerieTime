import { describe, expect, it } from 'vitest';
import {
  BADGES,
  PIONEER_DEADLINE,
  XP_RULES,
  badgeProgress,
  computeStreaks,
  evaluateBadges,
  evaluateChallenge,
  levelForXp,
  levelTitle,
  monthlyChallenges,
  nextLevelXp,
  totalXp,
  type GamificationStats,
} from '../index.js';

// Stats "vides" pour ne remplir que les champs pertinents à chaque test.
function stats(overrides: Partial<GamificationStats> = {}): GamificationStats {
  return {
    episodesWatched: 0,
    dayOneEpisodes: 0,
    moviesWatched: 0,
    gamesCompleted: 0,
    showsCompleted: 0,
    maxEpisodes24h: 0,
    distinctGenres: 0,
    followers: 0,
    comments: 0,
    reactionsReceived: 0,
    bestStreak: 0,
    accountCreatedAt: null,
    challengesDone: 0,
    ...overrides,
  };
}

describe('XP_RULES / totalXp', () => {
  it('exposes the exact XP barème', () => {
    expect(XP_RULES).toEqual({
      episode: 10,
      episodeDayOne: 20,
      movie: 30,
      gameCompleted: 100,
      showCompleted: 200,
      comment: 5,
      challenge: 100,
    });
  });

  it('counts a standard episode at 10 XP', () => {
    expect(totalXp(stats({ episodesWatched: 1 }))).toBe(10);
  });

  it('counts a day-one episode at 20 XP total (not 10 + 20)', () => {
    // dayOneEpisodes est un sous-ensemble de episodesWatched.
    expect(totalXp(stats({ episodesWatched: 1, dayOneEpisodes: 1 }))).toBe(20);
  });

  it('mixes standard and day-one episodes', () => {
    expect(totalXp(stats({ episodesWatched: 5, dayOneEpisodes: 2 }))).toBe(3 * 10 + 2 * 20);
  });

  it('counts a watched movie at 30 XP', () => {
    expect(totalXp(stats({ moviesWatched: 1 }))).toBe(30);
  });

  it('counts a completed game at 100 XP', () => {
    expect(totalXp(stats({ gamesCompleted: 1 }))).toBe(100);
  });

  it('counts a fully completed show at 200 XP', () => {
    expect(totalXp(stats({ showsCompleted: 1 }))).toBe(200);
  });

  it('counts a posted comment at 5 XP', () => {
    expect(totalXp(stats({ comments: 1 }))).toBe(5);
  });

  it('counts a completed challenge at 100 XP', () => {
    expect(totalXp(stats({ challengesDone: 1 }))).toBe(100);
  });

  it('sums every rule together', () => {
    const s = stats({
      episodesWatched: 10,
      dayOneEpisodes: 2,
      moviesWatched: 3,
      gamesCompleted: 1,
      showsCompleted: 1,
      comments: 4,
      challengesDone: 2,
    });
    const expected = 8 * 10 + 2 * 20 + 3 * 30 + 1 * 100 + 1 * 200 + 4 * 5 + 2 * 100;
    expect(totalXp(s)).toBe(expected);
  });
});

describe('levelForXp', () => {
  it('is level 1 at 0 XP', () => {
    expect(levelForXp(0)).toBe(1);
  });
  it('is level 10 at 5 000 XP', () => {
    expect(levelForXp(5_000)).toBe(10);
  });
  it('is level 30 at 45 000 XP', () => {
    expect(levelForXp(45_000)).toBe(30);
  });
  it('is level 60 at 180 000 XP', () => {
    expect(levelForXp(180_000)).toBe(60);
  });
  it('never drops below level 1', () => {
    expect(levelForXp(1)).toBe(1);
  });
});

describe('nextLevelXp', () => {
  it('computes 50*(level+1)^2', () => {
    expect(nextLevelXp(1)).toBe(50 * 4);
    expect(nextLevelXp(9)).toBe(50 * 100); // palier vers le niveau 10
  });
});

describe('levelTitle', () => {
  it('returns the title of the highest reached tier', () => {
    expect(levelTitle(1)).toBe('Novice');
    expect(levelTitle(4)).toBe('Novice');
    expect(levelTitle(5)).toBe('Curieux du dimanche');
    expect(levelTitle(9)).toBe('Curieux du dimanche');
    expect(levelTitle(10)).toBe('Sérievore');
    expect(levelTitle(15)).toBe('Accro au générique');
    expect(levelTitle(20)).toBe('Binge-watcheur');
    expect(levelTitle(25)).toBe("Boulimique d'épisodes");
    expect(levelTitle(30)).toBe('Marathonien');
    expect(levelTitle(40)).toBe('Critique confirmé');
    expect(levelTitle(50)).toBe('Encyclopédie vivante');
    expect(levelTitle(60)).toBe('Légende du canapé');
    expect(levelTitle(75)).toBe('Maître du temps');
    expect(levelTitle(90)).toBe('Immortel du petit écran');
    expect(levelTitle(150)).toBe('Immortel du petit écran');
  });
});

describe('evaluateBadges', () => {
  it('unlocks every tier reached at once (import rétroactif)', () => {
    const unlocked = evaluateBadges(stats({ episodesWatched: 150 }));
    const episodeTiers = unlocked.filter((b) => b.badgeId === 'episodes').map((b) => b.tier);
    expect(episodeTiers).toEqual([1, 2]); // 10 et 100 franchis, pas 1000
  });

  it('unlocks nothing below the first threshold', () => {
    const unlocked = evaluateBadges(stats({ episodesWatched: 9 }));
    expect(unlocked.some((b) => b.badgeId === 'episodes')).toBe(false);
  });

  it('unlocks platinum when far above every threshold', () => {
    const unlocked = evaluateBadges(stats({ episodesWatched: 15_000 }));
    const episodeTiers = unlocked.filter((b) => b.badgeId === 'episodes').map((b) => b.tier);
    expect(episodeTiers).toEqual([1, 2, 3, 4]);
  });

  it('pioneer badge unlocks from accountCreatedAt before the deadline', () => {
    const before = evaluateBadges(stats({ accountCreatedAt: '2026-06-01T00:00:00Z' }));
    expect(before.some((b) => b.badgeId === 'pioneer' && b.tier === 1)).toBe(true);

    const after = evaluateBadges(stats({ accountCreatedAt: '2027-01-15T00:00:00Z' }));
    expect(after.some((b) => b.badgeId === 'pioneer')).toBe(false);

    const missing = evaluateBadges(stats({ accountCreatedAt: null }));
    expect(missing.some((b) => b.badgeId === 'pioneer')).toBe(false);
  });

  it('exposes the exact PIONEER_DEADLINE constant', () => {
    expect(PIONEER_DEADLINE).toBe('2026-12-31T23:59:59Z');
  });

  it('covers all catalogued badges', () => {
    expect(BADGES.map((b) => b.id).sort()).toEqual(
      [
        'beloved',
        'commentator',
        'day_one',
        'episodes',
        'explorer',
        'finisher',
        'games',
        'marathon',
        'movies',
        'pioneer',
        'popular',
        'streak',
      ].sort(),
    );
  });
});

describe('badgeProgress', () => {
  it('reports value and next threshold mid-progress', () => {
    const progress = badgeProgress(stats({ moviesWatched: 12 }));
    const movies = progress.find((p) => p.badgeId === 'movies');
    expect(movies).toEqual({ badgeId: 'movies', value: 12, nextThreshold: 50 });
  });

  it('returns null nextThreshold at the max tier', () => {
    const progress = badgeProgress(stats({ moviesWatched: 500 }));
    const movies = progress.find((p) => p.badgeId === 'movies');
    expect(movies).toEqual({ badgeId: 'movies', value: 500, nextThreshold: null });
  });

  it('also returns null once past the max tier', () => {
    const progress = badgeProgress(stats({ moviesWatched: 900 }));
    const movies = progress.find((p) => p.badgeId === 'movies');
    expect(movies?.nextThreshold).toBeNull();
  });
});

describe('computeStreaks', () => {
  it('counts consecutive days as a streak', () => {
    const days = ['2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'];
    expect(computeStreaks(days, '2026-07-16')).toEqual({ current: 5, best: 5 });
  });

  it('stays current when the streak ended yesterday', () => {
    const days = ['2026-07-14', '2026-07-15'];
    expect(computeStreaks(days, '2026-07-16')).toEqual({ current: 2, best: 2 });
  });

  it('resets current to 0 when the streak is broken (gap > 1 day)', () => {
    const days = ['2026-07-10', '2026-07-11', '2026-07-14'];
    expect(computeStreaks(days, '2026-07-16')).toEqual({ current: 0, best: 2 });
  });

  it('keeps the historical best across a gap', () => {
    const days = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-10', '2026-07-11'];
    expect(computeStreaks(days, '2026-07-11')).toEqual({ current: 2, best: 4 });
  });

  it('returns zeros for an empty history', () => {
    expect(computeStreaks([], '2026-07-16')).toEqual({ current: 0, best: 0 });
  });

  it('handles a single active day today', () => {
    expect(computeStreaks(['2026-07-16'], '2026-07-16')).toEqual({ current: 1, best: 1 });
  });
});

describe('monthlyChallenges / evaluateChallenge', () => {
  it('builds ids as YYYY-MM-slug with the right targets', () => {
    const defs = monthlyChallenges('2026-07');
    expect(defs).toEqual([
      { id: '2026-07-marathon', slug: 'marathon', label: 'Regarde 30 épisodes ce mois-ci', target: 30 },
      { id: '2026-07-finisher', slug: 'finisher', label: 'Termine une série ce mois-ci', target: 1 },
      { id: '2026-07-discover', slug: 'discover', label: 'Ajoute 3 nouveautés à ta bibliothèque', target: 3 },
    ]);
  });

  it('evaluates progress and completion for each challenge', () => {
    const defs = monthlyChallenges('2026-07');
    const findDef = (slug: string) => {
      const def = defs.find((d) => d.slug === slug);
      if (!def) throw new Error(`missing challenge def for slug ${slug}`);
      return def;
    };
    const monthStats = { episodesThisMonth: 12, showsCompletedThisMonth: 1, mediaAddedThisMonth: 5 };

    expect(evaluateChallenge(findDef('marathon'), monthStats)).toEqual({ progress: 12, completed: false });
    expect(evaluateChallenge(findDef('finisher'), monthStats)).toEqual({ progress: 1, completed: true });
    expect(evaluateChallenge(findDef('discover'), monthStats)).toEqual({ progress: 3, completed: true });
  });

  it('caps progress at the target once exceeded', () => {
    const marathon = monthlyChallenges('2026-07').find((d) => d.slug === 'marathon');
    if (!marathon) throw new Error('missing marathon challenge def');
    expect(evaluateChallenge(marathon, { episodesThisMonth: 45, showsCompletedThisMonth: 0, mediaAddedThisMonth: 0 })).toEqual({
      progress: 30,
      completed: true,
    });
  });
});
