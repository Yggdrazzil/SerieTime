import { describe, expect, it } from 'vitest';
import { steamGameToMedia } from '../services/steam/steam.js';

describe('steamGameToMedia', () => {
  it('mappe un jeu Steam possédé vers Media+Game (statut selon temps de jeu)', () => {
    const played = steamGameToMedia({ appid: 570, name: 'Dota 2', playtime_forever: 120, img_icon_url: 'abc' });
    expect(played.media.title).toBe('Dota 2');
    expect(played.media.type).toBe('game');
    expect(played.game.steamAppId).toBe('570');
    expect(played.status).toBe('playing');
    expect(played.playtimeMinutes).toBe(120);
    const unplayed = steamGameToMedia({ appid: 999, name: 'Never Played', playtime_forever: 0, img_icon_url: '' });
    expect(unplayed.status).toBe('wishlist');
  });
});
