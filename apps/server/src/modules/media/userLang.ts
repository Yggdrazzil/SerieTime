import { prisma } from '../../db/client.js';

// Langue de contenu de l'utilisateur (User.language), avec cache mémoire :
// chaque route qui liste des médias la lit UNE fois par requête — sans cache,
// chaque écran ajouterait une requête SQL. TTL court : un changement de langue
// est de toute façon suivi d'un invalidateUserLang immédiat.
const TTL_MS = 60_000;
const cache = new Map<string, { lang: string; ts: number }>();

export async function getUserLang(userId: string): Promise<string> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.lang;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { language: true } });
  const lang = user?.language ?? 'fr';
  cache.set(userId, { lang, ts: Date.now() });
  return lang;
}

export function invalidateUserLang(userId: string): void {
  cache.delete(userId);
}
