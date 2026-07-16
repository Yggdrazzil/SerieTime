import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { APP_VERSION, env } from './config/env.js';
import { authRoutes } from './modules/auth/routes.js';
import { showRoutes } from './modules/shows/routes.js';
import { episodeRoutes } from './modules/episodes/routes.js';
import { movieRoutes } from './modules/movies/routes.js';
import { searchRoutes } from './modules/search/routes.js';
import { profileRoutes } from './modules/profile/routes.js';
import { statsRoutes } from './modules/stats/routes.js';
import { listRoutes } from './modules/lists/routes.js';
import { settingsRoutes } from './modules/settings/routes.js';
import { backupRoutes } from './modules/backup/routes.js';
import { importTvtimeRoutes } from './modules/import-tvtime/routes.js';
import { socialRoutes } from './modules/social/routes.js';
import { peopleRoutes } from './modules/people/routes.js';
import { gamesRoutes } from './modules/games/routes.js';
import { gamificationRoutes } from './modules/gamification/routes.js';
import { reportsRoutes } from './modules/reports/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      // En développement, tout est autorisé (Expo web sur :8081, outils locaux).
      if (env.NODE_ENV !== 'production') return cb(null, true);
      const allowed = env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim());
      // Requêtes sans origin (curl, app native) autorisées.
      if (!origin || allowed.includes(origin)) cb(null, true);
      else cb(null, false);
    },
    credentials: true,
  });

  await app.register(multipart, {
    limits: { fileSize: env.MAX_IMPORT_ZIP_SIZE_MB * 1024 * 1024, files: 1 },
  });

  // Anti brute-force / spam : plafond global généreux (usage normal jamais gêné),
  // et plafond serré appliqué manuellement sur login/register (voir auth/routes).
  // Désactivé en test pour ne pas fausser la suite.
  if (env.NODE_ENV !== 'test') {
    await app.register(rateLimit, { global: false, max: 300, timeWindow: '1 minute' });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'validation_error', details: error.issues });
    }
    app.log.error(error);
    const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    return reply.code(statusCode).send({ error: statusCode >= 500 ? 'internal_error' : error.message });
  });

  // `sources` permet de diagnostiquer la config d'un simple coup d'œil navigateur.
  app.get('/health', async () => {
    const { tvdbEnabled } = await import('./services/tvdb/index.js');
    const { tmdbEnabled } = await import('./services/tmdb/index.js');
    return {
      ok: true,
      app: env.APP_NAME,
      version: APP_VERSION,
      sources: { tvdb: tvdbEnabled(), tmdb: tmdbEnabled() },
    };
  });

  await app.register(authRoutes);
  await app.register(showRoutes);
  await app.register(episodeRoutes);
  await app.register(movieRoutes);
  await app.register(searchRoutes);
  await app.register(profileRoutes);
  await app.register(statsRoutes);
  await app.register(listRoutes);
  await app.register(settingsRoutes);
  await app.register(backupRoutes);
  await app.register(importTvtimeRoutes);
  await app.register(socialRoutes);
  await app.register(peopleRoutes);
  await app.register(gamesRoutes);
  await app.register(gamificationRoutes);
  await app.register(reportsRoutes);

  return app;
}
