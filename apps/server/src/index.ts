import { buildApp } from './app.js';
import { env } from './config/env.js';
import { startBackgroundSync } from './services/sync-worker.js';

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  // Synchronisation d'arrière-plan des listes d'épisodes : draine le retard
  // d'import (séries qui n'ont que leurs épisodes cochés) et garde les séries
  // à jour, indépendamment de l'activité. Démarre uniquement le vrai serveur
  // (les tests utilisent buildApp directement, sans ce worker).
  startBackgroundSync();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
