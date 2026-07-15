import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { UnresolvedMappingDto } from '@serietime/types';
import { prisma } from '../../db/client.js';
import { env } from '../../config/env.js';
import { requireAuth } from '../auth/routes.js';
import { fromJson, toJson } from '../../utils/json.js';
import {
  analyzeImport,
  applyMapping,
  confirmImport,
  isZipBuffer,
  resumeStalledImport,
  saveUpload,
  sha256,
} from './service.js';

export async function importTvtimeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // Upload du ZIP (multipart). Spec §15.3.
  app.post('/api/import/tvtime/upload', async (request, reply) => {
    const file = await request.file({
      limits: { fileSize: env.MAX_IMPORT_ZIP_SIZE_MB * 1024 * 1024 },
    });
    if (!file) return reply.code(400).send({ error: 'no_file' });
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.code(413).send({ error: 'file_too_large', maxMb: env.MAX_IMPORT_ZIP_SIZE_MB });
    }
    if (!isZipBuffer(buffer)) {
      return reply.code(400).send({ error: 'not_a_zip' });
    }
    const hash = sha256(buffer);
    const force = (request.query as { force?: string }).force === 'true';
    // Dédoublonnage par utilisateur : le même fichier peut être importé par deux amis.
    const duplicate = await prisma.import.findFirst({ where: { fileHash: hash, userId: request.userId } });
    if (duplicate && !force) {
      return reply.code(409).send({
        error: 'already_imported',
        importId: duplicate.id,
        status: duplicate.status,
        message: 'Ce fichier a déjà été importé. Relancez avec confirmation pour réimporter.',
      });
    }
    if (duplicate && force) {
      await prisma.import.delete({ where: { id: duplicate.id } });
    }
    const importRow = await prisma.import.create({
      data: {
        userId: request.userId,
        source: 'tvtime',
        fileName: file.filename ?? 'export.zip',
        fileHash: hash,
        status: 'uploaded',
      },
    });
    await saveUpload(importRow.id, buffer);
    return { importId: importRow.id, fileName: importRow.fileName, sizeBytes: buffer.length };
  });

  app.post('/api/import/tvtime/:id/analyze', async (request, reply) => {
    const { id } = request.params as { id: string };
    const importRow = await prisma.import.findFirst({ where: { id, userId: request.userId } });
    if (!importRow) return reply.code(404).send({ error: 'not_found' });
    try {
      const summary = await analyzeImport(id);
      return { importId: id, status: 'analyzed', summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.import.update({
        where: { id },
        data: { status: 'failed', errorJson: toJson({ message }) },
      });
      return reply.code(422).send({ error: 'analysis_failed', message });
    }
  });

  app.post('/api/import/tvtime/:id/confirm', async (request, reply) => {
    const { id } = request.params as { id: string };
    const importRow = await prisma.import.findFirst({ where: { id, userId: request.userId } });
    if (!importRow) return reply.code(404).send({ error: 'not_found' });
    if (importRow.status !== 'analyzed' && importRow.status !== 'imported') {
      return reply.code(409).send({ error: 'not_analyzed' });
    }
    const result = await confirmImport(request.userId, id);
    return { importId: id, ...result };
  });

  app.get('/api/import/tvtime/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const importRow = await prisma.import.findFirst({
      where: { id, userId: request.userId },
      include: { mappings: { select: { matchStatus: true } } },
    });
    if (!importRow) return reply.code(404).send({ error: 'not_found' });
    // Auto-reprise : si l'import est « importing » sans job vivant (crash /
    // redémarrage serveur), le polling du statut le relance où il en était.
    if (importRow.status === 'importing') resumeStalledImport(request.userId, importRow.id);
    const counts = { matched_auto: 0, matched_manual: 0, unresolved: 0, ignored: 0 };
    for (const m of importRow.mappings) counts[m.matchStatus as keyof typeof counts]++;
    return {
      importId: importRow.id,
      fileName: importRow.fileName,
      status: importRow.status,
      summary: fromJson(importRow.summaryJson, null),
      errors: fromJson(importRow.errorJson, null),
      mappingCounts: counts,
      createdAt: importRow.createdAt.toISOString(),
    };
  });

  // Liste des imports (historique) — ceux de l'utilisateur uniquement.
  app.get('/api/import/tvtime', async (request) => {
    const imports = await prisma.import.findMany({
      where: { userId: request.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      imports: imports.map((i) => ({
        importId: i.id,
        fileName: i.fileName,
        status: i.status,
        createdAt: i.createdAt.toISOString(),
      })),
    };
  });

  app.get('/api/import/tvtime/:id/unresolved', async (request, reply) => {
    const { id } = request.params as { id: string };
    const importRow = await prisma.import.findFirst({ where: { id, userId: request.userId } });
    if (!importRow) return reply.code(404).send({ error: 'not_found' });
    const mappings = await prisma.importMapping.findMany({
      where: { importId: id, matchStatus: 'unresolved' },
      orderBy: { sourceTitle: 'asc' },
    });
    const items: UnresolvedMappingDto[] = mappings.map((m) => {
      const raw = fromJson<{
        normalized?: { year?: number; tvdbId?: string; tmdbId?: string; imdbId?: string };
        suggestions?: UnresolvedMappingDto['suggestions'];
      }>(m.rawJson, {});
      return {
        id: m.id,
        sourceTitle: m.sourceTitle,
        sourceType: m.sourceType,
        year: raw.normalized?.year ?? null,
        externalIds: {
          tvdbId: raw.normalized?.tvdbId,
          tmdbId: raw.normalized?.tmdbId,
          imdbId: raw.normalized?.imdbId,
        },
        matchScore: m.matchScore,
        matchStatus: m.matchStatus as UnresolvedMappingDto['matchStatus'],
        suggestions: raw.suggestions ?? [],
      };
    });
    return { items };
  });

  // Résolution manuelle : média existant, résultat TMDb, ou création manuelle.
  app.post('/api/import/tvtime/:id/resolve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        mappingId: z.string(),
        mediaId: z.string().optional(),
        tmdbId: z.string().optional(),
        create: z
          .object({
            title: z.string().min(1),
            year: z.number().int().optional(),
            type: z.enum(['show', 'movie']),
          })
          .optional(),
      })
      .parse(request.body);
    const mapping = await prisma.importMapping.findFirst({
      where: { id: body.mappingId, importId: id, import: { userId: request.userId } },
    });
    if (!mapping) return reply.code(404).send({ error: 'not_found' });

    const raw = fromJson<Record<string, unknown>>(mapping.rawJson, {});
    let matchedMediaId: string | undefined = body.mediaId;

    if (!matchedMediaId && body.tmdbId) {
      raw['decision'] = 'tmdb';
      raw['tmdbId'] = body.tmdbId;
    } else if (!matchedMediaId && body.create) {
      const media = await prisma.media.create({
        data: {
          type: body.create.type,
          title: body.create.title,
          year: body.create.year,
          sourcePriority: 'manual',
          ...(body.create.type === 'show' ? { show: { create: {} } } : { movie: { create: {} } }),
        },
      });
      matchedMediaId = media.id;
    } else if (!matchedMediaId && !body.tmdbId) {
      return reply.code(400).send({ error: 'no_resolution' });
    }

    await prisma.importMapping.update({
      where: { id: mapping.id },
      data: {
        matchStatus: 'matched_manual',
        matchedMediaId,
        matchScore: 100,
        rawJson: toJson(raw),
      },
    });

    // Si l'import est déjà confirmé, appliquer immédiatement.
    const importRow = await prisma.import.findFirst({ where: { id, userId: request.userId } });
    if (importRow?.status === 'imported') {
      await applyMapping(request.userId, id, mapping.id);
    }
    return { ok: true };
  });

  app.post('/api/import/tvtime/:id/ignore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { mappingId } = z.object({ mappingId: z.string() }).parse(request.body);
    const mapping = await prisma.importMapping.findFirst({
      where: { id: mappingId, importId: id, import: { userId: request.userId } },
    });
    if (!mapping) return reply.code(404).send({ error: 'not_found' });
    await prisma.importMapping.update({ where: { id: mappingId }, data: { matchStatus: 'ignored' } });
    return { ok: true };
  });

  app.get('/api/import/tvtime/:id/report', async (request, reply) => {
    const { id } = request.params as { id: string };
    const importRow = await prisma.import.findFirst({ where: { id, userId: request.userId } });
    if (!importRow) return reply.code(404).send({ error: 'not_found' });
    const mappings = await prisma.importMapping.findMany({
      where: { importId: id },
      select: {
        id: true,
        sourceTitle: true,
        sourceType: true,
        matchStatus: true,
        matchScore: true,
        matchedMediaId: true,
      },
      orderBy: { sourceTitle: 'asc' },
    });
    return {
      importId: id,
      status: importRow.status,
      summary: fromJson(importRow.summaryJson, null),
      errors: fromJson(importRow.errorJson, null),
      mappings,
    };
  });
}
