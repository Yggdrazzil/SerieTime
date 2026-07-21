// Resync GLOBALE des métadonnées : re-télécharge depuis la source (TMDb films
// et séries, TheTVDB séries sans tmdbId) les données FACTUELLES de chaque fiche
// et nettoie les valeurs aberrantes héritées (ex. année « 1 »). One-shot, à
// lancer sur le serveur (avec les clés API en env), idempotent :
//
//   pnpm --filter @serietime/server resync:metadata
//   # ou, ciblé sur les fiches à année absente/aberrante uniquement :
//   pnpm --filter @serietime/server resync:metadata -- --bad-years-only
//   # ou, comblement des TITRES FRANÇAIS manquants uniquement (fiches à tmdbId
//   # dont localizedTitle est NULL — typiquement les imports TV Time) :
//   pnpm --filter @serietime/server resync:metadata -- --titles
//
// NE touche PAS aux affiches/bannières (personnalisables), épisodes, ni aux
// données utilisateur (statuts, notes, favoris). `--titles` comble
// localizedTitle/originalTitle quand ils sont NULL mais ne modifie JAMAIS
// `title` (il sert au matching des ré-imports TV Time).
import { prisma } from '../src/db/client.js';
import {
  backfillLocalizedTitle,
  refreshMediaMetadata,
  type MetadataResync,
} from '../src/services/tmdb/enrich.js';

const CONCURRENCY = 4; // douceur envers les API (le cache TMDb absorbe le reste)
const PACE_MS = 150; // petite pause entre lots
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Boucle commune : lots de CONCURRENCY, pause entre lots, tally journalisé.
async function runBatched<T extends { id: string; title: string }>(
  medias: T[],
  worker: (m: T) => Promise<MetadataResync>,
): Promise<void> {
  const tally: Record<MetadataResync | 'error', number> = { updated: 0, skipped: 0, unavailable: 0, error: 0 };
  for (let i = 0; i < medias.length; i += CONCURRENCY) {
    const batch = medias.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((m) =>
        worker(m).catch((e) => {
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
}

async function main() {
  const args = process.argv.slice(2);
  const badYearsOnly = args.includes('--bad-years-only');
  const titlesOnly = args.includes('--titles');
  const maxY = new Date().getFullYear() + 10;

  // Mode --titles : comblement CIBLÉ des titres français manquants, rien d'autre.
  if (titlesOnly) {
    const medias = await prisma.media.findMany({
      where: { type: { in: ['show', 'movie'] }, tmdbId: { not: null }, localizedTitle: null },
      select: { id: true, type: true, tmdbId: true, title: true, localizedTitle: true, originalTitle: true },
      orderBy: { updatedAt: 'asc' },
    });
    console.log(`[resync] ${medias.length} fiche(s) sans titre localisé à combler (--titles).`);
    await runBatched(medias, (m) => backfillLocalizedTitle(m));
    await prisma.$disconnect();
    return;
  }

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
  await runBatched(medias, (m) => refreshMediaMetadata(m));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[resync] Erreur fatale :', e);
  await prisma.$disconnect();
  process.exit(1);
});
