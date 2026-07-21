import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Ordres d'épisodes alternatifs à sélection automatique (cas réel : American
// Dad, numérotation Disney+ « alternate » chez TheTVDB ≠ ordre de diffusion).
// Principe intangible : mêmes lignes Episode en base — seule la (saison,
// numéro) émise change via EpisodeAltNumber ; watched par episodeId inchangé.
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-orders-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'orders.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TVMAZE_ENABLED = 'false';
// TheTVDB « activé » avec une clé factice : tous les appels réseau sont mockés.
process.env.TVDB_ENABLED = 'true';
process.env.TVDB_API_KEY = 'test-key';

let app: FastifyInstance;
let prismaClient: (typeof import('../db/client.js'))['prisma'];
let tokenA = '';
let tokenB = '';

// Série 1 (73141) : 3 saisons officielles, ordre alternate en 2 saisons.
let s1 = '';
let s1ShowId = '';
const eps: Record<string, string> = {}; // 'S1E1' -> episodeId local

// Série 2 (141414) : alternate au MÊME nombre de saisons → heuristique négative.
let s2 = '';
// Série 3 : sans tvdbId.
let s3 = '';
// Série 4 (500500) : TheTVDB en échec (HTTP 500).
let s4 = '';

const authA = () => ({ authorization: `Bearer ${tokenA}` });
const authB = () => ({ authorization: `Bearer ${tokenB}` });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Fixtures TheTVDB v4. Correspondance officielle → alternate :
// S1E1(101)→A1E1, S1E2(102)→A1E2, S2E1(103)→A1E3, S2E2(104)→A2E1,
// S3E1(105)→A2E2 (via repli (S,E) officiel : l'épisode local n'a pas de
// tvdbId), S3E2(106) ABSENT de l'ordre alternate → numéros officiels conservés.
function tvdbMock(url: string): Response | null {
  if (!url.includes('api4.thetvdb.com')) return null;
  if (url.endsWith('/v4/login')) return json({ data: { token: 'test-token' } });
  if (url.includes('/v4/series/73141/extended')) {
    return json({
      data: {
        id: 73141,
        name: 'American Dad!',
        seasons: [
          { number: 0, type: { type: 'official', name: 'Aired Order' } },
          { number: 1, type: { type: 'official', name: 'Aired Order' } },
          { number: 2, type: { type: 'official', name: 'Aired Order' } },
          { number: 3, type: { type: 'official', name: 'Aired Order' } },
          { number: 1, type: { type: 'alternate', name: 'Alternate Order' } },
          { number: 2, type: { type: 'alternate', name: 'Alternate Order' } },
          { number: 1, type: { type: 'dvd', name: 'DVD Order' } },
          { number: 2, type: { type: 'dvd', name: 'DVD Order' } },
          { number: 3, type: { type: 'dvd', name: 'DVD Order' } },
        ],
      },
    });
  }
  if (url.includes('/v4/series/73141/episodes/alternate')) {
    return json({
      data: {
        episodes: [
          { id: 101, seasonNumber: 1, number: 1 },
          { id: 102, seasonNumber: 1, number: 2 },
          { id: 103, seasonNumber: 1, number: 3 },
          { id: 104, seasonNumber: 2, number: 1 },
          { id: 105, seasonNumber: 2, number: 2 },
        ],
      },
      links: { next: null },
    });
  }
  if (url.includes('/v4/series/73141/episodes/official')) {
    return json({
      data: {
        episodes: [
          { id: 101, seasonNumber: 1, number: 1 },
          { id: 102, seasonNumber: 1, number: 2 },
          { id: 103, seasonNumber: 2, number: 1 },
          { id: 104, seasonNumber: 2, number: 2 },
          { id: 105, seasonNumber: 3, number: 1 },
          { id: 106, seasonNumber: 3, number: 2 },
        ],
      },
      links: { next: null },
    });
  }
  if (url.includes('/v4/series/141414/extended')) {
    return json({
      data: {
        id: 141414,
        name: 'Même découpage',
        seasons: [
          { number: 1, type: { type: 'official', name: 'Aired Order' } },
          { number: 2, type: { type: 'official', name: 'Aired Order' } },
          { number: 1, type: { type: 'alternate', name: 'Alternate Order' } },
          { number: 2, type: { type: 'alternate', name: 'Alternate Order' } },
        ],
      },
    });
  }
  if (url.includes('/v4/series/500500/')) return json({ message: 'boom' }, 500);
  return json({ message: 'not found' }, 404);
}

