import { buildApp } from './app.js';
import { env } from './config/env.js';
import { startBackgroundSync } from './services/sync-worker.js';
import { backfillAllUsers } from './modules/gamification/service.js';
import { backfillUserSettings } from './modules/settings/routes.js';

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  // Synchronisation d'arrière-plan des listes d'épisodes : draine le retard
  // d'import (séries qui n'ont que leurs épisodes cochés) et garde les séries
  // à jour, indépendamment de l'activité. Démarre uniquement le vrai serveur
  // (les tests utilisent buildApp directement, sans ce worker).
  startBackgroundSync();
  // Gamification : premier calcul (silencieux) pour les comptes sans
  // UserProgress — backfill au boot, fire-and-forget (spec §11).
  void backfillAllUsers().catch((err) => app.log.error(err));
  // Migration des réglages globaux → par-utilisateur (fire-and-forget, §audit).
  void backfillUserSettings().catch((err) => app.log.error(err));
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
