import { prisma } from '../../db/client.js';

// Mémoire du flux Explorer : chaque item servi (série/film/jeu) est mémorisé
// (ExploreImpression) et exclu du tirage pendant 3 jours — sans quoi chaque
// refresh retirait dans le même vivier et proposait toujours les mêmes titres.

// Vu il y a moins de 3 jours → exclu du tirage.
export const IMPRESSION_EXCLUDE_MS = 3 * 86_400_000;
// Plus vieux que 14 jours → purgé au fil de l'eau (la table reste petite).
export const IMPRESSION_PRUNE_MS = 14 * 86_400_000;

// Impressions récentes (< 3 jours) de l'utilisateur : itemKey → servedAt.
export async function loadRecentImpressions(userId: string): Promise<Map<string, Date>> {
  const rows = await prisma.exploreImpression.findMany({
    where: { userId, servedAt: { gte: new Date(Date.now() - IMPRESSION_EXCLUDE_MS) } },
    select: { itemKey: true, servedAt: true },
  });
  return new Map(rows.map((r) => [r.itemKey, r.servedAt]));
}

// Filtre anti-répétition AVEC garde anti-famine : les items jamais vus (ou vus
// il y a > 3 jours) passent en premier ; s'il en reste moins que `target`, on
// complète avec les items déjà vus LES PLUS ANCIENS (en dernier recours, tout
// le vivier repasse) — le flux ne doit jamais être vide à cause du filtre.
export function filterSeenWithFallback<T>(
  items: T[],
  keyOf: (item: T) => string,
  seen: Map<string, Date>,
  target: number,
): T[] {
  const fresh: T[] = [];
  const stale: { item: T; servedAt: Date }[] = [];
  for (const item of items) {
    const servedAt = seen.get(keyOf(item));
    if (servedAt) stale.push({ item, servedAt });
    else fresh.push(item);
  }
  if (fresh.length >= target) return fresh;
  stale.sort((a, b) => a.servedAt.getTime() - b.servedAt.getTime());
  return [...fresh, ...stale.slice(0, target - fresh.length).map((s) => s.item)];
}

// Enregistre les impressions des items renvoyés — deleteMany + createMany dans
// une transaction (pas de N+1 upsert), puis purge fire-and-forget des vieilles
// lignes (> 14 jours).
export async function recordImpressions(userId: string, itemKeys: string[]): Promise<void> {
  if (itemKeys.length === 0) return;
  const now = new Date();
  await prisma.$transaction([
    prisma.exploreImpression.deleteMany({ where: { userId, itemKey: { in: itemKeys } } }),
    prisma.exploreImpression.createMany({
      data: itemKeys.map((itemKey) => ({ userId, itemKey, servedAt: now })),
    }),
  ]);
  void prisma.exploreImpression
    .deleteMany({ where: { userId, servedAt: { lt: new Date(Date.now() - IMPRESSION_PRUNE_MS) } } })
    .catch(() => undefined);
}
