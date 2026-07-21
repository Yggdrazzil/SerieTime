// Titres FRANÇAIS des fiches importées : le serveur interroge TMDb en fr-FR
// (env.DEFAULT_LANGUAGE), donc `tv.name`/`movie.title` d'une réponse TMDb est
// déjà le titre français. Ces tests vérifient que l'enrichissement d'import
// (enrichImportedMedia) et le backfill du stock (resync-metadata --titles, via
// backfillLocalizedTitle) COMBLENT localizedTitle/originalTitle sans JAMAIS
// toucher `title` (qui sert au matching des ré-imports TV Time).
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-import-titles-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'titles.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = 'test-key'; // tmdbEnabled() === true, appels réseau mockés ci-dessous
process.env.TVDB_ENABLED = 'false';

// On mocke UNIQUEMENT les fetchers TMDb (pas de réseau) ; le reste du module
// (tmdbEnabled, types…) reste réel. enrich.ts et import-tvtime/service.ts
// consomment ce même module — le mock les couvre donc tous les deux.
vi.mock('../services/tmdb/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/tmdb/client.js')>();
  return {
    ...actual,
    tmdbFindByExternalId: vi.fn<typeof actual.tmdbFindByExternalId>(async () => null),
    tmdbSearch: vi.fn<typeof actual.tmdbSearch>(async () => []),
    tmdbShowDetails: vi.fn<typeof actual.tmdbShowDetails>(async () => null),
    tmdbMovieDetails: vi.fn<typeof actual.tmdbMovieDetails>(async () => null),
  };
});

let prisma: typeof import('../db/client.js')['prisma'];
let enrichImportedMedia: typeof import('../modules/import-tvtime/service.js')['enrichImportedMedia'];
let backfillLocalizedTitle: typeof import('../services/tmdb/enrich.js')['backfillLocalizedTitle'];
let localizedTitleFillPatch: typeof import('../services/tmdb/enrich.js')['localizedTitleFillPatch'];
let tmdb: typeof import('../services/tmdb/client.js');

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
  ({ prisma } = await import('../db/client.js'));
  ({ enrichImportedMedia } = await import('../modules/import-tvtime/service.js'));
  ({ backfillLocalizedTitle, localizedTitleFillPatch } = await import('../services/tmdb/enrich.js'));
  tmdb = await import('../services/tmdb/client.js');
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.mocked(tmdb.tmdbFindByExternalId).mockReset().mockResolvedValue(null);
  vi.mocked(tmdb.tmdbSearch).mockReset().mockResolvedValue([]);
  vi.mocked(tmdb.tmdbShowDetails).mockReset().mockResolvedValue(null);
  vi.mocked(tmdb.tmdbMovieDetails).mockReset().mockResolvedValue(null);
});

describe('localizedTitleFillPatch (pur)', () => {
  it('pose localizedTitle quand le titre fr diffère du title stocké', () => {
    expect(
      localizedTitleFillPatch(
        { title: 'Money Heist', localizedTitle: null, originalTitle: null },
        { localized: 'La Casa de Papel', original: 'La casa de papel' },
      ),
    ).toEqual({ localizedTitle: 'La Casa de Papel', originalTitle: 'La casa de papel' });
  });

  it('ne pose RIEN quand le titre fr est identique au title stocké', () => {
    expect(
      localizedTitleFillPatch(
        { title: 'Dark', localizedTitle: null, originalTitle: null },
        { localized: 'Dark', original: 'Dark' },
      ),
    ).toEqual({});
  });

  it('n’écrase jamais un localizedTitle/originalTitle existant, ignore vide/blanc', () => {
    expect(
      localizedTitleFillPatch(
        { title: 'Alice in Borderland', localizedTitle: 'Alice au pays des merveilles', originalTitle: '今際の国のアリス' },
        { localized: 'Autre titre', original: 'Autre original' },
      ),
    ).toEqual({});
    expect(
      localizedTitleFillPatch(
        { title: 'X', localizedTitle: null, originalTitle: null },
        { localized: '   ', original: '' },
      ),
    ).toEqual({});
  });
});

