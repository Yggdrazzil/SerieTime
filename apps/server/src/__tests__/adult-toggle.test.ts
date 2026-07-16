import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Interrupteur « contenu 18+ » par utilisateur :
//   - défaut (false) : filtrage adulte actif + renforcé (hentai détecté par
//     mot-clé TMDb « erotic » sur les animés) ;
//   - true : tout le filtrage débrayé (include_adult=true, pas de vérif) ;
//   - isolation de cache : include_adult fait partie de la clé (un compte 18+
//     n'empoisonne pas le cache d'un compte standard).
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-adult-toggle-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'toggle.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = 'test-tmdb-key';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';
process.env.IGDB_ENABLED = 'false';

let app: FastifyInstance;
const fetchUrls: string[] = [];

const BASE_MULTI = [
  { id: 200, media_type: 'tv', name: 'Normal Anime', genre_ids: [16], adult: false, overview: 'nice' },
  // Hentai « anodin » : passe le flag adult ET containsAdultContent (titre neutre),
  // mais /tv/113360/keywords renvoie « erotic » → doit être exclu par item.
  { id: 113360, media_type: 'tv', name: 'Jimihen', genre_ids: [16, 35], adult: false, overview: 'anodin' },
  // Porno déjà couvert par containsAdultContent (titre explicite).
  { id: 500, media_type: 'movie', title: 'Hentai Paradise', adult: false, overview: 'nsfw' },
  { id: 300, media_type: 'tv', name: 'Normal Show', adult: false, overview: 'ok' },
];
// Item que TMDb ne renvoie QUE si include_adult=true : innocent en apparence
// (ni flag adult ni mot-clé), donc invisible aux post-filtres — s'il apparaît
// chez un compte standard, c'est une contamination de cache.
const ADULT_ONLY = { id: 400, media_type: 'tv', name: 'Adult Only Extra', adult: false, overview: 'extra' };

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      fetchUrls.push(u);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

      if (u.includes('/search/multi')) {
        const includeAdult = /[?&]include_adult=true/.test(u);
        return json({ results: includeAdult ? [...BASE_MULTI, ADULT_ONLY] : BASE_MULTI });
      }
      // Catalogue de mots-clés : « hentai » ramène aussi sentai/senpai/mental
      // (bruit) ; seul le nom EXACT doit être retenu.
      if (u.includes('/search/keyword')) {
        if (/query=hentai/.test(u)) {
          return json({
            results: [
              { id: 1, name: 'hentai' },
              { id: 283145, name: 'sentai' },
              { id: 281298, name: 'senpai' },
              { id: 199214, name: 'mental' },
            ],
          });
        }
        if (/query=erotic/.test(u)) {
          return json({ results: [{ id: 190370, name: 'erotic' }, { id: 999, name: 'erotic movie' }] });
        }
        if (/query=porno/.test(u)) return json({ results: [{ id: 2, name: 'porno' }, { id: 327507, name: 'porco' }] });
        return json({ results: [] });
      }
      // Mots-clés par item (vérification hentai).
      if (u.includes('/tv/113360/keywords')) return json({ results: [{ name: 'erotic' }, { name: 'romance' }] });
      if (/\/tv\/\d+\/keywords/.test(u) || /\/movie\/\d+\/keywords/.test(u)) return json({ results: [] });
      return json({ results: [] });
    }),
  );

  const { buildApp } = await import('../app.js');
  app = await buildApp();
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await app?.close();
});

async function registerUser(email: string, adult: boolean): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName: email, email, password: 'secret123' },
  });
  expect(res.statusCode).toBe(200);
  const token = res.json().token as string;
  if (adult) {
    const set = await app.inject({
      method: 'POST',
      url: '/api/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { allowAdultContent: true },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().settings.allowAdultContent).toBe(true);
  }
  return token;
}

describe('getAdultKeywordIds — correspondance de NOM EXACT uniquement', () => {
  it('retient « hentai » mais PAS sentai/senpai/mental/porco', async () => {
    const { getAdultKeywordIds, getEroticKeywordId } = await import('../services/tmdb/index.js');
    const ids = await getAdultKeywordIds();
    expect(ids).toContain('1'); // hentai
    expect(ids).toContain('2'); // porno
    expect(ids).toContain('999'); // erotic movie (nom exact composé)
    expect(ids).not.toContain('283145'); // sentai
    expect(ids).not.toContain('281298'); // senpai
    expect(ids).not.toContain('199214'); // mental
    expect(ids).not.toContain('327507'); // porco (Porco Rosso)
    expect(ids).not.toContain('190370'); // « erotic » seul → réservé aux animés
    // « erotic » exact récupéré à part (appliqué aux seuls viviers animés).
    expect(await getEroticKeywordId()).toBe('190370');
  });
});

describe('allowAdultContent = false (défaut)', () => {
  it('exclut le hentai « anodin » (mot-clé erotic) et le porno explicite, garde l’animé sain', async () => {
    const token = await registerUser('safe@example.com', false);
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=anime&type=media',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().results as { tmdbId: string | null }[]).map((r) => r.tmdbId);
    expect(ids).toContain('200'); // animé sain conservé
    expect(ids).toContain('300'); // série normale conservée
    expect(ids).not.toContain('113360'); // hentai détecté par mot-clé erotic
    expect(ids).not.toContain('500'); // porno explicite (containsAdultContent)
    expect(ids).not.toContain('400'); // jamais fetché pour un compte standard
  });
});

describe('allowAdultContent = true (débrayage total)', () => {
  it('renvoie hentai + porno + item adult-only, avec include_adult=true transmis', async () => {
    fetchUrls.length = 0;
    const token = await registerUser('adult@example.com', true);
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=anime&type=media',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().results as { tmdbId: string | null }[]).map((r) => r.tmdbId);
    expect(ids).toContain('113360'); // hentai visible (filtre débrayé)
    expect(ids).toContain('500'); // porno visible
    expect(ids).toContain('400'); // item réservé aux comptes 18+
    // include_adult=true a bien été transmis à TMDb.
    expect(fetchUrls.some((u) => u.includes('/search/multi') && /[?&]include_adult=true/.test(u))).toBe(true);
  });
});

describe('Isolation de cache entre comptes', () => {
  it('le fetch include_adult=true d’un compte 18+ ne contamine pas un compte standard', async () => {
    // Un compte 18+ interroge d'abord (peuple le cache avec la variante
    // include_adult=true contenant l'item 400)…
    const adultToken = await registerUser('adult2@example.com', true);
    const a = await app.inject({
      method: 'GET',
      url: '/api/search?q=isolation&type=media',
      headers: { authorization: `Bearer ${adultToken}` },
    });
    expect((a.json().results as { tmdbId: string | null }[]).map((r) => r.tmdbId)).toContain('400');
    // …puis un compte standard sur la MÊME requête : l'item 400 (invisible aux
    // post-filtres) ne doit pas apparaître → clé de cache distincte.
    const safeToken = await registerUser('safe2@example.com', false);
    const b = await app.inject({
      method: 'GET',
      url: '/api/search?q=isolation&type=media',
      headers: { authorization: `Bearer ${safeToken}` },
    });
    const ids = (b.json().results as { tmdbId: string | null }[]).map((r) => r.tmdbId);
    expect(ids).not.toContain('400');
    expect(ids).toContain('200');
  });
});
