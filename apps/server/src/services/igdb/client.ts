import { env } from '../../config/env.js';
import { prisma } from '../../db/client.js';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const IGDB_BASE = 'https://api.igdb.com/v4';

export function igdbEnabled(): boolean {
  return env.IGDB_ENABLED && Boolean(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET);
}

// Jeton d'app Twitch (client credentials) mis en cache mémoire jusqu'à expiration.
let cachedToken: { value: string; expiresAt: number } | null = null;
async function twitchToken(): Promise<string | null> {
  if (!igdbEnabled()) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const body = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });
  try {
    const res = await fetch(TOKEN_URL, { method: 'POST', body });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return cachedToken.value;
  } catch {
    return null;
  }
}

// Requête Apicalypse POST + cache ApiCache (source 'igdb'), TTL configurable.
export async function igdbQuery<T>(endpoint: string, apicalypse: string, ttlMs: number): Promise<T | null> {
  if (!igdbEnabled()) return null;
  const cacheKey = `${endpoint}:${apicalypse}`;
  const cached = await prisma.apiCache.findUnique({
    where: { source_cacheKey: { source: 'igdb', cacheKey } },
  });
  if (cached && cached.expiresAt > new Date()) return JSON.parse(cached.responseJson) as T;

  const token = await twitchToken();
  if (!token) return cached ? (JSON.parse(cached.responseJson) as T) : null;
  try {
    const res = await fetch(`${IGDB_BASE}/${endpoint}`, {
      method: 'POST',
      headers: { 'Client-ID': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
      body: apicalypse,
    });
    if (!res.ok) return cached ? (JSON.parse(cached.responseJson) as T) : null;
    const data = (await res.json()) as T;
    await prisma.apiCache.upsert({
      where: { source_cacheKey: { source: 'igdb', cacheKey } },
      create: { source: 'igdb', cacheKey, responseJson: JSON.stringify(data), expiresAt: new Date(Date.now() + ttlMs) },
      update: { responseJson: JSON.stringify(data), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return data;
  } catch {
    return cached ? (JSON.parse(cached.responseJson) as T) : null;
  }
}