describe('enrichImportedMedia — titres français (flux import)', () => {
  it('série importée : pose localizedTitle/originalTitle depuis /find (fr-FR), title INCHANGÉ', async () => {
    const media = await prisma.media.create({
      data: { type: 'show', title: 'Money Heist', tvdbId: '327417', sourcePriority: 'import', show: { create: {} } },
    });
    vi.mocked(tmdb.tmdbFindByExternalId).mockResolvedValue({
      tv_results: [
        {
          id: 71446,
          name: 'La Casa de Papel',
          original_name: 'La casa de papel',
          overview: 'Résumé fr.',
          poster_path: '/casa.jpg',
          first_air_date: '2017-05-02',
        },
      ],
      movie_results: [],
    });

    await enrichImportedMedia(media.id);

    const after = await prisma.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(after.title).toBe('Money Heist'); // JAMAIS modifié (matching ré-imports)
    expect(after.localizedTitle).toBe('La Casa de Papel');
    expect(after.originalTitle).toBe('La casa de papel');
    expect(after.tmdbId).toBe('71446');
  });

  it('série importée : name identique au title → localizedTitle NON posé', async () => {
    const media = await prisma.media.create({
      data: { type: 'show', title: 'Dark', tvdbId: '332484', sourcePriority: 'import', show: { create: {} } },
    });
    vi.mocked(tmdb.tmdbFindByExternalId).mockResolvedValue({
      tv_results: [{ id: 70523, name: 'Dark', original_name: 'Dark', poster_path: '/dark.jpg' }],
      movie_results: [],
    });

    await enrichImportedMedia(media.id);

    const after = await prisma.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(after.title).toBe('Dark');
    expect(after.localizedTitle).toBeNull();
    expect(after.originalTitle).toBeNull();
    expect(after.tmdbId).toBe('70523'); // le reste de l'enrichissement continue
  });

  it('film importé : pose localizedTitle depuis la recherche TMDb (fr-FR), title INCHANGÉ', async () => {
    const media = await prisma.media.create({
      data: { type: 'movie', title: 'The Matrix', year: 1999, sourcePriority: 'import', movie: { create: {} } },
    });
    vi.mocked(tmdb.tmdbSearch).mockResolvedValue([
      { id: 603, title: 'Matrix', original_title: 'The Matrix', release_date: '1999-03-31', poster_path: '/matrix.jpg' },
    ]);

    await enrichImportedMedia(media.id);

    const after = await prisma.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(after.title).toBe('The Matrix');
    expect(after.localizedTitle).toBe('Matrix');
    // original_title identique au title stocké : rien à combler.
    expect(after.originalTitle).toBeNull();
    expect(after.tmdbId).toBe('603');
  });

  it('ne touche pas à un localizedTitle déjà posé (ex. traduction TheTVDB)', async () => {
    const media = await prisma.media.create({
      data: {
        type: 'show',
        title: 'Attack on Titan',
        localizedTitle: 'L’Attaque des Titans',
        tvdbId: '267440',
        sourcePriority: 'tvdb',
        show: { create: {} },
      },
    });
    vi.mocked(tmdb.tmdbFindByExternalId).mockResolvedValue({
      tv_results: [{ id: 1429, name: 'Autre titre TMDb', original_name: '進撃の巨人' }],
      movie_results: [],
    });

    await enrichImportedMedia(media.id);

    const after = await prisma.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(after.localizedTitle).toBe('L’Attaque des Titans'); // TVDB reste prioritaire
    expect(after.originalTitle).toBe('進撃の巨人'); // NULL comblé, lui
  });
});

