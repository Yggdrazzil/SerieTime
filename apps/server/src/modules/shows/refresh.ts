import { prisma } from '../../db/client.js';
import { syncShowEpisodesFromTmdb } from '../../services/tmdb/index.js';
import { syncEpisodesFromTvdb } from '../../services/tvdb/index.js';
import { recalculateShowStatus } from '../media/actions.js';

// Fenêtre de fraîcheur du balayage d'arrière-plan et anti-rafale process-local.
const STALE_MS = 12 * 3_600_000; // resynchroniser une série en cours après 12 h
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
  const candidates = statuses
    .map((s) => s.media)
    .filter((m) => !(m.status && /ended|canceled|cancelled/i.test(m.status)))
    .filter((m) => !m.lastSyncedAt || now - m.lastSyncedAt.getTime() > STALE_MS)
    .sort((a, b) => (a.lastSyncedAt?.getTime() ?? 0) - (b.lastSyncedAt?.getTime() ?? 0))
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
