import { prisma } from '../../db/client.js';

type NotifPayload = {
  type: string;
  title: string;
  body?: string | null;
  imageUrl?: string | null;
  mediaId?: string;
  commentId?: string;
};

export type NotificationMediaType = 'show' | 'movie' | 'game';

export function notificationMediaType(type: string | null | undefined): NotificationMediaType | undefined {
  if (type === 'show' || type === 'movie' || type === 'game') return type;
  return undefined;
}

// Type du média concerné (pour que l'app ouvre la bonne fiche).
async function mediaTypeOf(mediaId?: string): Promise<NotificationMediaType | undefined> {
  if (!mediaId) return undefined;
  const m = await prisma.media.findUnique({ where: { id: mediaId }, select: { type: true } });
  return notificationMediaType(m?.type);
}

function meta(actorId: string, p: NotifPayload, mediaType?: NotificationMediaType): string {
  return JSON.stringify({ actorId, mediaId: p.mediaId, mediaType, commentId: p.commentId });
}

// Notifie un utilisateur précis (jamais soi-même, jamais quelqu'un qui a
// bloqué l'acteur — le blocage doit couper TOUT signal du bloqué, sinon il
// suffit de réagir/répondre pour continuer à pinger la personne).
export async function notifyUser(recipientId: string, actorId: string, p: NotifPayload): Promise<void> {
  if (recipientId === actorId) return;
  const blocked = await prisma.block.findUnique({
    where: { blockerId_blockedId: { blockerId: recipientId, blockedId: actorId } },
    select: { id: true },
  });
  if (blocked) return;
  await prisma.notification.create({
    data: {
      userId: recipientId,
      type: p.type,
      title: p.title,
      body: p.body ?? undefined,
      imageUrl: p.imageUrl ?? undefined,
      date: new Date(),
      metadataJson: meta(actorId, p, await mediaTypeOf(p.mediaId)),
    },
  });
}

// Notifie tous les abonnés d'un utilisateur (activité).
export async function notifyFollowers(actorId: string, p: NotifPayload): Promise<void> {
  const followers = await prisma.follow.findMany({
    where: { followingId: actorId },
    select: { followerId: true },
  });
  if (followers.length === 0) return;
  const now = new Date();
  const mediaType = await mediaTypeOf(p.mediaId);
  await prisma.notification.createMany({
    data: followers.map((f) => ({
      userId: f.followerId,
      type: p.type,
      title: p.title,
      body: p.body ?? undefined,
      imageUrl: p.imageUrl ?? undefined,
      date: now,
      metadataJson: meta(actorId, p, mediaType),
    })),
  });
}
