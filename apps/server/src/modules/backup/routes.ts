import type { FastifyInstance } from 'fastify';
import AdmZip from 'adm-zip';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { APP_VERSION } from '../../config/env.js';

// ————— Export « format TV Time » (demande produit) —————
// Le contrat n'est PAS un fichier officiel TV Time (il n'y a pas de spec
// publique) : c'est NOTRE importeur (packages/core/src/importers/records.ts +
// normalize.ts) qui fait foi. Noms de fichiers = liste blanche TVTIME_KNOWN,
// intitulés de colonnes = alias FIELD_ALIASES — le zip produit ici doit être
// relu parfaitement par analyzeImport (test d'aller-retour export-tvtime.test.ts).

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n';
}

// Format de date TV Time : « YYYY-MM-DD HH:mm:ss » (UTC ici — parseDateSafe le relit).
function tvtimeDate(d: Date | null | undefined): string {
  return d ? d.toISOString().replace('T', ' ').slice(0, 19) : '';
}

// « YYYY-MM-DD » (release_date des films ; l'année est lue sur les 4 premiers caractères).
function tvtimeDay(d: Date | null | undefined, year?: number | null): string {
  if (d) return d.toISOString().slice(0, 10);
  return year ? `${year}-01-01` : '';
}

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

  // ZIP de CSV calqués sur l'export TV Time : lisible par tout outil qui
  // comprend ce format — et par notre propre import (aller-retour garanti).
  // Les jeux sont hors format TV Time : ils restent couverts par l'export JSON.
  app.post('/api/backup/export-tvtime', async (request, reply) => {
    const userId = request.userId;
    const [showStatuses, movieStatuses, episodeStatuses] = await Promise.all([
      prisma.userMediaStatus.findMany({
        where: { userId, media: { type: 'show' } },
        include: { media: true },
        orderBy: { addedAt: 'asc' },
      }),
      prisma.userMediaStatus.findMany({
        where: { userId, media: { type: 'movie' } },
        include: { media: true },
        orderBy: { addedAt: 'asc' },
      }),
      prisma.userEpisodeStatus.findMany({
        where: { userId, status: 'watched' },
        include: { episode: { include: { show: { include: { media: true } } } } },
        orderBy: { watchedAt: 'asc' },
      }),
    ]);

    // 1) seen_episode.csv — un rang par épisode vu. `tvdb_id` = id TheTVDB de
    //    LA SÉRIE (comme TV Time : notre normaliseur le lit en tvdbShowId),
    //    `episode_id` = id TheTVDB de l'épisode (alias tvdbEpisodeId).
    const seenEpisodes = toCsv(
      ['tv_show_name', 'tvdb_id', 'tmdb_id', 'episode_season_number', 'episode_number', 'episode_id', 'watched_at', 'rating'],
      episodeStatuses.map((s) => [
        s.episode.show.media.title,
        s.episode.show.media.tvdbId,
        s.episode.show.media.tmdbId,
        s.episode.seasonNumber,
        s.episode.episodeNumber,
        s.episode.tvdbId,
        tvtimeDate(s.watchedAt ?? s.updatedAt),
        s.rating,
      ]),
    );

    // 2) followed_tv_show.csv — un rang par série de la bibliothèque.
    //    `active = 0` est la façon TV Time de dire « Arrêtée » (statut
    //    abandoned) : notre normaliseur le retraduit en stopped_watching.
    const followedShows = toCsv(
      ['tv_show_name', 'tvdb_id', 'tmdb_id', 'active', 'created_at', 'rating'],
      showStatuses.map((s) => [
        s.media.title,
        s.media.tvdbId,
        s.media.tmdbId,
        s.status === 'abandoned' ? 0 : 1,
        tvtimeDate(s.addedAt),
        s.rating,
      ]),
    );

    // 3) user_show_special_status.csv — comme TV Time : `favorite` (séries
    //    favorites) et `for_later` (watchlist) dans la même colonne status.
    const specialRows: unknown[][] = [];
    for (const s of showStatuses) {
      if (s.isFavorite) {
        specialRows.push([s.media.title, s.media.tvdbId, s.media.tmdbId, 'favorite', tvtimeDate(s.favoritedAt ?? s.addedAt)]);
      }
      if (s.status === 'watchlist') {
        specialRows.push([s.media.title, s.media.tvdbId, s.media.tmdbId, 'for_later', tvtimeDate(s.addedAt)]);
      }
    }
    const specialStatus = toCsv(['tv_show_name', 'tv_show_id', 'tmdb_id', 'status', 'created_at'], specialRows);

    // 4) tracking-prod-records-v2.csv — les films, noyés dans les tracking
    //    records comme chez TV Time : entity_type=movie, type=watch|towatch.
    const trackingRecords = toCsv(
      ['entity_type', 'movie_name', 'release_date', 'type', 'tmdb_id', 'created_at'],
      movieStatuses.map((s) => {
        const watched = s.status === 'completed';
        return [
          'movie',
          s.media.title,
          tvtimeDay(s.media.releaseDate, s.media.year),
          watched ? 'watch' : 'towatch',
          s.media.tmdbId,
          tvtimeDate(watched ? s.completedAt ?? s.lastWatchedAt ?? s.addedAt : s.addedAt),
        ];
      }),
    );

    const zip = new AdmZip();
    zip.addFile('seen_episode.csv', Buffer.from(seenEpisodes, 'utf-8'));
    zip.addFile('followed_tv_show.csv', Buffer.from(followedShows, 'utf-8'));
    zip.addFile('user_show_special_status.csv', Buffer.from(specialStatus, 'utf-8'));
    zip.addFile('tracking-prod-records-v2.csv', Buffer.from(trackingRecords, 'utf-8'));

    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', 'attachment; filename="plottime-export-tvtime.zip"')
      .send(zip.toBuffer());
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