async function createShow(opts: {
  title: string;
  tvdbId?: string;
  streaming?: boolean;
  episodes: { s: number; e: number; tvdbId?: string; aired: string }[];
}): Promise<{ mediaId: string; showId: string; byKey: Record<string, string> }> {
  const media = await prismaClient.media.create({
    data: {
      type: 'show',
      title: opts.title,
      status: 'Ended', // évite les resyncs de fond (refreshStaleContinuingShows)
      tvdbId: opts.tvdbId,
      sourcePriority: opts.tvdbId ? 'tvdb' : undefined,
      lastSyncedAt: new Date(), // fiche servie sans tentative de refresh
      show: { create: {} },
    },
    include: { show: true },
  });
  const showId = media.show!.id;
  const seasonNumbers = [...new Set(opts.episodes.map((ep) => ep.s))];
  for (const seasonNumber of seasonNumbers) {
    await prismaClient.season.create({ data: { showId, seasonNumber, title: `Saison ${seasonNumber}` } });
  }
  const byKey: Record<string, string> = {};
  for (const ep of opts.episodes) {
    const row = await prismaClient.episode.create({
      data: {
        showId,
        seasonNumber: ep.s,
        episodeNumber: ep.e,
        title: `S${ep.s}E${ep.e}`,
        airDate: new Date(ep.aired),
        tvdbId: ep.tvdbId,
      },
    });
    byKey[`S${ep.s}E${ep.e}`] = row.id;
  }
  if (opts.streaming) {
    await prismaClient.provider.create({
      data: {
        mediaId: media.id,
        countryCode: 'FR',
        providerName: 'Disney Plus',
        offerType: 'flatrate',
        source: 'tmdb',
        fetchedAt: new Date(),
      },
    });
  }
  return { mediaId: media.id, showId, byKey };
}

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
  const { buildApp } = await import('../app.js');
  app = await buildApp();
  const { prisma } = await import('../db/client.js');
  prismaClient = prisma;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const mocked = tvdbMock(String(url));
      if (mocked) return mocked;
      throw new Error(`fetch inattendu en test : ${String(url)}`);
    }),
  );

  const resA = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName: 'Alice Ordres', email: 'orders-a@example.com', password: 'secret123' },
  });
  tokenA = resA.json().token;
  const resB = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName: 'Bob Ordres', email: 'orders-b@example.com', password: 'secret123' },
  });
  tokenB = resB.json().token;

  const show1 = await createShow({
    title: 'American Dad!',
    tvdbId: '73141',
    streaming: true,
    episodes: [
      { s: 1, e: 1, tvdbId: '101', aired: '2020-01-01' },
      { s: 1, e: 2, tvdbId: '102', aired: '2020-01-08' },
      { s: 2, e: 1, tvdbId: '103', aired: '2020-02-01' },
      { s: 2, e: 2, tvdbId: '104', aired: '2020-02-08' },
      { s: 3, e: 1, aired: '2020-03-01' }, // sans tvdbId → repli (S,E) officiel
      { s: 3, e: 2, tvdbId: '106', aired: '2020-03-08' }, // absent de l'ordre alternate
    ],
  });
  s1 = show1.mediaId;
  s1ShowId = show1.showId;
  Object.assign(eps, show1.byKey);

  s2 = (
    await createShow({
      title: 'Même découpage',
      tvdbId: '141414',
      streaming: true,
      episodes: [
        { s: 1, e: 1, tvdbId: '201', aired: '2021-01-01' },
        { s: 2, e: 1, tvdbId: '202', aired: '2021-02-01' },
      ],
    })
  ).mediaId;

  s3 = (
    await createShow({
      title: 'Locale sans TVDB',
      episodes: [{ s: 1, e: 1, aired: '2022-01-01' }],
    })
  ).mediaId;

  s4 = (
    await createShow({
      title: 'TVDB en panne',
      tvdbId: '500500',
      streaming: true,
      episodes: [{ s: 1, e: 1, tvdbId: '501', aired: '2022-01-01' }],
    })
  ).mediaId;
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await app?.close();
});

