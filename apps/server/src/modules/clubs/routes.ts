import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { requireAuth } from '../auth/routes.js';
import { mediaTitle } from '../media/serialize.js';
import { getUserLang } from '../media/userLang.js';
import { blockedIdSet } from '../social/blocks.js';
import { followingIdSet } from '../social/routes.js';

// Clubs par série (v1) : un club par média, créé à la volée par le premier
// membre. Pas de rôles ni de fil dédié pour l'instant — juste l'adhésion et
// la présence de mes abonnements (« Tes amis en sont »).

type FriendMember = { userId: string; displayName: string; avatarUrl: string | null };

type ClubForDto = {
  id: string;
  media: { id: string; title: string; localizedTitle: string | null; translationsJson: string | null; posterPath: string | null; type: string };
};

// Abonnements membres des clubs demandés (blocklist déjà exclue de friendIds),
// en UNE requête ClubMember pour tous les clubs — max 3 listés par club.
async function friendMembersByClub(clubIds: string[], friendIds: string[]): Promise<Map<string, FriendMember[]>> {
  const map = new Map<string, FriendMember[]>();
  if (clubIds.length === 0 || friendIds.length === 0) return map;
  const rows = await prisma.clubMember.findMany({
    where: { clubId: { in: clubIds }, userId: { in: friendIds } },
    include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  for (const r of rows) {
    const arr = map.get(r.clubId) ?? [];
    if (arr.length < 3) arr.push({ userId: r.userId, displayName: r.user.displayName, avatarUrl: r.user.avatarUrl });
    map.set(r.clubId, arr);
  }
  return map;
}

function clubDto(
  club: ClubForDto,
  memberCount: number,
  friendMembers: FriendMember[],
  isMember: boolean,
  lang: string,
) {
  return {
    id: club.id,
    media: {
      id: club.media.id,
      title: mediaTitle(club.media, lang),
      posterPath: club.media.posterPath,
      type: club.media.type,
    },
    memberCount,
    friendMembers,
    isMember,
  };
}

// Abonnements moins les bloqués : la blocklist ne doit jamais apparaître
// dans « tes amis en sont » ni influencer les suggestions.
async function friendIdList(userId: string): Promise<string[]> {
  const [followingIds, blockedIds] = await Promise.all([followingIdSet(userId), blockedIdSet(userId)]);
  return [...followingIds].filter((id) => !blockedIds.has(id));
}

export async function clubsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // Crée le club du média s'il n'existe pas et m'y ajoute (idempotent).
  app.post('/api/clubs', async (request, reply) => {
    const { mediaId } = z.object({ mediaId: z.string().min(1) }).parse(request.body);
    const media = await prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) return reply.code(404).send({ error: 'not_found' });
    const club = await prisma.club.upsert({
      where: { mediaId },
      create: { mediaId, createdById: request.userId },
      update: {},
    });
    await prisma.clubMember.upsert({
      where: { clubId_userId: { clubId: club.id, userId: request.userId } },
      create: { clubId: club.id, userId: request.userId },
      update: {},
    });
    const [lang, friendIds, memberCount] = await Promise.all([
      getUserLang(request.userId),
      friendIdList(request.userId),
      prisma.clubMember.count({ where: { clubId: club.id } }),
    ]);
    const friends = await friendMembersByClub([club.id], friendIds);
    return clubDto({ id: club.id, media }, memberCount, friends.get(club.id) ?? [], true, lang);
  });

  app.post('/api/clubs/:id/join', async (request, reply) => {
    const { id } = request.params as { id: string };
    const club = await prisma.club.findUnique({ where: { id }, select: { id: true } });
    if (!club) return reply.code(404).send({ error: 'not_found' });
    await prisma.clubMember.upsert({
      where: { clubId_userId: { clubId: id, userId: request.userId } },
      create: { clubId: id, userId: request.userId },
      update: {},
    });
    const memberCount = await prisma.clubMember.count({ where: { clubId: id } });
    return { ok: true, memberCount };
  });

  app.post('/api/clubs/:id/leave', async (request, reply) => {
    const { id } = request.params as { id: string };
    const club = await prisma.club.findUnique({ where: { id }, select: { id: true } });
    if (!club) return reply.code(404).send({ error: 'not_found' });
    // Idempotent : quitter un club dont on n'est pas membre renvoie aussi ok.
    await prisma.clubMember.deleteMany({ where: { clubId: id, userId: request.userId } });
    const memberCount = await prisma.clubMember.count({ where: { clubId: id } });
    return { ok: true, memberCount };
  });

  // Mes clubs + suggestions : clubs existants dont je ne suis pas membre ET
  // (média dans ma bibliothèque OU un abonnement en est membre).
  app.get('/api/clubs', async (request) => {
    const me = request.userId;
    const [lang, friendIds] = await Promise.all([getUserLang(me), friendIdList(me)]);

    const myMemberships = await prisma.clubMember.findMany({
      where: { userId: me },
      include: { club: { include: { media: true, _count: { select: { members: true } } } } },
      orderBy: { joinedAt: 'desc' },
    });
    const myClubIds = myMemberships.map((m) => m.clubId);

    const friendMemberships = friendIds.length
      ? await prisma.clubMember.findMany({ where: { userId: { in: friendIds } }, select: { clubId: true } })
      : ([] as { clubId: string }[]);
    // « Média dans ma bibliothèque » en filtre RELATIONNEL (EXISTS côté SQL) :
    // l'ancien `mediaId IN (...)` matérialisait TOUTE la bibliothèque (20k ids)
    // dans la requête à chaque GET /api/clubs.
    const suggested = await prisma.club.findMany({
      where: {
        id: { notIn: myClubIds },
        OR: [
          { media: { statuses: { some: { userId: me } } } },
          { id: { in: [...new Set(friendMemberships.map((m) => m.clubId))] } },
        ],
      },
      include: { media: true, _count: { select: { members: true } } },
      orderBy: { members: { _count: 'desc' } },
      take: 10,
    });

    // Amis membres de tous les clubs listés, en une requête.
    const friendsByClub = await friendMembersByClub([...myClubIds, ...suggested.map((c) => c.id)], friendIds);
    return {
      mine: myMemberships.map((m) =>
        clubDto(m.club, m.club._count.members, friendsByClub.get(m.clubId) ?? [], true, lang),
      ),
      suggested: suggested.map((c) =>
        clubDto(c, c._count.members, friendsByClub.get(c.id) ?? [], false, lang),
      ),
    };
  });
}
