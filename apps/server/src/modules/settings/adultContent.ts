import { prisma } from '../../db/client.js';
import { fromJson } from '../../utils/json.js';

// Interrupteur « contenu 18+ » PAR UTILISATEUR (UserSetting.allowAdultContent),
// avec cache mémoire court — calqué sur media/userLang.ts. Chaque route de
// découverte (feed/discover/search/games) le lit UNE fois par requête ; sans
// cache, chaque écran ajouterait une requête SQL. TTL court + invalidation
// immédiate au POST /api/settings.
const TTL_MS = 60_000;
const cache = new Map<string, { allow: boolean; ts: number }>();

export async function allowsAdultContent(userId: string): Promise<boolean> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.allow;
  const row = await prisma.userSetting.findUnique({ where: { userId } });
  const data = fromJson<{ allowAdultContent?: boolean }>(row?.dataJson, {});
  const allow = data.allowAdultContent === true; // défaut : false
  cache.set(userId, { allow, ts: Date.now() });
  return allow;
}

export function invalidateAdultContent(userId: string): void {
  cache.delete(userId);
}
