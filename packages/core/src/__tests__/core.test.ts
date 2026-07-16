import { describe, expect, it } from 'vitest';
import {
  bestCandidate,
  decideMatch,
  detectFileKind,
  detectMediaType,
  episodesWatchTimeMinutes,
  extractExternalIds,
  formatEpisodeCode,
  minutesToBreakdown,
  nextEpisodeToWatch,
  normalizeImportedEpisode,
  normalizeImportedMedia,
  normalizeTitle,
  parseCsv,
  parseFileContent,
  remainingAiredCount,
  scoreMatch,
  showProgress,
  upcomingGroupLabel,
  pastGroupLabel,
} from '../server.js';

describe('normalizeTitle', () => {
  it('strips accents, case and punctuation', () => {
    expect(normalizeTitle("L'Atelier des Sorciers !")).toBe('l atelier des sorciers');
    expect(normalizeTitle('Mushoku Tensei: Jobless')).toBe('mushoku tensei jobless');
  });
  it('normalizes ampersand', () => {
    expect(normalizeTitle('Law & Order')).toBe(normalizeTitle('Law and Order'));
  });
});

describe('extractExternalIds', () => {
  it('reads explicit id columns', () => {
    expect(extractExternalIds({ tvdb_id: 375903, imdb_id: 'tt1234567' })).toEqual({
      tvdbId: '375903',
      imdbId: 'tt1234567',
    });
  });
  it('extracts ids from TV Time urls', () => {
    expect(extractExternalIds({ url: 'https://tvtime.com/fr/show/375903' }).tvdbId).toBe('375903');
    expect(extractExternalIds({ url: 'https://tvtime.com/fr/movie/550' }).tmdbId).toBe('550');
  });
});

describe('detectFileKind / parseFileContent', () => {
  it('detects episode files by name', () => {
    expect(detectFileKind('seen_episode.csv', [])).toBe('episodes_watched');
    expect(detectFileKind('data/tracking-prod-records.csv', [])).toBe('episodes_watched');
  });
  it('detects by columns when name is ambiguous', () => {
    expect(detectFileKind('export.csv', [{ episode_number: '1', season_number: '2' }])).toBe(
      'episodes_watched',
    );
  });
  it('parses CSV with BOM and quotes', () => {
    const rows = parseCsv('﻿title,season_number\n"Silo, the show",3\n');
    expect(rows).toEqual([{ title: 'Silo, the show', season_number: '3' }]);
  });
  it('parses JSON array and wrapped objects', () => {
    expect(parseFileContent('shows.json', '[{"name":"Silo"}]').rows).toHaveLength(1);
    expect(parseFileContent('user.json', '{"shows":[{"name":"Silo"},{"name":"Dark"}]}').rows).toHaveLength(2);
  });
  it('never throws on malformed content', () => {
    const parsed = parseFileContent('broken.json', '{oops');
    expect(parsed.error).toBeTruthy();
    expect(parsed.rows).toEqual([]);
  });
});

describe('normalizeImportedMedia', () => {
  it('normalizes a movie row', () => {
    const media = normalizeImportedMedia(
      { movie_title: 'Mickey 17', release_date: '2025-03-05', is_watched: 'true', rating: '8' },
      'movies',
    );
    expect(media).toMatchObject({ mediaType: 'movie', title: 'Mickey 17', year: 2025, rating: 8, status: 'watched' });
  });
  it('marks favorites from file kind', () => {
    const media = normalizeImportedMedia({ series_name: 'Dark' }, 'favorites');
    expect(media?.isFavorite).toBe(true);
  });
  it('returns null without title nor ids', () => {
    expect(normalizeImportedMedia({ foo: 'bar' }, 'shows')).toBeNull();
  });
  it("active=0 (followed_tv_show.csv) => série « arrêtée »", () => {
    const stopped = normalizeImportedMedia({ tv_show_name: 'Koh-Lanta', tv_show_id: '123', active: '0' }, 'shows');
    expect(stopped?.status).toBe('stopped_watching');
    const active = normalizeImportedMedia({ tv_show_name: 'Silo', tv_show_id: '456', active: '1' }, 'shows');
    expect(active?.status).toBeUndefined();
  });
});

describe('normalizeImportedEpisode', () => {
  it('normalizes standard columns', () => {
    const ep = normalizeImportedEpisode({
      tv_show_name: 'Silo',
      episode_season_number: '3',
      episode_number: '1',
      watched_at: '2026-01-03 21:00:00',
    });
    expect(ep).toMatchObject({ showTitle: 'Silo', seasonNumber: 3, episodeNumber: 1 });
    expect(ep?.watchedAt).toContain('2026-01-03');
  });
  it('parses S01E13 style codes', () => {
    const ep = normalizeImportedEpisode({ show_name: 'Witch Hat', episode: 'S01E13' });
    expect(ep).toMatchObject({ seasonNumber: 1, episodeNumber: 13 });
  });
});

