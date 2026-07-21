import { prisma } from '../../db/client.js';
import { tvdbEnabled, tvdbSeriesEpisodesByType, tvdbSeriesExtended } from './client.js';

// Ordres d'épisodes alternatifs TheTVDB (spec produit 2026-07-21) : certaines
// plateformes (Disney+…) numérotent autrement que l'ordre de diffusion (cas
// réel : American Dad tvdbId 73141 — Aired 23 saisons / Alternate 20 ≈ Disney).
// PRINCIPE INTANGIBLE : les épisodes restent les MÊMES lignes en base — seule
// une table de correspondance (EpisodeAltNumber) change la (saison, numéro)
// affichée. Progression, stats, défis et écritures (par episodeId) : inchangés.

export const EPISODE_ORDER_TYPES = ['official', 'dvd', 'absolute', 'alternate', 'regional', 'altdvd'] as const;
export type EpisodeOrderType = (typeof EPISODE_ORDER_TYPES)[number];

// Libellés FR affichés par le mobile (légende discrète + override).
export const EPISODE_ORDER_LABELS: Record<string, string> = {
  official: 'Diffusion',
  alternate: 'Streaming',
  dvd: 'DVD',
  absolute: 'Absolu',
  regional: 'Régional',
  altdvd: 'DVD alternatif',
};

export type AvailableOrder = { type: string; label: string; seasons: number };

// Ordres disponibles chez TheTVDB pour une série : types de saisons dédupliqués
// de /series/{id}/extended (déjà mis en cache ApiCache 3 j par le client).
// null = TheTVDB injoignable (à distinguer d'une série sans ordres alternatifs).
export async function getAvailableOrders(tvdbSeriesId: string): Promise<AvailableOrder[] | null> {
  if (!tvdbEnabled()) return null;
  const ext = await tvdbSeriesExtended(tvdbSeriesId);
  if (!ext) return null;
  const byType = new Map<string, { name?: string; seasons: Set<number> }>();
  for (const s of ext.seasons ?? []) {
    const type = s.type?.type;
    if (!type || typeof s.number !== 'number') continue;
    const entry = byType.get(type) ?? { name: s.type?.name, seasons: new Set<number>() };
    if (!entry.name && s.type?.name) entry.name = s.type.name;
    if (s.number > 0) entry.seasons.add(s.number); // les spéciaux (saison 0) ne comptent pas
    byType.set(type, entry);
  }
  return [...byType.entries()].map(([type, e]) => ({
    type,
    label: EPISODE_ORDER_LABELS[type] ?? e.name ?? type,
    seasons: e.seasons.size,
  }));
}

// Synchronise la table de correspondance EpisodeAltNumber pour (série, ordre).
// Jointure par id d'épisode TVDB : nos Episode issus de TheTVDB portent
// Episode.tvdbId ; pour ceux créés via TMDb (pas de tvdbId), on passe par
// l'ordre officiel TheTVDB → (S,E) officiel → notre épisode (seasonNumber,
// episodeNumber). Idempotent (delete + createMany). Retourne le nombre de
// correspondances écrites (0 = échec propre, rien n'est posé).
export async function syncAltOrder(mediaId: string, orderType: string): Promise<number> {
  const media = await prisma.media.findUnique({ where: { id: mediaId }, include: { show: true } });
  if (!media?.show || !media.tvdbId || !tvdbEnabled()) return 0;
  const showId = media.show.id;

  const alt = (await tvdbSeriesEpisodesByType(media.tvdbId, orderType)).filter(
    (e) => e.seasonNumber != null && e.number != null,
  );
  if (alt.length === 0) return 0;

  const ours = await prisma.episode.findMany({
    where: { showId },
    select: { id: true, tvdbId: true, seasonNumber: true, episodeNumber: true },
  });
  const byTvdbId = new Map(ours.filter((e) => e.tvdbId).map((e) => [e.tvdbId!, e]));
  const bySE = new Map(ours.map((e) => [`${e.seasonNumber}:${e.episodeNumber}`, e]));

  // Repli (S,E) officiel : chargé seulement si au moins un épisode local n'a
  // pas de tvdbId correspondant (série synchronisée via TMDb).
  let officialByTvdbId: Map<number, { seasonNumber: number; number: number }> | null = null;
  if (alt.some((e) => !byTvdbId.has(String(e.id)))) {
    const official = await tvdbSeriesEpisodesByType(media.tvdbId, 'official');
    officialByTvdbId = new Map(official.map((e) => [e.id, { seasonNumber: e.seasonNumber, number: e.number }]));
  }

  const seen = new Set<string>();
  const rows: { showId: string; orderType: string; episodeId: string; seasonNumber: number; episodeNumber: number }[] =
    [];
  for (const ep of alt) {
    let local = byTvdbId.get(String(ep.id));
    if (!local && officialByTvdbId) {
      const off = officialByTvdbId.get(ep.id);
      if (off) local = bySE.get(`${off.seasonNumber}:${off.number}`);
    }
    if (!local || seen.has(local.id)) continue;
    seen.add(local.id);
    rows.push({ showId, orderType, episodeId: local.id, seasonNumber: ep.seasonNumber, episodeNumber: ep.number });
  }
  if (rows.length === 0) return 0;

  await prisma.$transaction([
    prisma.episodeAltNumber.deleteMany({ where: { showId, orderType } }),
    prisma.episodeAltNumber.createMany({ data: rows }),
  ]);
  return rows.length;
}

// HEURISTIQUE AUTO (décision produit : pas de sélecteur visible) — si la série
// a un tvdbId ET un provider de streaming connu (« Où regarder ») ET que
// l'ordre `alternate` existe chez TheTVDB avec un nombre de saisons DIFFÉRENT
// de l'officiel → synchronise `alternate` et pose Show.defaultEpisodeOrder.
// Appelée paresseusement au premier GET /api/shows/:id ; le résultat (même
// null) est marqué via episodeOrderCheckedAt pour ne pas re-vérifier à chaque
// fiche. JAMAIS bloquant : en cas d'échec TheTVDB, on ne marque rien (nouvel
// essai plus tard) et la fiche est servie normalement en officiel.
export async function resolveDefaultOrder(mediaId: string): Promise<string | null> {
  const media = await prisma.media.findUnique({ where: { id: mediaId }, include: { show: true } });
  if (!media?.show) return null;
  if (media.show.episodeOrderCheckedAt) return media.show.defaultEpisodeOrder;

  const showId = media.show.id;
  const done = async (order: string | null): Promise<string | null> => {
    await prisma.show
      .update({ where: { id: showId }, data: { defaultEpisodeOrder: order, episodeOrderCheckedAt: new Date() } })
      .catch(() => undefined);
    return order;
  };

  if (!media.tvdbId || !tvdbEnabled()) return done(null);

  // Provider de streaming connu (table Provider, remplie par « Où regarder ») :
  // abonnement / gratuit / pub — la location/achat ne renumérote pas les saisons.
  const streaming = await prisma.provider.findFirst({
    where: { mediaId, offerType: { in: ['flatrate', 'free', 'ads'] } },
  });
  if (!streaming) return done(null);

  const orders = await getAvailableOrders(media.tvdbId);
  if (orders === null) return null; // échec TheTVDB : on ne marque pas, on réessaiera

  const official = orders.find((o) => o.type === 'official');
  const alternate = orders.find((o) => o.type === 'alternate');
  if (!official || !alternate || alternate.seasons === 0 || alternate.seasons === official.seasons) {
    return done(null);
  }

  const matched = await syncAltOrder(mediaId, 'alternate').catch(() => 0);
  if (matched === 0) return done(null);
  return done('alternate');
}
