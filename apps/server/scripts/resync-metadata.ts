// Resync GLOBALE des métadonnées : re-télécharge depuis la source (TMDb films
// et séries, TheTVDB séries sans tmdbId) les données FACTUELLES de chaque fiche
// et nettoie les valeurs aberrantes héritées (ex. année « 1 »). One-shot, à
// lancer sur le serveur (avec les clés API en env), idempotent :
//
//   pnpm --filter @serietime/server resync:metadata
//   # ou, ciblé sur les fiches à année absente/aberrante uniquement :
//   pnpm --filter @serietime/server resync:metadata -- --bad-years-only
//
// NE touche PAS aux affiches/bannières (personnalisables), titres, traductions,
// épisodes, ni aux données utilisateur (statuts, notes, favoris).
import { prisma } from '../src/db/client.js';
import { refreshMediaMetadata, type MetadataResync } from '../src/services/tmdb/enrich.js';

const CONCURRENCY = 4; // douceur envers les API (le cache TMDb absorbe le reste)
const PACE_MS = 150; // petite pause entre lots
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const badYearsOnly = process.argv.slice(2).includes('--bad-years-only');
  const maxY = new Date().getFullYear() + 10;

  const medias = await prisma.media.findMany({
    where: {
      type: { in: ['show', 'movie'] },
      // Ciblé : uniquement les fiches à année manquante ou hors plage plausible.
      ...(badYearsOnly ? { OR: [{ year: null }, { year: { lt: 1888 } }, { year: { gt: maxY } }] } : {}),
    },
    select: { id: true, type: true, tmdbId: true, tvdbId: true, title: true },
    orderBy: { updatedAt: 'asc' },
  });

  console.log(
    `[resync] ${medias.length} fiche(s) à traiter${badYearsOnly ? ' (années aberrantes seulement)' : ''}.`,
  );
  const tally: Record<MetadataResync | 'error', number> = { updated: 0, skipped: 0, unavailable: 0, error: 0 };

  for (let i = 0; i < medias.length; i += CONCURRENCY) {
    const batch = medias.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((m) =>
        refreshMediaMetadata(m).catch((e) => {
          console.warn(`[resync] échec « ${m.title} » (${m.id}) :`, (e as Error)?.message ?? e);
          return 'error' as const;
        }),
      ),
    );
    results.forEach((r) => (tally[r] += 1));
    const done = Math.min(i + CONCURRENCY, medias.length);
    if (done % 40 === 0 || done === medias.length) {
      console.log(`[resync] ${done}/${medias.length} — ${JSON.stringify(tally)}`);
    }
    await sleep(PACE_MS);
  }

  console.log('[resync] Terminé.', JSON.stringify(tally));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[resync] Erreur fatale :', e);
  await prisma.$disconnect();
  process.exit(1);
});
