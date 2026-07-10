import { prisma } from '../../db/client.js';

export type SocialStats = { likes: number; watched: number; comments: number };
export type SocialMe = { liked: boolean; watched: boolean };

// Agrège, par média (matché sur tmdbId + type), les signaux sociaux de TOUTE
// l'app : likes = watchlist, watched = completed, comments = nombre de commentaires.
// `me` = l'état de l'utilisateur courant. Les cartes sans média local → zéros.
export async function attachSocialStats<
  T extends { tmdbId: string | null; type: 'show' | 'movie' },
>(items: T[], userId: string): Promise<(T & { stats: SocialStats; me: SocialMe })[]> {
  const zero = (it: T) => ({ ...it, stats: { likes: 0, watched: 0, comments: 0 }, me: { liked: false, watched: false } });

  const tmdbIds = [...new Set(items.map((i) => i.tmdbId).filter((v): v is string => Boolean(v)))];
  if (tmdbIds.length === 0) return items.map(zero);

  const medias = await prisma.media.findMany({
    where: { tmdbId: { in: tmdbIds } },
    select: { id: true, tmdbId: true, type: true },
  });
  // Clé tmdb:type → mediaId (une œuvre peut exister en show ET movie sous le même tmdbId).
  const keyOf = (tmdbId: string, type: string) => `${type}:${tmdbId}`;
  const mediaIdByKey = new Map<string, string>();
  for (const m of medias) if (m.tmdbId) mediaIdByKey.set(keyOf(m.tmdbId, m.type), m.id);
  const mediaIds = medias.map((m) => m.id);
  if (mediaIds.length === 0) return items.map(zero);

  const [likeRows, watchedRows, commentRows, mine] = await Promise.all([
    prisma.userMediaStatus.groupBy({
      by: ['mediaId'],
      where: { mediaId: { in: mediaIds }, status: 'watchlist', isHidden: false },
      _count: { _all: true },
    }),
    prisma.userMediaStatus.groupBy({
      by: ['mediaId'],
      where: { mediaId: { in: mediaIds }, status: 'completed', isHidden: false },
      _count: { _all: true },
    }),
    prisma.comment.groupBy({
      by: ['mediaId'],
      where: { mediaId: { in: mediaIds } },
      _count: { _all: true },
    }),
    prisma.userMediaStatus.findMany({
      where: { userId, mediaId: { in: mediaIds } },
      select: { mediaId: true, status: true },
    }),
  ]);

  const likeBy = new Map(likeRows.map((r) => [r.mediaId, r._count._all]));
  const watchedBy = new Map(watchedRows.map((r) => [r.mediaId, r._count._all]));
  const commentBy = new Map(commentRows.map((r) => [r.mediaId, r._count._all]));
  const myStatus = new Map(mine.map((r) => [r.mediaId, r.status]));

  return items.map((it) => {
    if (!it.tmdbId) return zero(it);
    const mediaId = mediaIdByKey.get(keyOf(it.tmdbId, it.type));
    if (!mediaId) return zero(it);
    const st = myStatus.get(mediaId);
    return {
      ...it,
      stats: {
        likes: likeBy.get(mediaId) ?? 0,
        watched: watchedBy.get(mediaId) ?? 0,
        comments: commentBy.get(mediaId) ?? 0,
      },
      me: { liked: st === 'watchlist', watched: st === 'completed' },
    };
  });
}