describe('ordres d’épisodes alternatifs — sélection automatique', () => {
  it('résout AUTO le défaut « alternate » (provider streaming + découpage différent) au premier GET de la fiche', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/shows/${s1}`, headers: authA() });
    expect(res.statusCode).toBe(200);
    expect(res.json().episodeOrder).toEqual({ effective: 'alternate', source: 'auto' });

    const show = await prismaClient.show.findUniqueOrThrow({ where: { id: s1ShowId } });
    expect(show.defaultEpisodeOrder).toBe('alternate');
    expect(show.episodeOrderCheckedAt).not.toBeNull();
    // 5 correspondances (l'épisode 106 n'existe pas dans l'ordre alternate).
    expect(await prismaClient.episodeAltNumber.count({ where: { showId: s1ShowId, orderType: 'alternate' } })).toBe(5);
  });

  it('liste les ordres disponibles avec libellés FR et nombre de saisons', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/shows/${s1}/orders`, headers: authA() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available).toEqual(
      expect.arrayContaining([
        { type: 'official', label: 'Diffusion', seasons: 3 },
        { type: 'alternate', label: 'Streaming', seasons: 2 },
        { type: 'dvd', label: 'DVD', seasons: 3 },
      ]),
    );
    expect(body.effective).toBe('alternate');
    expect(body.source).toBe('auto');
    expect(body.current).toBeNull();
  });

  it('regroupe la fiche en numérotation alternate pour TOUT utilisateur sans override', async () => {
    // Utilisateur B, jamais passé par la fiche : le défaut résolu est partagé.
    const res = await app.inject({ method: 'GET', url: `/api/shows/${s1}/episodes`, headers: authB() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.episodeOrder).toEqual({ effective: 'alternate', source: 'auto' });

    const all = body.seasons.flatMap((s: { episodes: { id: string; seasonNumber: number; episodeNumber: number }[] }) => s.episodes);
    const find = (id: string | undefined) => all.find((e: { id: string }) => e.id === id);
    // Officiel S2E1 → alternate S1E3.
    expect(find(eps.S2E1)).toMatchObject({ seasonNumber: 1, episodeNumber: 3 });
    // Officiel S3E1 (épisode local SANS tvdbId) → apparié via l'ordre officiel TheTVDB → alternate S2E2.
    expect(find(eps.S3E1)).toMatchObject({ seasonNumber: 2, episodeNumber: 2 });
    // La saison alternate 1 regroupe 3 épisodes.
    const season1 = body.seasons.find((s: { seasonNumber: number }) => s.seasonNumber === 1);
    expect(season1.episodes).toHaveLength(3);
  });

  it('conserve les numéros officiels pour un épisode sans correspondance', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/shows/${s1}/episodes`, headers: authB() });
    const all = res.json().seasons.flatMap((s: { episodes: { id: string }[] }) => s.episodes);
    expect(all.find((e: { id: string }) => e.id === eps.S3E2)).toMatchObject({ seasonNumber: 3, episodeNumber: 2 });
  });

  it('heuristique NÉGATIVE : alternate au même nombre de saisons → la série reste en officiel', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/shows/${s2}`, headers: authA() });
    expect(res.statusCode).toBe(200);
    expect(res.json().episodeOrder).toEqual({ effective: 'official', source: 'official' });
    const show = await prismaClient.show.findFirstOrThrow({ where: { mediaId: s2 } });
    expect(show.defaultEpisodeOrder).toBeNull();
    expect(show.episodeOrderCheckedAt).not.toBeNull(); // résultat (null) marqué : pas de re-vérification
  });

  it('override utilisateur « official » : cet utilisateur revoit l’ordre de diffusion, l’autre garde alternate', async () => {
    const post = await app.inject({
      method: 'POST',
      url: `/api/shows/${s1}/order`,
      headers: authA(),
      payload: { order: 'official' },
    });
    expect(post.statusCode).toBe(200);
    expect(post.json()).toEqual({ ok: true, effective: 'official' });

    const resA = await app.inject({ method: 'GET', url: `/api/shows/${s1}/episodes`, headers: authA() });
    expect(resA.json().episodeOrder).toEqual({ effective: 'official', source: 'user' });
    const allA = resA.json().seasons.flatMap((s: { episodes: { id: string }[] }) => s.episodes);
    expect(allA.find((e: { id: string }) => e.id === eps.S2E1)).toMatchObject({ seasonNumber: 2, episodeNumber: 1 });

    // Isolation : B (sans override) reste en alternate.
    const resB = await app.inject({ method: 'GET', url: `/api/shows/${s1}/episodes`, headers: authB() });
    expect(resB.json().episodeOrder).toEqual({ effective: 'alternate', source: 'auto' });
    const allB = resB.json().seasons.flatMap((s: { episodes: { id: string }[] }) => s.episodes);
    expect(allB.find((e: { id: string }) => e.id === eps.S2E1)).toMatchObject({ seasonNumber: 1, episodeNumber: 3 });
  });

  it('remappe la file « À voir » (nextEpisode) selon l’ordre effectif', async () => {
    // B coche les 3 premiers épisodes de l'ordre alternate (par episodeId :
    // les écritures ignorent totalement la numérotation).
    for (const [key, at] of [
      ['S1E1', '2026-07-01T20:00:00.000Z'],
      ['S1E2', '2026-07-02T20:00:00.000Z'],
      ['S2E1', '2026-07-03T20:00:00.000Z'],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/episodes/${eps[key]}/watched`,
        headers: authB(),
        payload: { watchedAt: at },
      });
      expect(res.statusCode).toBe(200);
    }
    const res = await app.inject({ method: 'GET', url: '/api/shows/queue', headers: authB() });
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((i: { media: { id: string } }) => i.media.id === s1);
    expect(item).toBeTruthy();
    // Prochain épisode = officiel S2E2, affiché en alternate S2E1.
    expect(item.nextEpisode.id).toBe(eps.S2E2);
    expect(item.nextEpisode.seasonNumber).toBe(2);
    expect(item.nextEpisode.episodeNumber).toBe(1);
  });

  it('remappe l’historique de visionnage', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/shows/history', headers: authB() });
    expect(res.statusCode).toBe(200);
    const first = res.json().items[0];
    // Dernier coché : officiel S2E1 → alternate S1E3.
    expect(first.episode.id).toBe(eps.S2E1);
    expect(first.episode.seasonNumber).toBe(1);
    expect(first.episode.episodeNumber).toBe(3);
  });

  it('série sans tvdbId : aucun ordre disponible, override refusé', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/shows/${s3}/orders`, headers: authA() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: [], effective: 'official', source: 'official', current: null });

    const post = await app.inject({
      method: 'POST',
      url: `/api/shows/${s3}/order`,
      headers: authA(),
      payload: { order: 'alternate' },
    });
    expect(post.statusCode).toBe(422);
    expect(post.json().error).toBe('order_unavailable');
  });

  it('échec TheTVDB : la fiche est servie normalement en officiel (et l’heuristique resservira)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/shows/${s4}`, headers: authA() });
    expect(res.statusCode).toBe(200);
    expect(res.json().episodeOrder).toEqual({ effective: 'official', source: 'official' });
    // Échec ≠ résultat : rien n'est marqué, nouvel essai au prochain affichage.
    const show = await prismaClient.show.findFirstOrThrow({ where: { mediaId: s4 } });
    expect(show.episodeOrderCheckedAt).toBeNull();
  });

  it('POST order null : retour au défaut AUTO de la série', async () => {
    const post = await app.inject({
      method: 'POST',
      url: `/api/shows/${s1}/order`,
      headers: authA(),
      payload: { order: null },
    });
    expect(post.statusCode).toBe(200);
    expect(post.json()).toEqual({ ok: true, effective: 'alternate' });
    const res = await app.inject({ method: 'GET', url: `/api/shows/${s1}/orders`, headers: authA() });
    expect(res.json()).toMatchObject({ effective: 'alternate', source: 'auto', current: null });
  });

  it('« tout marquer » d’une saison AFFICHÉE en alternate coche les bons épisodes réels', async () => {
    // B marque la saison alternate 2 (= officiel S2E2 + S3E1, PAS S3E2 non mappé... si, S3E2
    // reste affiché sous sa saison officielle 3). Saison affichée 2 = {S2E2, S3E1}.
    const res = await app.inject({
      method: 'POST',
      url: `/api/shows/${s1}/mark-all-watched`,
      headers: authB(),
      payload: { seasonNumber: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(2);
    const watched = await prismaClient.userEpisodeStatus.findMany({
      where: { episodeId: { in: [eps.S2E2!, eps.S3E1!, eps.S3E2!] }, status: 'watched' },
      select: { episodeId: true },
    });
    const ids = watched.map((w) => w.episodeId).sort();
    expect(ids).toContain(eps.S2E2);
    expect(ids).toContain(eps.S3E1);
    expect(ids).not.toContain(eps.S3E2);
  });
});
