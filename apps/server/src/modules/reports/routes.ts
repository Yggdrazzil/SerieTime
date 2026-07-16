import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';

// Signalement d'une œuvre inappropriée (série/film/jeu). Les signalements sont
// stockés puis triés manuellement plus tard — pas d'écran admin ici.
export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.post('/api/report', async (request) => {
    const body = z
      .object({
        mediaId: z.string().optional(),
        mediaType: z.enum(['show', 'movie', 'game']),
        tmdbId: z.string().optional(),
        igdbId: z.string().optional(),
        title: z.string().max(300),
        reason: z.string().default('adult'),
        note: z.string().max(500).optional(),
      })
      .parse(request.body);

    // Anti-spam simple : un même utilisateur ne peut pas empiler des
    // signalements identiques (même œuvre, encore en attente). On renvoie
    // quand même 200 pour ne rien révéler côté client.
    const existing = await prisma.report.findFirst({
      where: {
        reporterId: request.userId,
        status: 'pending',
        mediaId: body.mediaId ?? null,
        tmdbId: body.tmdbId ?? null,
        igdbId: body.igdbId ?? null,
      },
    });
    if (existing) return { ok: true };

    await prisma.report.create({
      data: {
        reporterId: request.userId,
        mediaId: body.mediaId ?? null,
        mediaType: body.mediaType,
        tmdbId: body.tmdbId ?? null,
        igdbId: body.igdbId ?? null,
        title: body.title,
        reason: body.reason,
        note: body.note ?? null,
      },
    });
    return { ok: true };
  });
}