describe('detectMediaType', () => {
  it('uses explicit type then url then episode columns', () => {
    expect(detectMediaType({ type: 'movie' }, 'unknown')).toBe('movie');
    expect(detectMediaType({ url: 'https://tvtime.com/fr/show/1' }, 'unknown')).toBe('show');
    expect(detectMediaType({ season_number: 1 }, 'unknown')).toBe('show');
    expect(detectMediaType({}, 'movies')).toBe('movie');
  });
});

describe('matching score', () => {
  it('scores exact external id at 100', () => {
    expect(scoreMatch({ title: 'x', tvdbId: '42' }, { title: 'y', tvdbId: '42' })).toBe(100);
  });
  it('scores exact title + year at 90, ±1 year at 80', () => {
    expect(scoreMatch({ title: 'Dark', year: 2017 }, { title: 'Dark', year: 2017 })).toBe(90);
    expect(scoreMatch({ title: 'Dark', year: 2018 }, { title: 'Dark', year: 2017 })).toBe(80);
  });
  it('scores close title + exact year at 70', () => {
    expect(
      scoreMatch({ title: 'Mushoku Tensei Jobless Reincarnation', year: 2021 }, { title: 'Mushoku Tensei: Jobless Reincarnation!', year: 2021 }),
    ).toBeGreaterThanOrEqual(70);
  });
  it('decides import mode from score', () => {
    expect(decideMatch(95)).toBe('auto');
    expect(decideMatch(75)).toBe('auto_flagged');
    expect(decideMatch(60)).toBe('manual');
  });
  it('selects the best candidate', () => {
    const best = bestCandidate({ title: 'Dark', year: 2017 }, [
      { title: 'Dark Matter', year: 2024 },
      { title: 'Dark', year: 2017 },
    ]);
    expect(best?.candidate.title).toBe('Dark');
    expect(best?.score).toBe(90);
  });
});

describe('episodes helpers', () => {
  const eps = [
    { id: 'a', seasonNumber: 1, episodeNumber: 1, airDate: '2020-01-01', watched: true },
    { id: 'b', seasonNumber: 1, episodeNumber: 2, airDate: '2020-01-08', watched: false },
    { id: 'c', seasonNumber: 1, episodeNumber: 3, airDate: '2099-01-01', watched: false },
    { id: 's', seasonNumber: 0, episodeNumber: 1, airDate: '2019-01-01', watched: false },
  ];
  it('finds next aired unwatched episode, ignoring specials and future', () => {
    expect(nextEpisodeToWatch(eps)?.id).toBe('b');
    expect(remainingAiredCount(eps)).toBe(1);
  });
  it('computes progress on regular seasons only', () => {
    expect(showProgress(eps)).toEqual({ watched: 1, total: 3 });
  });
  it('formats episode codes', () => {
    expect(formatEpisodeCode(1, 13)).toBe('S01 | E13');
  });
});

describe('upcoming groups', () => {
  const now = new Date('2026-02-05T10:00:00'); // jeudi
  it("labels AUJOURD'HUI / DEMAIN / weekday / full date", () => {
    expect(upcomingGroupLabel(new Date('2026-02-05T22:00:00'), now)).toBe("AUJOURD'HUI");
    expect(upcomingGroupLabel(new Date('2026-02-06T06:00:00'), now)).toBe('DEMAIN');
    expect(upcomingGroupLabel(new Date('2026-02-07T15:00:00'), now)).toBe('SAMEDI');
    expect(upcomingGroupLabel(new Date('2026-02-12T15:00:00'), now)).toBe('12 FÉVR. 2026');
  });
  it('labels HIER / AVANT-HIER / weekday / full date for past releases', () => {
    expect(pastGroupLabel(new Date('2026-02-04T22:00:00'), now)).toBe('HIER');
    expect(pastGroupLabel(new Date('2026-02-03T06:00:00'), now)).toBe('AVANT-HIER');
    expect(pastGroupLabel(new Date('2026-01-31T15:00:00'), now)).toBe('SAMEDI');
    expect(pastGroupLabel(new Date('2026-01-20T15:00:00'), now)).toBe('20 JANV. 2026');
  });
});

describe('watch time stats', () => {
  it('sums runtimes with defaults and converts to breakdown', () => {
    expect(episodesWatchTimeMinutes([20, null, 60])).toBe(120);
    expect(minutesToBreakdown(60 * 24 * 30 * 15 + 60 * 24 * 10 + 60 * 21)).toEqual({
      months: 15,
      days: 10,
      hours: 21,
    });
  });
});
