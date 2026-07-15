import { describe, expect, it } from 'vitest';
import { igdbToMedia, igdbImageUrl } from '../services/igdb/index.js';

describe('igdbToMedia', () => {
  it('mappe un jeu IGDB vers Media + Game', () => {
    const g = {
      id: 1942,
      name: 'The Witcher 3',
      summary: 'RPG',
      first_release_date: 1431993600, // 2015-05-19
      cover: { image_id: 'co1wyy' },
      genres: [{ name: 'RPG' }, { name: 'Adventure' }],
      platforms: [{ name: 'PC' }, { name: 'PS4' }],
      involved_companies: [
        { developer: true, publisher: false, company: { name: 'CD Projekt RED' } },
        { developer: false, publisher: true, company: { name: 'CD Projekt' } },
      ],
      game_modes: [{ name: 'Single player' }],
      total_rating: 93.2,
      total_rating_count: 4000,
      dlcs: [{ id: 55, name: 'Hearts of Stone' }],
    };
    const out = igdbToMedia(g);
    expect(out.media.igdbId).toBe('1942');
    expect(out.media.title).toBe('The Witcher 3');
    expect(out.media.year).toBe(2015);
    expect(out.media.posterPath).toBe(igdbImageUrl('co1wyy'));
    expect(out.media.genres).toBe('RPG, Adventure');
    expect(out.media.voteAverage).toBeCloseTo(9.32, 2);
    expect(out.game.platforms).toBe('PC, PS4');
    expect(out.game.developer).toBe('CD Projekt RED');
    expect(out.game.publisher).toBe('CD Projekt');
    expect(out.game.gameModes).toBe('Single player');
    expect(out.dlcNames).toEqual(['Hearts of Stone']);
  });

  it('gère les champs manquants sans planter', () => {
    const out = igdbToMedia({ id: 7, name: 'Minimal' });
    expect(out.media.igdbId).toBe('7');
    expect(out.media.posterPath).toBeNull();
    expect(out.game.platforms).toBeNull();
    expect(out.dlcNames).toEqual([]);
  });
});
