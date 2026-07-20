import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { fromJson, toJson } from '../../utils/json.js';
import { getUserLang, invalidateUserLang } from '../media/userLang.js';
import { invalidateAdultContent } from './adultContent.js';
import { backfillUserTranslations } from '../../services/tmdb/index.js';

// Langues de contenu proposées (titres/résumés des séries et films).
const CONTENT_LANGUAGES = ['fr', 'en', 'es', 'de', 'it', 'pt'] as const;

const DEFAULT_SETTINGS = {
  titlesInUserLanguage: true,
  commentLanguages: ['fr', 'en'],
  notifications: { newEpisode: true, newMovie: true, importDone: true },
  theme: 'light' as 'system' | 'light' | 'dark' | 'sunset' | 'midnight' | 'glass',
  autoplayTrailers: false,
  upcoming: { hideWatched: false, channels: [] as string[] },
  subscriptions: [] as string[],
  appLock: false,
  // Contenu 18+ (porno/hentai) dans les suggestions. Désactivé par défaut.
  allowAdultContent: false,
};

export type AppSettings = typeof DEFAULT_SETTINGS;

// Schéma fermé aux clés réellement utilisées (le mobile n'envoie que des
// sous-ensembles de celles-ci). Les clés inconnues sont ignorées (strip) plutôt
// que rejetées, pour ne rien casser côté client. `language` est traité à part
// (il vit dans User.language) et n'apparaît donc pas ici.
const SETTINGS_SCHEMA = z
  .object({
    titlesInUserLanguage: z.boolean(),
    commentLanguages: z.array(z.string()),
    notifications: z
      .object({ newEpisode: z.boolean(), newMovie: z.boolean(), importDone: z.boolean() })
      .partial(),
    // `midnight` manquait depuis l'ajout du thème Nuit : la copie serveur du
    // thème échouait silencieusement (validation) pour ce choix.
    theme: z.enum(['system', 'light', 'dark', 'sunset', 'midnight', 'glass']),
    autoplayTrailers: z.boolean(),
    upcoming: z.object({ hideWatched: z.boolean(), channels: z.array(z.string()) }).partial(),
    subscriptions: z.array(z.string()),
    appLock: z.boolean(),
    allowAdultContent: z.boolean(),
  })
  .partial();

// Réglages d'UN utilisateur : lus depuis sa ligne UserSetting, fusionnés avec
// les valeurs par défaut. Un utilisateur sans ligne (nouveau compte) retombe
// sur les défauts ; les comptes existants ont été migrés au boot (backfill).
export async function getSettings(userId: string): Promise<AppSettings> {
  const row = await prisma.userSetting.findUnique({ where: { userId } });
  return { ...DEFAULT_SETTINGS, ...fromJson<Partial<AppSettings>>(row?.dataJson, {}) };
}

// Migration au boot (fire-and-forget, comme backfillAllUsers) : recopie les
// réglages jadis GLOBAUX (AppSetting key='app', partagés par tous) vers la
// ligne UserSetting de chaque compte qui n'en a pas encore. Personne ne voit
// donc ses réglages changer. Sans AppSetting global, il n'y a rien à propager
// (les comptes retomberont sur les valeurs par défaut).
export async function backfillUserSettings(): Promise<void> {
  const global = await prisma.appSetting.findUnique({ where: { key: 'app' } });
  if (!global) return;
  const users = await prisma.user.findMany({ where: { setting: null }, select: { id: true } });
  for (const user of users) {
    await prisma.userSetting
      .create({ data: { userId: user.id, dataJson: global.valueJson } })
      .catch(() => undefined);
  }
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/settings', async (request) => {
    // `language` vient de User.language ; le reste des réglages est PAR
    // UTILISATEUR (UserSetting) — même forme de réponse qu'auparavant.
    const language = await getUserLang(request.userId);
    return { settings: { ...(await getSettings(request.userId)), language } };
  });

  app.post('/api/settings', async (request) => {
    const body = z.record(z.unknown()).parse(request.body);

    // Langue de contenu : mise à jour de User.language + backfill EN FOND des
    // traductions de la bibliothèque (réponse immédiate, `started: true`).
    let translationsStarted = false;
    let language: string | undefined;
    if (body.language !== undefined) {
      language = z.enum(CONTENT_LANGUAGES).parse(body.language);
      delete body.language; // par utilisateur — ne va pas dans UserSetting
      await prisma.user.update({ where: { id: request.userId }, data: { language } });
      invalidateUserLang(request.userId);
      if (language !== 'fr') {
        translationsStarted = true;
        void backfillUserTranslations(request.userId, language).catch(() => undefined);
      }
    }

    // Ne conserve que les clés connues (les inconnues sont ignorées).
    const patch = SETTINGS_SCHEMA.parse(body);
    const current = await getSettings(request.userId);
    const next = { ...current, ...patch };
    if (Object.keys(patch).length > 0) {
      await prisma.userSetting.upsert({
        where: { userId: request.userId },
        create: { userId: request.userId, dataJson: toJson(next) },
        update: { dataJson: toJson(next) },
      });
      // Invalide le cache de l'interrupteur 18+ (lu par feed/discover/search/games).
      if ('allowAdultContent' in patch) invalidateAdultContent(request.userId);
    }
    return {
      settings: { ...next, language: language ?? (await getUserLang(request.userId)) },
      ...(translationsStarted ? { started: true } : {}),
    };
  });

  app.post('/api/cache/clear', async () => {
    const { count } = await prisma.apiCache.deleteMany({});
    return { ok: true, cleared: count };
  });

  app.get('/api/notifications', async (request) => {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: request.userId },
        orderBy: { date: 'desc' },
        take: 100,
      }),
      prisma.notification.count({ where: { userId: request.userId, isRead: false } }),
    ]);
    return {
      unreadCount,
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        imageUrl: n.imageUrl,
        date: n.date.toISOString(),
        isRead: n.isRead,
        meta: n.metadataJson ? (JSON.parse(n.metadataJson) as Record<string, string>) : {},
      })),
    };
  });

  app.get('/api/notifications/unread-count', async (request) => {
    const unreadCount = await prisma.notification.count({
      where: { userId: request.userId, isRead: false },
    });
    return { unreadCount };
  });

  app.post('/api/notifications/:id/read', async (request) => {
    const { id } = request.params as { id: string };
    await prisma.notification.updateMany({
      where: { id, userId: request.userId },
      data: { isRead: true },
    });
    return { ok: true };
  });

  // Marque toutes les notifications comme lues.
  app.post('/api/notifications/read', async (request) => {
    await prisma.notification.updateMany({
      where: { userId: request.userId, isRead: false },
      data: { isRead: true },
    });
    return { ok: true };
  });
}
