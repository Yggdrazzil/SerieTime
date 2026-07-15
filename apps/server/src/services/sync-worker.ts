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
const DAY_MS = 86_400_000;

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

// Notifications de sortie jeux : pour chaque UserMediaStatus d'un jeu suivi
// (non masqué) dont media.releaseDate tombe aujourd'hui, crée une
// Notification de type `game_release` — même schéma que les notifs sociales
// (cf. modules/social/notify.ts : userId/type/title/date/metadataJson).
// Notification n'a pas de colonne mediaId dédiée (mediaId vit dans
// metadataJson, cf. notify.ts), donc la dédup (userId, mediaId, type) se fait
// via une recherche `contains` sur le JSON — même approche que le reste du
// code (aucune colonne relationnelle pour ce cas).
async function notifyGameReleasesToday(): Promise<void> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + DAY_MS);
  const rows = await prisma.userMediaStatus.findMany({
    where: {
      isHidden: false,
      media: { type: 'game', releaseDate: { gte: start, lt: end } },
    },
    select: { userId: true, media: { select: { id: true, title: true } } },
  });
  for (const r of rows) {
    const marker = `"mediaId":"${r.media.id}"`;
    const already = await prisma.notification.findFirst({
      where: { userId: r.userId, type: 'game_release', metadataJson: { contains: marker } },
      select: { id: true },
    });
    if (already) continue;
    await prisma.notification
      .create({
        data: {
          userId: r.userId,
          type: 'game_release',
          title: `${r.media.title} sort aujourd'hui`,
          date: new Date(),
          metadataJson: JSON.stringify({ mediaId: r.media.id, mediaType: 'game' }),
        },
      })
      .catch(() => undefined);
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
    // Passe légère, indépendante de la synchro des séries : ne bloque pas le
    // reste si elle échoue.
    await notifyGameReleasesToday().catch(() => undefined);
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