describe('backfillLocalizedTitle — stock (resync-metadata --titles)', () => {
  it('série à tmdbId sans localizedTitle : comblé depuis tmdbShowDetails (fr-FR)', async () => {
    const media = await prisma.media.create({
      data: { type: 'show', title: 'Squid Game', tmdbId: '93405', sourcePriority: 'import', show: { create: {} } },
    });
    vi.mocked(tmdb.tmdbShowDetails).mockResolvedValue({
      id: 93405,
      name: 'Squid Game',
      original_name: '오징어 게임',
    });
    // name identique au title → seul originalTitle est comblé, résultat 'updated'.
    expect(await backfillLocalizedTitle(media)).toBe('updated');
    let after = await prisma.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(after.title).toBe('Squid Game');
    expect(after.localizedTitle).toBeNull();
    expect(after.originalTitle).toBe('오징어 게임');

    const media2 = await prisma.media.create({
      data: { type: 'show', title: 'Money Heist', tmdbId: '71446', sourcePriority: 'import', show: { create: {} } },
    });
    vi.mocked(tmdb.tmdbShowDetails).mockResolvedValue({
      id: 71446,
      name: 'La Casa de Papel',
      original_name: 'La casa de papel',
    });
    expect(await backfillLocalizedTitle(media2)).toBe('updated');
    after = await prisma.media.findUniqueOrThrow({ where: { id: media2.id } });
    expect(after.title).toBe('Money Heist');
    expect(after.localizedTitle).toBe('La Casa de Papel');
    expect(after.originalTitle).toBe('La casa de papel');
  });

  it('film à tmdbId sans localizedTitle : comblé depuis tmdbMovieDetails', async () => {
    const media = await prisma.media.create({
      data: { type: 'movie', title: 'The Godfather', tmdbId: '238', sourcePriority: 'import', movie: { create: {} } },
    });
    vi.mocked(tmdb.tmdbMovieDetails).mockResolvedValue({
      id: 238,
      title: 'Le Parrain',
      original_title: 'The Godfather',
    });
    expect(await backfillLocalizedTitle(media)).toBe('updated');
    const after = await prisma.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(after.title).toBe('The Godfather');
    expect(after.localizedTitle).toBe('Le Parrain');
    expect(after.originalTitle).toBeNull(); // identique au title stocké
  });

  it('skip : localizedTitle déjà posé, pas de tmdbId, jeu, titre fr identique', async () => {
    const already = await prisma.media.create({
      data: { type: 'show', title: 'X', localizedTitle: 'X fr', tmdbId: '1', show: { create: {} } },
    });
    expect(await backfillLocalizedTitle(already)).toBe('skipped');

    const noTmdb = await prisma.media.create({
      data: { type: 'movie', title: 'Sans id', sourcePriority: 'import', movie: { create: {} } },
    });
    expect(await backfillLocalizedTitle(noTmdb)).toBe('skipped');

    const game = await prisma.media.create({ data: { type: 'game', title: 'Jeu', tmdbId: '2' } });
    expect(await backfillLocalizedTitle(game)).toBe('skipped');

    const same = await prisma.media.create({
      data: { type: 'movie', title: 'Inception', tmdbId: '27205', movie: { create: {} } },
    });
    vi.mocked(tmdb.tmdbMovieDetails).mockResolvedValue({ id: 27205, title: 'Inception', original_title: 'Inception' });
    expect(await backfillLocalizedTitle(same)).toBe('skipped');
    const after = await prisma.media.findUniqueOrThrow({ where: { id: same.id } });
    expect(after.localizedTitle).toBeNull();
    expect(after.originalTitle).toBeNull();
  });

  it('unavailable : TMDb ne répond pas (fiche laissée intacte)', async () => {
    const media = await prisma.media.create({
      data: { type: 'movie', title: 'Fantôme', tmdbId: '999999', movie: { create: {} } },
    });
    expect(await backfillLocalizedTitle(media)).toBe('unavailable');
    const after = await prisma.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(after.localizedTitle).toBeNull();
  });
});
