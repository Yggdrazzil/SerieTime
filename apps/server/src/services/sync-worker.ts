import { prisma } from '../db/client.js';
import { syncShowEpisodesFromTmdb, tmdbEnabled } from './tmdb/index.js';
import { syncEpisodesFromTvdb, tvdbEnabled } from './tvdb/index.js';
import { recalculateShowStatus } from '../modules/media/actions.js';

// Worker de fond : synchronise en continu la liste COMPLÈTE d'épisodes des
// séries suivies. Sans lui, une série importée n'a en base que les épisodes
// cochés → elle paraît terminée et n'apparaît jamais dans « À voir » alors
// qu'il reste des saisons à voir (cas Prison Break, Goodbye Lara… sur le
// compte d'Etienne : 758 séries jamais synchronisées).
//
// Il tourne indépendamment des requêtes utilisateur (contrairement au balayage
// on-demand), à cadence douce, en drainant d'abord le retard (jamais synchro),
// puis en rafraîchissant les séries périmées.

const TICK_MS = 12_000; // un lot toutes les 12 s
const BATCH = 3; // 3 séries par lot → ~900/h, gentil pour l'API et la base
const STALE_MS = 3 * 24 * 3_600_000; // rafraîchir une série déjà synchro tous les 3 j

let running = false;

async function syncOne(media: {
  id: string;
  tmdbId: string | null;
  tvdbId: string | null;
  sourcePriority: string | null;
  show: { id: string } | null;
}): Promise<void> {
  const preferTvdb = media.sourcePriority === 'tvdb' && media.tvdbId && tvdbEnabled();
  try {
    if (preferTvdb) await syncEpisodesFromTvdb(media.id);
    else if (media.tmdbId && tmdbEnabled()) await syncShowEpisodesFromTmdb(media.id);
    else if (media.tvdbId && tvdbEnabled()) await syncEpisodesFromTvdb(media.id);
    else {
      // Aucune source exploitable : on horodate quand même pour ne pas la
      // reprendre en boucle (elle sera retentée au cycle « périmé »).
      await prisma.media.update({ where: { id: media.id }, data: { lastSyncedAt: new Date() } });
      return;
    }
  } catch {
    // Échec (API, réseau) : on horodate pour éviter une boucle serrée ; le
    // prochain cycle « périmé » réessaiera dans 3 jours.
    await prisma.media.update({ where: { id: media.id }, data: { lastSyncedAt: new Date() } }).catch(() => undefined);
    return;
  }
  // La liste d'épisodes a pu grandir (nouvelles saisons, épisodes non vus) :
  // on recalcule le statut de CHAQUE utilisateur suivant la série pour qu'elle
  // (re)vienne dans « À voir » avec son prochain épisode non vu.
  if (!media.show) return;
  const users = await prisma.userMediaStatus.findMany({
    where: { mediaId: media.id },
    select: { userId: true },
  });
  for (const u of users) {
    await recalculateShowStatus(u.userId, media.show.id, null).catch(() => undefined);
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const staleBefore = new Date(Date.now() - STALE_MS);
    // Candidates : suivies par ≥ 1 utilisateur, jamais synchronisées OU périmées.
    // orderBy lastSyncedAt asc → les NULL (jamais synchro) d'abord (SQLite).
    const shows = await prisma.media.findMany({
      where: {
        type: 'show',
        statuses: { some: {} },
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }],
      },
      orderBy: { lastSyncedAt: 'asc' },
      take: BATCH,
      select: { id: true, tmdbId: true, tvdbId: true, sourcePriority: true, show: { select: { id: true } } },
    });
    for (const m of shows) await syncOne(m);
  } catch {
    /* on retentera au prochain tick */
  } finally {
    running = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startBackgroundSync(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  // Ne bloque pas l'arrêt du process.
  if (typeof timer.unref === 'function') timer.unref();
}
