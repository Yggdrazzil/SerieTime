// Seed de démonstration : données réalistes pour vérifier visuellement l'UI.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const now = Date.now();
const day = 86_400_000;
const at = (offsetDays: number) => new Date(now + offsetDays * day);

async function createShow(opts: {
  title: string;
  network?: string;
  seasons: { n: number; episodes: { e: number; title: string; air: number }[] }[];
  status?: string;
}) {
  const media = await prisma.media.create({
    data: {
      type: 'show',
      title: opts.title,
      status: opts.status ?? 'Returning Series',
      runtime: 25,
      year: 2024,
      show: {
        create: {
          network: opts.network ?? 'Tokyo MX',
          platform: opts.network,
          numberOfSeasons: opts.seasons.length,
        },
      },
    },
    include: { show: true },
  });
  for (const season of opts.seasons) {
    const dbSeason = await prisma.season.create({
      data: {
        showId: media.show!.id,
        seasonNumber: season.n,
        title: `Saison ${season.n}`,
        episodeCount: season.episodes.length,
      },
    });
    for (const ep of season.episodes) {
      await prisma.episode.create({
        data: {
          showId: media.show!.id,
          seasonId: dbSeason.id,
          seasonNumber: season.n,
          episodeNumber: ep.e,
          title: ep.title,
          airDate: at(ep.air),
          airTime: '17:00',
          runtime: 25,
        },
      });
    }
  }
  return media;
}

