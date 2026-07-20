import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';

// Signalement d'une œuvre inappropriée (série/film/jeu) OU d'un commentaire
// abusif (mediaType 'comment' + commentId — exigence stores, Apple 1.2).
// Les signalements sont stockés puis triés manuellement plus tard — pas
// d'écran admin ici.
export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.post('/api/report', async (request, reply) => {
    const body = z
      .object({
        mediaId: z.string().optional(),
        mediaType: z.enum(['show', 'movie', 'game', 'comment']),
        tmdbId: z.string().optional(),
        igdbId: z.string().optional(),
        commentId: z.string().optional(),
        title: z.string().max(300),
        reason: z.string().max(500).default('adult'),
        note: z.string().max(500).optional(),
      })
      .parse(request.body);

    // Signalement de commentaire : le commentaire doit exister (le client passe
    // un extrait du texte dans `title` pour le tri manuel).
    if (body.mediaType === 'comment') {
      if (!body.commentId) return reply.code(400).send({ error: 'comment_id_required' });
      const comment = await prisma.comment.findUnique({ where: { id: body.commentId } });
      if (!comment) return reply.code(404).send({ error: 'comment_not_found' });
    }

    // Anti-spam simple : un même utilisateur ne peut pas empiler des
    // signalements identiques (même œuvre OU même commentaire, encore en
    // attente). On renvoie quand même 200 pour ne rien révéler côté client.
    const existing = await prisma.report.findFirst({
      where: {
        reporterId: request.userId,
        status: 'pending',
        mediaId: body.mediaId ?? null,
        tmdbId: body.tmdbId ?? null,
        igdbId: body.igdbId ?? null,
        commentId: body.commentId ?? null,
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
        commentId: body.commentId ?? null,
        title: body.title,
        reason: body.reason,
        note: body.note ?? null,
      },
    });
    return { ok: true };
  });
}
