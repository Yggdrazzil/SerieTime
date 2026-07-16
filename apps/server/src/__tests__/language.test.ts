import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Media } from '@prisma/client';

// Langue de contenu par utilisateur : User.language pilote la traduction des
// titres/résumés (Media.translationsJson, rempli via TMDb /translations).
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-lang-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'lang.sqlite')}`;
process.env.NODE_ENV = 'test';
// Clé factice : tmdbEnabled() doit être vrai pour tester syncTranslationsFromTmdb
// (les appels réseau sont mockés via vi.stubGlobal('fetch')).
process.env.TMDB_API_KEY = 'test-key';
process.env.TMDB_READ_ACCESS_TOKEN = '';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';

let app: FastifyInstance;
let prismaClient: (typeof import('../db/client.js'))['prisma'];
let token = '';
let userId = '';

const auth = () => ({ authorization: `Bearer ${token}` });

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

  // Seul l'endpoint TMDb /translations est attendu pendant ces tests.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (/\/3\/(tv|movie)\/\d+\/translations/.test(u)) {
        return new Response(
          JSON.stringify({
            translations: [
              { iso_639_1: 'en', data: { name: 'Money Heist', overview: 'A criminal mastermind…' } },
              { iso_639_1: 'es', data: { name: 'La casa de papel', overview: 'Un genio del crimen…' } },
              // fr : jamais stocké dans translationsJson (porté par localizedTitle).
              { iso_639_1: 'fr', data: { name: 'La casa de papel (FR)', overview: 'Résumé FR' } },
              // Titre vide → langue ignorée.
              { iso_639_1: 'de', data: { name: '', overview: 'Beschreibung' } },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`fetch inattendu en test : ${u}`);
    }),
  );

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName: 'Polyglotte', email: 'lang@example.com', password: 'secret123' },
  });
  expect(res.statusCode).toBe(200);
  token = res.json().token;
  userId = res.json().user.id;
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await app?.close();
});

describe('serializeMedia — langue de contenu', () => {
  const base = {
    id: 'm1',
    type: 'show',
    title: 'Original Title',
    localizedTitle: 'Titre FR',
    originalTitle: 'Original Title',
    overview: 'Résumé original',
    localizedOverview: 'Résumé FR',
    translationsJson: JSON.stringify({
      en: { title: 'English Title', overview: 'English overview' },
      es: { title: 'Título ES' }, // sans overview → fallback fr
    }),
    genres: null,
    posterPath: null,
    backdropPath: null,
    year: 2020,
    firstAirDate: null,
    releaseDate: null,
    status: null,
    runtime: null,
    voteAverage: null,
    tmdbId: null,
    tvdbId: null,
    imdbId: null,
  } as unknown as Media;

  it('renvoie le titre et le résumé traduits quand la langue est disponible', async () => {
    const { serializeMedia } = await import('../modules/media/serialize.js');
    const dto = serializeMedia(base, null, 'en');
    expect(dto.title).toBe('English Title');
    expect(dto.overview).toBe('English overview');
  });

  it('retombe sur le français : lang=fr, langue absente du JSON, ou JSON invalide', async () => {
    const { serializeMedia } = await import('../modules/media/serialize.js');
    expect(serializeMedia(base, null, 'fr').title).toBe('Titre FR');
    expect(serializeMedia(base, null).title).toBe('Titre FR');
    expect(serializeMedia(base, null, 'it').title).toBe('Titre FR');
    // es : titre traduit mais overview absent → résumé fr conservé.
    const es = serializeMedia(base, null, 'es');
    expect(es.title).toBe('Título ES');
    expect(es.overview).toBe('Résumé FR');
    const broken = { ...base, translationsJson: '{pas du json' } as Media;
    expect(serializeMedia(broken, null, 'en').title).toBe('Titre FR');
  });
});

describe('POST /api/settings { language }', () => {
  it('met à jour User.language, répond started et GET /api/settings + /api/auth/me l’exposent', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/api/settings',
      headers: auth(),
      payload: { language: 'en' },
    });
    expect(post.statusCode).toBe(200);
    expect(post.json().started).toBe(true);
    expect(post.json().settings.language).toBe('en');

    const user = await prismaClient.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.language).toBe('en');

    const get = await app.inject({ method: 'GET', url: '/api/settings', headers: auth() });
    expect(get.json().settings.language).toBe('en');

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth() });
    expect(me.json().user.language).toBe('en');
  });

  it('refuse une langue hors liste', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings',
      headers: auth(),
      payload: { language: 'ja' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('routes — titres traduits dans les listes', () => {
  it('GET /api/shows renvoie le titre traduit quand translationsJson contient la langue', async () => {
    // Média inséré directement en DB (pas de mock TMDb nécessaire) — sans
    // tmdbId pour que le backfill du changement de langue le laisse tranquille.
    const media = await prismaClient.media.create({
      data: {
        type: 'show',
        title: 'Original Title',
        localizedTitle: 'Titre FR',
        translationsJson: JSON.stringify({ en: { title: 'English Title', overview: 'English overview' } }),
      },
    });
    await prismaClient.userMediaStatus.create({
      data: { userId, mediaId: media.id, status: 'watching' },
    });

    // Langue = en (posée au test précédent) → titre traduit.
    const en = await app.inject({ method: 'GET', url: '/api/shows', headers: auth() });
    expect(en.statusCode).toBe(200);
    expect(en.json().shows[0].title).toBe('English Title');
    expect(en.json().shows[0].overview).toBe('English overview');

    // Retour au fr → titre français (invalidateUserLang appliqué).
    await app.inject({ method: 'POST', url: '/api/settings', headers: auth(), payload: { language: 'fr' } });
    const fr = await app.inject({ method: 'GET', url: '/api/shows', headers: auth() });
    expect(fr.json().shows[0].title).toBe('Titre FR');
  });
});

describe('syncTranslationsFromTmdb (fetch mocké)', () => {
  it('récupère les langues cibles en une requête et remplit translationsJson (jamais le fr)', async () => {
    const { syncTranslationsFromTmdb } = await import('../services/tmdb/index.js');
    const media = await prismaClient.media.create({
      data: { type: 'show', title: 'Money Heist', localizedTitle: 'La casa de papel', tmdbId: '71446' },
    });
    const json = await syncTranslationsFromTmdb(media);
    expect(json).toBeTruthy();
    const stored = await prismaClient.media.findUniqueOrThrow({ where: { id: media.id } });
    const parsed = JSON.parse(stored.translationsJson!) as Record<string, { title: string; overview?: string }>;
    expect(parsed.en).toEqual({ title: 'Money Heist', overview: 'A criminal mastermind…' });
    expect(parsed.es?.title).toBe('La casa de papel');
    expect(parsed.fr).toBeUndefined(); // le fr reste porté par localizedTitle
    expect(parsed.de).toBeUndefined(); // titre vide → ignoré
  });

  it('skip silencieux sans tmdbId', async () => {
    const { syncTranslationsFromTmdb } = await import('../services/tmdb/index.js');
    const media = await prismaClient.media.create({
      data: { type: 'show', title: 'Sans TMDb', tvdbId: '424242' },
    });
    const json = await syncTranslationsFromTmdb(media);
    expect(json).toBeNull();
    const stored = await prismaClient.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(stored.translationsJson).toBeNull();
  });
});