async function main() {
  const existing = await prisma.user.findFirst();
  const user =
    existing ??
    (await prisma.user.create({
      data: {
        displayName: 'Etienne',
        email: 'etienne@serietime.local',
        provider: 'password',
        passwordHash: await bcrypt.hash('demo1234', 10),
        countryCode: 'FR',
      },
    }));

  const atelier = await createShow({
    title: "L'Atelier des sorciers",
    seasons: [{ n: 1, episodes: [...Array(13).keys()].map((i) => ({ e: i + 1, title: i === 12 ? 'Magie interdite' : `Épisode ${i + 1}`, air: -90 + i * 7 })) }],
  });
  const exiled = await createShow({
    title: 'The Exiled Heavy Knight Knows How to Win',
    seasons: [{ n: 1, episodes: [{ e: 1, title: 'Elymas le chevalier cuirasser', air: -1 }, { e: 2, title: 'Le départ', air: 6 }] }],
  });
  const silo = await createShow({
    title: 'Silo',
    network: 'APPLE TV',
    seasons: [
      { n: 3, episodes: [{ e: 1, title: 'Who Are You?', air: 1 }, { e: 2, title: 'The Engineer', air: 8 }] },
    ],
  });
  const mushoku = await createShow({
    title: 'Mushoku Tensei: Jobless Reincarnation',
    seasons: [
      { n: 0, episodes: [...Array(4).keys()].map((i) => ({ e: i + 1, title: `Spécial ${i + 1}`, air: -400 + i * 30 })) },
      { n: 1, episodes: [...Array(23).keys()].map((i) => ({ e: i + 1, title: i === 22 ? 'Howl, Mad Dog' : `Épisode ${i + 1}`, air: -380 + i * 7 })) },
      { n: 2, episodes: [...Array(24).keys()].map((i) => ({ e: i + 1, title: `Épisode ${i + 1}`, air: -200 + i * 7 })) },
      { n: 3, episodes: [...Array(14).keys()].map((i) => ({ e: i + 1, title: i === 1 ? 'Howl, Mad Dog' : `Épisode ${i + 1}`, air: -30 + i * 7 })) },
    ],
  });
  const acharnes = await createShow({
    title: 'Acharnés',
    network: 'NETFLIX',
    seasons: [{ n: 2, episodes: [...Array(8).keys()].map((i) => ({ e: i + 1, title: i === 3 ? 'Cet indicible réconfort' : `Épisode ${i + 1}`, air: -30 + i * 7 })) }],
  });
  const unchosen = await createShow({
    title: 'Unchosen',
    seasons: [{ n: 1, episodes: [...Array(6).keys()].map((i) => ({ e: i + 1, title: i === 5 ? 'Épisode 6' : `Épisode ${i + 1}`, air: -60 + i * 7 })) }],
  });
  const oldShow = await createShow({
    title: 'Dark',
    status: 'Ended',
    seasons: [{ n: 1, episodes: [...Array(10).keys()].map((i) => ({ e: i + 1, title: `Épisode ${i + 1}`, air: -900 + i * 7 })) }],
  });

  const setStatus = (mediaId: string, status: string, extra: object = {}) =>
    prisma.userMediaStatus.upsert({
      where: { userId_mediaId: { userId: user.id, mediaId } },
      create: { userId: user.id, mediaId, status, ...extra },
      update: { status, ...extra },
    });

  await setStatus(atelier.id, 'watching', { lastWatchedAt: at(-2), isFavorite: true });
  await setStatus(exiled.id, 'watching', { lastWatchedAt: at(-3) });
  await setStatus(silo.id, 'watching', { lastWatchedAt: at(-10) });
  await setStatus(mushoku.id, 'watching', { lastWatchedAt: at(-5) });
  await setStatus(acharnes.id, 'watching', { lastWatchedAt: at(-45) });
  await setStatus(unchosen.id, 'not_started');
  await setStatus(oldShow.id, 'abandoned');

  // Épisodes vus pour progression + stats
  const atelierEps = await prisma.episode.findMany({ where: { show: { mediaId: atelier.id }, episodeNumber: { lte: 12 } } });
  for (const ep of atelierEps) {
    await prisma.userEpisodeStatus.upsert({
      where: { userId_episodeId: { userId: user.id, episodeId: ep.id } },
      create: { userId: user.id, episodeId: ep.id, status: 'watched', watchedAt: at(-13 + ep.episodeNumber) },
      update: {},
    });
  }

  // Mushoku Tensei (cf PJ5) : saisons 1 & 2 terminées (barre verte), saison 3
  // en cours (barre jaune) et épisodes spéciaux non vus, en bas de la liste.
  const mushokuWatched = await prisma.episode.findMany({
    where: {
      show: { mediaId: mushoku.id },
      OR: [
        { seasonNumber: { in: [1, 2] } },
        { seasonNumber: 3, episodeNumber: 1 },
      ],
    },
  });
  for (const ep of mushokuWatched) {
    await prisma.userEpisodeStatus.upsert({
      where: { userId_episodeId: { userId: user.id, episodeId: ep.id } },
      create: { userId: user.id, episodeId: ep.id, status: 'watched', watchedAt: at(-40) },
      update: { status: 'watched', watchedAt: at(-40) },
    });
  }

  // Films
  const movieTitles: [string, number, string][] = [
    ['Scarlet', 2025, 'watchlist'],
    ['Reconnu coupable', 2025, 'watchlist'],
    ['Project Y', 2025, 'watchlist'],
    ['Mickey 17', 2025, 'completed'],
    ['A Normal Family', 2024, 'watchlist'],
    ['Mononoke le film', 2025, 'watchlist'],
    ['La Guerre des Rohirrim', 2024, 'completed'],
    ['Mistress Dispeller', 2024, 'watchlist'],
    ['Suzume', 2022, 'completed'],
  ];
  for (const [title, year, status] of movieTitles) {
    const media = await prisma.media.create({
      data: { type: 'movie', title, year, runtime: 120, releaseDate: new Date(`${year}-06-01`), movie: { create: {} } },
    });
    await setStatus(media.id, status, status === 'completed' ? { lastWatchedAt: at(-20), completedAt: at(-20), isFavorite: title === 'Suzume' } : {});
  }
  // Film à venir
  const upcomingMovie = await prisma.media.create({
    data: { type: 'movie', title: 'Scarlet 2', year: 2026, releaseDate: at(30), movie: { create: {} } },
  });
  await setStatus(upcomingMovie.id, 'watchlist');

  // Liste
  const list = await prisma.mediaList.create({ data: { userId: user.id, title: 'Best K-Dramas' } });
  await prisma.listItem.create({ data: { listId: list.id, mediaId: acharnes.id, position: 0 } });
  await prisma.listItem.create({ data: { listId: list.id, mediaId: silo.id, position: 1 } });

  await prisma.notification.create({
    data: { userId: user.id, type: 'new_episode', title: "Le dernier épisode de Silo est disponible", date: new Date() },
  });

  console.log('Seed OK — utilisateur: Etienne / demo1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
