import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { APP_VERSION } from '../../config/env.js';

// Export/restauration JSON des données utilisateur (spec §14.10, §37).
export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.post('/api/backup/export', async (request) => {
    const userId = request.userId;
    const [user, media, shows, seasons, episodes, mediaStatuses, episodeStatuses, watchEvents, lists, listItems] =
      await Promise.all([
        prisma.user.findUnique({ where: { id: userId } }),
        prisma.media.findMany(),
        prisma.show.findMany(),
        prisma.season.findMany(),
        prisma.episode.findMany(),
        prisma.userMediaStatus.findMany({ where: { userId } }),
        prisma.userEpisodeStatus.findMany({ where: { userId } }),
        prisma.watchEvent.findMany({ where: { userId } }),
        prisma.mediaList.findMany({ where: { userId } }),
        prisma.listItem.findMany({ where: { list: { userId } } }),
      ]);
    // Jamais de secret dans l'export (le fichier circule hors de l'app).
    const { passwordHash: _passwordHash, ...safeUser } = user ?? ({} as Record<string, unknown>);
    return {
      app: 'PlotTime',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      data: { user: safeUser, media, shows, seasons, episodes, mediaStatuses, episodeStatuses, watchEvents, lists, listItems },
    };
  });

  app.post('/api/backup/import', async (request, reply) => {
    const body = z
      .object({
        // Les sauvegardes exportées avant le renommage disent encore « SerieTime ».
        app: z.union([z.literal('PlotTime'), z.literal('SerieTime')]),
        version: z.string(),
        data: z.object({
          media: z.array(z.record(z.unknown())),
          shows: z.array(z.record(z.unknown())),
          seasons: z.array(z.record(z.unknown())),
          episodes: z.array(z.record(z.unknown())),
          mediaStatuses: z.array(z.record(z.unknown())),
          episodeStatuses: z.array(z.record(z.unknown())),
          watchEvents: z.array(z.record(z.unknown())).default([]),
          lists: z.array(z.record(z.unknown())).default([]),
          listItems: z.array(z.record(z.unknown())).default([]),
        }),
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_backup', details: body.error.issues });

    const userId = request.userId;
    const d = body.data.data;
    const restore = async <T extends { id?: unknown }>(
      rows: Record<string, unknown>[],
      upsert: (row: Record<string, unknown>) => Promise<T | void>,
    ) => {
      for (const row of rows) {
        try {
          await upsert(row);
        } catch {
          // ligne corrompue : ignorée, la restauration continue
        }
      }
    };

    const dateFields = new Set([
      'createdAt', 'updatedAt', 'firstAirDate', 'releaseDate', 'lastSyncedAt', 'airDate',
      'addedAt', 'startedAt', 'completedAt', 'lastWatchedAt', 'watchedAt', 'eventDate',
      'nextEpisodeAirDate', 'lastEpisodeAirDate', 'fetchedAt', 'expiresAt', 'date',
    ]);
    const revive = (row: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = typeof v === 'string' && dateFields.has(k) ? new Date(v) : v;
      }
      return out;
    };

    // Tables du CATALOGUE (partagées entre tous les comptes) : on complète les
    // manquants mais on n'écrase JAMAIS une ligne existante — sinon un fichier de
    // sauvegarde forgé pourrait modifier le catalogue vu par tout le monde.
    await restore(d.media, (r) => {
      const row = revive(r) as never;
      return prisma.media.upsert({ where: { id: String(r['id']) }, create: row, update: {} });
    });
    await restore(d.shows, (r) => {
      const row = revive(r) as never;
      return prisma.show.upsert({ where: { id: String(r['id']) }, create: row, update: {} });
    });
    await restore(d.seasons, (r) => {
      const row = revive(r) as never;
      return prisma.season.upsert({ where: { id: String(r['id']) }, create: row, update: {} });
    });
    await restore(d.episodes, (r) => {
      const row = revive(r) as never;
      return prisma.episode.upsert({ where: { id: String(r['id']) }, create: row, update: {} });
    });

    // Tables PERSONNELLES : la mise à jour est strictement bornée aux lignes de
    // l'appelant (updateMany scoping par userId) ; sinon création. Un id qui
    // appartient à un autre compte échoue en création (contrainte unique) et la
    // ligne est simplement ignorée : impossible de voler/écraser autrui.
    const restoreOwned = async (
      rows: Record<string, unknown>[],
      update: (id: string, row: never) => Promise<{ count: number }>,
      create: (id: string, row: never) => Promise<unknown>,
    ) =>
      restore(rows, async (r) => {
        const id = String(r['id']);
        const row = { ...revive(r), userId } as never;
        const updated = await update(id, row);
        if (updated.count === 0) await create(id, row);
      });

    await restoreOwned(
      d.mediaStatuses,
      (id, row) => prisma.userMediaStatus.updateMany({ where: { id, userId }, data: row }),
      (id, row) => prisma.userMediaStatus.create({ data: { ...(row as object), id } as never }),
    );
    await restoreOwned(
      d.episodeStatuses,
      (id, row) => prisma.userEpisodeStatus.updateMany({ where: { id, userId }, data: row }),
      (id, row) => prisma.userEpisodeStatus.create({ data: { ...(row as object), id } as never }),
    );
    await restoreOwned(
      d.lists,
      (id, row) => prisma.mediaList.updateMany({ where: { id, userId }, data: row }),
      (id, row) => prisma.mediaList.create({ data: { ...(row as object), id } as never }),
    );
    // Les items de liste appartiennent à l'utilisateur via leur liste.
    await restore(d.listItems, async (r) => {
      const id = String(r['id']);
      const listId = String(r['listId']);
      const owned = await prisma.mediaList.findFirst({ where: { id: listId, userId }, select: { id: true } });
      if (!owned) return;
      const row = revive(r) as never;
      const updated = await prisma.listItem.updateMany({ where: { id, list: { userId } }, data: row });
      if (updated.count === 0) await prisma.listItem.create({ data: { ...(row as object), id } as never });
    });
    await restoreOwned(
      d.watchEvents,
      (id, row) => prisma.watchEvent.updateMany({ where: { id, userId }, data: row }),
      (id, row) => prisma.watchEvent.create({ data: { ...(row as object), id } as never }),
    );

    return { ok: true };
  });
}
