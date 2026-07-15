import { prisma } from '../../db/client.js';
import { syncShowEpisodesFromTmdb } from '../../services/tmdb/index.js';
import { syncEpisodesFromTvdb } from '../../services/tvdb/index.js';
import { recalculateShowStatus } from '../media/actions.js';

// Fenêtre de fraîcheur du balayage d'arrière-plan et anti-rafale process-local.
const STALE_MS = 12 * 3_600_000; // resynchroniser une série en cours après 12 h
// Séries « Terminée » : resynchronisées aussi, mais bien moins souvent — un
// renouvellement (fréquent pour l'anime, marqué « Ended » entre deux saisons)
// est détecté sous une semaine au lieu de jamais.
const ENDED_STALE_MS = 7 * 24 * 3_600_000;
const SWEEP_COOLDOWN_MS = 2 * 60_000; // au plus un balayage toutes les 2 min
const MAX_PER_SWEEP = 4; // limite d'appels TVDB/TMDb par balayage

let lastSweepAt = 0;

// Rafraîchit EN ARRIÈRE-PLAN les séries EN COURS les plus périmées de la
// bibliothèque : une saison qui démarre (ex. Clevatess S2) apparaît dans
// « À voir » sans devoir ouvrir chaque fiche — comportement TV Time, dont le
// serveur synchronise en continu. Appelé en fire-and-forget depuis la file :
// la réponse n'attend rien, les données fraîches arrivent au chargement suivant.
export async function refreshStaleContinuingShows(userId: string): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_COOLDOWN_MS) return;
  lastSweepAt = now;

  const statuses = await prisma.userMediaStatus.findMany({
    where: { userId, isHidden: false, status: { not: 'abandoned' }, media: { type: 'show' } },
    include: { media: { include: { show: { select: { id: true } } } } },
  });
  const isEnded = (m: { status: string | null }) => Boolean(m.status && /ended|canceled|cancelled/i.test(m.status));
  const candidates = statuses
    .map((s) => s.media)
    .filter((m) => !m.lastSyncedAt || now - m.lastSyncedAt.getTime() > (isEnded(m) ? ENDED_STALE_MS : STALE_MS))
    // Les séries en cours passent d'abord ; à statut égal, la plus périmée.
    .sort((a, b) => {
      const e = Number(isEnded(a)) - Number(isEnded(b));
      if (e !== 0) return e;
      return (a.lastSyncedAt?.getTime() ?? 0) - (b.lastSyncedAt?.getTime() ?? 0);
    })
    .slice(0, MAX_PER_SWEEP);

  for (const m of candidates) {
    try {
      if (m.sourcePriority === 'tvdb' && m.tvdbId) await syncEpisodesFromTvdb(m.id);
      else if (m.tmdbId) await syncShowEpisodesFromTmdb(m.id);
      else continue;
      await prisma.media.update({ where: { id: m.id }, data: { lastSyncedAt: new Date() } });
      // La sync peut apporter une nouvelle saison : on recalcule le statut de
      // l'utilisateur (une série « Terminée » redevient « En cours », donc
      // visible dans les bons groupes de la bibliothèque).
      if (m.show) await recalculateShowStatus(userId, m.show.id, null).catch(() => undefined);
    } catch {
      /* réessaiera au prochain balayage */
    }
  }
}

// Réparation COMPLÈTE : resynchronise TOUTES les séries suivies d'un utilisateur
// (dates de diffusion des épisodes), sans le plafond `MAX_PER_SWEEP` du balayage
// de fond. Utilisé par le bouton « Resynchroniser ma bibliothèque » (et pertinent
// après un import, qui crée les épisodes sans dates). Fire-and-forget côté serveur ;
// throttlé pour ménager TVDB/TMDb ; garde-fou anti-double-exécution par utilisateur.
// Non destructif : ne touche qu'aux métadonnées (dates), jamais aux épisodes vus.
const resyncRunning = new Set<string>();

export function isResyncRunning(userId: string): boolean {
  return resyncRunning.has(userId);
}

export async function resyncAllUserShows(userId: string): Promise<void> {
  if (resyncRunning.has(userId)) return;
  resyncRunning.add(userId);
  try {
    const statuses = await prisma.userMediaStatus.findMany({
      where: { userId, isHidden: false, status: { not: 'abandoned' }, media: { type: 'show' } },
      include: { media: { include: { show: { select: { id: true } } } } },
      orderBy: { updatedAt: 'desc' },
    });
    for (const s of statuses) {
      const m = s.media;
      try {
        if (m.sourcePriority === 'tvdb' && m.tvdbId) await syncEpisodesFromTvdb(m.id);
        else if (m.tmdbId) await syncShowEpisodesFromTmdb(m.id);
        else if (m.tvdbId) await syncEpisodesFromTvdb(m.id);
        else continue;
        await prisma.media.update({ where: { id: m.id }, data: { lastSyncedAt: new Date() } });
        if (m.show) await recalculateShowStatus(userId, m.show.id, null).catch(() => undefined);
      } catch {
        /* on continue : une série en échec ne bloque pas les autres */
      }
      await new Promise((r) => setTimeout(r, 300)); // throttle TVDB/TMDb
    }
  } finally {
    resyncRunning.delete(userId);
  }
}
