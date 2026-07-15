import { env } from '../../config/env.js';

export function steamEnabled(): boolean {
  return Boolean(env.STEAM_API_KEY);
}

export type SteamOwnedGame = { appid: number; name: string; playtime_forever: number; img_icon_url: string };

// Header Steam d'un jeu (jaquette). Fiable sans clé.
export function steamHeader(appid: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;
}

export function steamGameToMedia(g: SteamOwnedGame) {
  return {
    media: { type: 'game' as const, title: g.name, posterPath: steamHeader(g.appid) },
    game: { steamAppId: String(g.appid) },
    status: g.playtime_forever > 0 ? ('playing' as const) : ('wishlist' as const),
    playtimeMinutes: g.playtime_forever,
  };
}

// Accepte un SteamID64 ou une URL/pseudo vanity (steamcommunity.com/id/xxx). Renvoie le SteamID64.
export async function steamResolveVanity(input: string): Promise<string | null> {
  if (!steamEnabled()) return null;
  const raw = input.trim().replace(/\/+$/, '');
  const idMatch = raw.match(/(\d{17})$/);
  if (idMatch) return idMatch[1]!;
  const vanity = raw.split('/').pop() ?? raw;
  try {
    const res = await fetch(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${env.STEAM_API_KEY}&vanityurl=${encodeURIComponent(vanity)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { response: { success: number; steamid?: string } };
    return data.response.success === 1 ? data.response.steamid ?? null : null;
  } catch {
    return null;
  }
}

export async function steamOwnedGames(steamId: string): Promise<SteamOwnedGame[]> {
  if (!steamEnabled()) return [];
  try {
    const res = await fetch(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${env.STEAM_API_KEY}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { response: { games?: SteamOwnedGame[] } };
    return data.response.games ?? [];
  } catch {
    return [];
  }
}
