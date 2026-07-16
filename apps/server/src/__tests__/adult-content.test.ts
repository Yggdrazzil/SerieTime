import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Filtrage anti-pornographie (hentai/porno/eroge) sur séries/films ET jeux, SANS
// bloquer la violence (gore/meurtre). TMDb : fetch mocké ; IGDB : ApiCache
// pré-rempli (adressé par le corps Apicalypse exact) → zéro requête réseau.
const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-adult-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'adult.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = 'test-tmdb-key';
process.env.TVMAZE_ENABLED = 'false';
process.env.TVDB_ENABLED = 'false';
process.env.IGDB_ENABLED = 'true';
process.env.TWITCH_CLIENT_ID = 'test-client';
process.env.TWITCH_CLIENT_SECRET = 'test-secret';

let app: FastifyInstance;
let token = '';
const bearer = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });

  // TMDb : /search/multi renvoie 3 résultats (porno / violent / sain), tous
  // adult:false — c'est containsAdultContent qui doit trancher.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/search/multi')) {
        const base = [
          { id: 1, media_type: 'movie', title: 'Hentai Paradise', adult: false, overview: 'nsfw' },
          {
            id: 2,
            media_type: 'movie',
            title: 'Blood Murder Gore',
            adult: false,
            overview: 'extreme violence, gore, blood and murder',
          },
          { id: 3, media_type: 'tv', name: 'Wholesome Family Show', adult: false, overview: 'a nice show' },
          // Pink film live-action : titre/résumé anodins (adult:false, aucun
          // marqueur textuel) → seuls les mots-clés TMDb le trahissent.
          { id: 10, media_type: 'movie', title: 'Pink Nights', adult: false, overview: 'a romance in Tokyo' },
          // Porno à titre KANJI « 変態 » SANS mot-clé et adult:false → aucun signal
          // textuel/keyword. Attrapé par la liste noire d'ids (id réel banni).
          { id: 233071, media_type: 'movie', title: '変態', original_title: '変態', adult: false, overview: 'drama' },
          // Animé japonais NORMAL (Demon Slayer) : titre kanji anodin + mots-clés
          // sains → conservé (pas de faux positif).
          { id: 12, media_type: 'tv', name: '鬼滅の刃', original_name: '鬼滅の刃', adult: false, overview: 'shounen' },
          // Animé grand public dont le TITRE contient « 変態 » (ex. « 変態王子 ») mais
          // AUCUN mot-clé adulte → doit être CONSERVÉ (le kanji 変態 seul ne bloque plus).
          { id: 13, media_type: 'tv', name: '変態な日常', original_name: '変態な日常', adult: false, overview: 'comedy' },
        ];
        return new Response(JSON.stringify({ results: base }), { status: 200 });
      }
      // Mots-clés par item (vérification appliquée à TOUS les items avec tmdbId).
      // Movie → champ `keywords` ; TV → champ `results`.
      if (u.includes('/movie/10/keywords')) {
        return new Response(JSON.stringify({ keywords: [{ name: 'pink film' }, { name: 'softcore' }] }), { status: 200 });
      }
      if (u.includes('/tv/12/keywords')) {
        return new Response(JSON.stringify({ results: [{ name: 'anime' }, { name: 'shounen' }] }), { status: 200 });
      }
      if (u.includes('/tv/13/keywords')) {
        return new Response(JSON.stringify({ results: [{ name: 'anime' }, { name: 'comedy' }] }), { status: 200 });
      }
      // Toute autre requête TMDb (mots-clés sains, langue…) : réponse vide inoffensive.
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }),
  );

  const { buildApp } = await import('../app.js');
  app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { displayName: 'Mod', email: 'mod@example.com', password: 'secret123' },
  });
  expect(res.statusCode).toBe(200);
  token = res.json().token;

  // Cache IGDB pour la recherche « Eroge » : 3 jeux SANS thème 42.
  const { prisma } = await import('../db/client.js');
  const { searchQueryBody } = await import('../services/igdb/index.js');
  await prisma.apiCache.create({
    data: {
      source: 'igdb',
      cacheKey: `games:${searchQueryBody('Eroge')}`,
      responseJson: JSON.stringify([
        { id: 501, name: 'Sexy Beach Eroge', game_type: 0 }, // nom explicite → exclu
        { id: 502, name: 'Campus Life', game_type: 0, summary: 'An explicit hardcore porn dating sim' }, // résumé porno → exclu
        {
          id: 503,
          name: 'Warzone Carnage',
          game_type: 0,
          summary: 'An ultra violent shooter full of gore, blood and murder',
        }, // violent → conservé
      ]),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await app?.close();
});

describe('TMDb — le porno est exclu, la violence conservée', () => {
  it('/api/search exclut « Hentai Paradise » mais garde le titre violent et le titre sain', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=whatever&type=media', headers: bearer() });
    expect(res.statusCode).toBe(200);
    const titles = (res.json().results as { title: string }[]).map((r) => r.title);
    expect(titles).not.toContain('Hentai Paradise');
    expect(titles).toContain('Blood Murder Gore'); // violence 18+ → autorisée
    expect(titles).toContain('Wholesome Family Show');
  });

  it('/api/search exclut le pink film (mots-clés) et l’id banni, garde les animés normaux', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=whatever&type=media', headers: bearer() });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().results as { tmdbId: string | null }[]).map((r) => r.tmdbId);
    expect(ids).not.toContain('10'); // pink film / softcore (mots-clés, titre anodin)
    expect(ids).not.toContain('233071'); // « 変態 » porno → liste noire d'ids
    expect(ids).toContain('12'); // 鬼滅の刃 (Demon Slayer) — titre japonais normal
    expect(ids).toContain('13'); // « 変態な日常 » — 変態 dans le titre mais animé normal → conservé
  });
});

describe('TMDb — 18+ activé : tout revient', () => {
  it('/api/search avec allowAdultContent=true renvoie pink film, kanji et hentai', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { displayName: 'Adult', email: 'adult@example.com', password: 'secret123' },
    });
    expect(reg.statusCode).toBe(200);
    const adultToken = reg.json().token as string;
    const set = await app.inject({
      method: 'POST',
      url: '/api/settings',
      headers: { authorization: `Bearer ${adultToken}` },
      payload: { allowAdultContent: true },
    });
    expect(set.statusCode).toBe(200);
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=whatever&type=media',
      headers: { authorization: `Bearer ${adultToken}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().results as { tmdbId: string | null }[]).map((r) => r.tmdbId);
    expect(ids).toContain('1'); // Hentai Paradise
    expect(ids).toContain('10'); // pink film
    expect(ids).toContain('233071'); // 変態 (id banni) — revient en 18+
  });
});

describe('IGDB — eroge/porno exclus (sans thème 42), jeu violent conservé', () => {
  it('/api/games/search écarte les jeux au nom/résumé porno et garde le jeu violent', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games/search?q=Eroge', headers: bearer() });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().results as { igdbId: string | null }[]).map((r) => r.igdbId);
    expect(ids).not.toContain('501');
    expect(ids).not.toContain('502');
    expect(ids).toContain('503'); // violence/gore → conservé
  });
});
