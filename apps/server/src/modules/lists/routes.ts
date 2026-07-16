import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { serializeMedia } from '../media/serialize.js';
import { getUserLang } from '../media/userLang.js';

export async function listRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/lists', async (request) => {
    const query = z.object({ mediaId: z.string().optional() }).parse(request.query ?? {});
    const lists = await prisma.mediaList.findMany({
      where: { userId: request.userId },
      include: { items: { include: { media: true }, orderBy: { position: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      lists: lists.map((l) => ({
        id: l.id,
        title: l.title,
        description: l.description,
        coverUrl: l.coverUrl,
        posterPaths: l.items
          .map((i) => i.media.posterPath)
          .filter((p): p is string => !!p)
          .slice(0, 4),
        itemCount: l.items.length,
        containsMediaId: query.mediaId ? l.items.some((i) => i.mediaId === query.mediaId) : undefined,
      })),
    };
  });

  app.post('/api/lists', async (request) => {
    const body = z
      .object({ title: z.string().min(1).max(120), description: z.string().max(500).optional() })
      .parse(request.body);
    const list = await prisma.mediaList.create({
      data: { userId: request.userId, title: body.title, description: body.description },
    });
    return { id: list.id };
  });

  app.get('/api/lists/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const lang = await getUserLang(request.userId);
    const list = await prisma.mediaList.findFirst({
      where: { id, userId: request.userId },
      include: {
        items: {
          include: { media: { include: { statuses: { where: { userId: request.userId } } } } },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!list) return reply.code(404).send({ error: 'not_found' });
    return {
      id: list.id,
      title: list.title,
      description: list.description,
      items: list.items.map((i) => serializeMedia(i.media, i.media.statuses[0] ?? null, lang)),
    };
  });

  app.put('/api/lists/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({ title: z.string().min(1).max(120).optional(), description: z.string().max(500).nullable().optional() })
      .parse(request.body);
    const list = await prisma.mediaList.findFirst({ where: { id, userId: request.userId } });
    if (!list) return reply.code(404).send({ error: 'not_found' });
    await prisma.mediaList.update({ where: { id }, data: body });
    return { ok: true };
  });

  app.delete('/api/lists/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const list = await prisma.mediaList.findFirst({ where: { id, userId: request.userId } });
    if (!list) return reply.code(404).send({ error: 'not_found' });
    await prisma.mediaList.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/api/lists/:id/items', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { mediaId } = z.object({ mediaId: z.string() }).parse(request.body);
    const list = await prisma.mediaList.findFirst({ where: { id, userId: request.userId }, include: { items: true } });
    if (!list) return reply.code(404).send({ error: 'not_found' });
    const existing = list.items.find((i) => i.mediaId === mediaId);
    if (existing) return { ok: true, added: false };
    await prisma.listItem.create({
      data: { listId: id, mediaId, position: list.items.length },
    });
    await prisma.mediaList.update({ where: { id }, data: { updatedAt: new Date() } });
    return { ok: true, added: true };
  });

  app.delete('/api/lists/:id/items/:mediaId', async (request, reply) => {
    const { id, mediaId } = request.params as { id: string; mediaId: string };
    const list = await prisma.mediaList.findFirst({ where: { id, userId: request.userId } });
    if (!list) return reply.code(404).send({ error: 'not_found' });
    await prisma.listItem.deleteMany({ where: { listId: id, mediaId } });
    return { ok: true };
  });

  app.post('/api/lists/:id/reorder', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { mediaIds } = z.object({ mediaIds: z.array(z.string()) }).parse(request.body);
    const list = await prisma.mediaList.findFirst({ where: { id, userId: request.userId } });
    if (!list) return reply.code(404).send({ error: 'not_found' });
    for (const [position, mediaId] of mediaIds.entries()) {
      await prisma.listItem.updateMany({ where: { listId: id, mediaId }, data: { position } });
    }
    return { ok: true };
  });
}
