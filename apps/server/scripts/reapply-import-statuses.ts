// Réparation one-shot : ré-applique les STATUTS de séries du dernier import
// TV Time confirmé de chaque utilisateur, depuis le zip d'origine conservé
// (data/imports/<importId>/original.zip). Contexte : d'anciens imports ne
// reprenaient pas « Arrêtée » (active=0 → stopped_watching → abandoned) ;
// les zips étant conservés, on peut re-parser et corriger sans ré-importer.
//
// Ce script ne touche QUE le champ `status` de UserMediaStatus (séries), et
// seulement si :
//   - le zip donne un statut EXPLICITE (colonne status connue de
//     TVTIME_STATUS_MAP, ou active=0 → stopped_watching) ;
//   - le statut actuel est différent ;
//   - le statut actuel est 'watching' / 'not_started' / 'watchlist'
//     (on n'écrase JAMAIS 'completed', 'abandoned' ni 'paused' — posés plus
//     finement par l'utilisateur ou par la progression réelle).
// Épisodes, notes, favoris, dates : jamais modifiés.
//
// Usage (DRY-RUN par défaut, rien n'est écrit) :
//   pnpm --filter @serietime/server reapply:statuses
//   pnpm --filter @serietime/server reapply:statuses -- --user etienne@exemple.fr
//   pnpm --filter @serietime/server reapply:statuses -- --apply
//   pnpm --filter @serietime/server reapply:statuses -- --user etienne@exemple.fr --apply
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import type { NormalizedImportedMedia } from '@serietime/types';
import {
  bestCandidate,
  normalizeImportedMedia,
  normalizeTitle,
  parseFileContent,
  type MatchCandidate,
} from '@serietime/core/server';
import { prisma } from '../src/db/client.js';
import { importDir, mapImportedStatus, TVTIME_STATUS_MAP } from '../src/modules/import-tvtime/service.js';

export type ReapplyChange = {
  email: string;
  statusId: string;
  title: string;
  from: string;
  to: string;
};

export type ReapplyResult = {
  changes: ReapplyChange[];
  usersScanned: number;
  usersWithoutZip: number;
  applied: boolean;
};

// Statuts actuels qu'un statut du zip a le droit de remplacer. 'completed' et
// 'abandoned' sont protégés (jamais écrasés) ; 'paused' aussi : il n'existe pas
// dans les vrais exports TV Time, donc s'il est posé, c'est un choix utilisateur.
const OVERRIDABLE_CURRENT = new Set(['watching', 'not_started', 'watchlist']);

// Extrait des fichiers « séries » du zip (followed_tv_show, user_tv_show_data,
// user_show_special_status) les séries porteuses d'un statut EXPLICITE, via la
// mécanique d'import existante (parseFileContent + normalizeImportedMedia —
// c'est elle qui traduit active=0 en stopped_watching). Fusion par id externe
// puis titre, comme analyzeImport ; en cas de conflit entre deux fichiers, un
// statut menant à 'abandoned' gagne (même priorité que applyMapping).
export function extractShowStatusesFromZip(zipPath: string): NormalizedImportedMedia[] {
  const zip = new AdmZip(zipPath);
  const byKey = new Map<string, NormalizedImportedMedia>();
  const keyOf = (m: NormalizedImportedMedia): string =>
    m.tvdbId ? `tvdb:${m.tvdbId}` : m.tmdbId ? `tmdb:${m.tmdbId}` : `title:${normalizeTitle(m.title)}`;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    // Mêmes gardes que analyzeImport (zip slip / extensions).
    if (name.includes('..') || path.isAbsolute(name)) continue;
    if (!/\.(csv|json|txt)$/i.test(name)) continue;
    const parsed = parseFileContent(name, entry.getData().toString('utf-8'));
    if (parsed.kind !== 'shows') continue;
    for (const row of parsed.rows) {
      const m = normalizeImportedMedia(row, 'shows');
      if (!m || m.mediaType === 'movie' || !m.status) continue;
      // Statut explicite uniquement : jamais le défaut de mapImportedStatus.
      if (!TVTIME_STATUS_MAP[m.status.trim().toLowerCase()]) continue;
      const key = keyOf(m);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, m);
      } else {
        const prevMapped = mapImportedStatus(prev.status, 'show');
        const nextMapped = mapImportedStatus(m.status, 'show');
        if (nextMapped === 'abandoned' && prevMapped !== 'abandoned') prev.status = m.status;
        prev.tvdbId = prev.tvdbId ?? m.tvdbId;
        prev.tmdbId = prev.tmdbId ?? m.tmdbId;
        prev.year = prev.year ?? m.year;
      }
    }
  }
  return [...byKey.values()];
}

export async function reapplyImportStatuses(options: {
  userEmail?: string;
  apply?: boolean;
  log?: (line: string) => void;
} = {}): Promise<ReapplyResult> {
  const log = options.log ?? console.log;
  const apply = options.apply ?? false;

  const importWhere: { status: { in: string[] }; userId?: string | { not: null } } = {
    // « Confirmé » = l'utilisateur a lancé l'application ('importing' couvre un
    // import interrompu en cours de route : ses statuts aussi méritent réparation).
    status: { in: ['imported', 'importing'] },
    userId: { not: null },
  };
  if (options.userEmail) {
    const user = await prisma.user.findFirst({ where: { email: options.userEmail } });
    if (!user) throw new Error(`Utilisateur introuvable : ${options.userEmail}`);
    importWhere.userId = user.id;
  }
  const imports = await prisma.import.findMany({
    where: importWhere,
    orderBy: { createdAt: 'desc' },
    select: { id: true, userId: true, createdAt: true, fileName: true },
  });

  // Par utilisateur : son import confirmé LE PLUS RÉCENT dont original.zip existe.
  const zipByUser = new Map<string, string>();
  const usersSeen = new Set<string>();
  for (const imp of imports) {
    if (!imp.userId) continue;
    usersSeen.add(imp.userId);
    if (zipByUser.has(imp.userId)) continue;
    const zipPath = path.join(importDir(imp.id), 'original.zip');
    if (existsSync(zipPath)) zipByUser.set(imp.userId, zipPath);
  }

  const changes: ReapplyChange[] = [];
  for (const [userId, zipPath] of zipByUser) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const email = user?.email ?? userId;
    let extracted: NormalizedImportedMedia[];
    try {
      extracted = extractShowStatusesFromZip(zipPath);
    } catch (err) {
      log(`[!] ${email} : zip illisible (${zipPath}) — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (extracted.length === 0) continue;

    // Bibliothèque ACTUELLE de l'utilisateur (séries uniquement) → candidats de
    // matching, mêmes scores que l'import (id externe = 100, titre+année = 90).
    const library = await prisma.userMediaStatus.findMany({
      where: { userId, media: { type: 'show' } },
      include: { media: true },
    });
    const candidates: MatchCandidate[] = library.map((s) => ({
      mediaId: s.mediaId,
      title: s.media.title,
      originalTitle: s.media.originalTitle ?? undefined,
      localizedTitle: s.media.localizedTitle ?? undefined,
      year: s.media.year ?? undefined,
      tvdbId: s.media.tvdbId ?? undefined,
      tmdbId: s.media.tmdbId ?? undefined,
      imdbId: s.media.imdbId ?? undefined,
    }));
    const statusByMediaId = new Map(library.map((s) => [s.mediaId, s]));

    for (const m of extracted) {
      const best = bestCandidate(
        { title: m.title, year: m.year, tvdbId: m.tvdbId, tmdbId: m.tmdbId, imdbId: m.imdbId },
        candidates,
      );
      // Seuil 75 : d'après la table de scores (matching/score.ts), ≥ 75 ⇒ id
      // externe exact (100), titre normalisé + année (90/80) ou titre normalisé
      // EXACT sans année comparable (75 — les followed_tv_show.csv TV Time
      // n'ont pas d'année). Jamais de correction sur un titre approchant (≤ 70).
      if (!best || best.score < 75 || !best.candidate.mediaId) continue;
      const current = statusByMediaId.get(best.candidate.mediaId);
      if (!current) continue;
      const desired = mapImportedStatus(m.status, 'show');
      if (current.status === desired) continue;
      if (!OVERRIDABLE_CURRENT.has(current.status)) continue;
      // Jamais de RÉTROGRADATION d'une série en cours : « watching » reflète des
      // épisodes réellement vus (posé par recalculateShowStatus) ; un for_later
      // du zip (→ watchlist) ne doit pas l'effacer. abandoned/paused/completed
      // du zip, eux, priment bien sur watching.
      if (current.status === 'watching' && (desired === 'watchlist' || desired === 'not_started')) continue;

      changes.push({ email, statusId: current.id, title: current.media.title, from: current.status, to: desired });
      log(`${apply ? '[apply]  ' : '[dry-run]'} ${email} : « ${current.media.title} » ${current.status} → ${desired}`);
      if (apply) {
        await prisma.userMediaStatus.update({ where: { id: current.id }, data: { status: desired } });
      }
    }
  }

  const usersWithoutZip = usersSeen.size - zipByUser.size;
  log('');
  log(
    `${changes.length} changement(s) de statut sur ${zipByUser.size} utilisateur(s) scanné(s)` +
      (usersWithoutZip > 0 ? ` (${usersWithoutZip} sans original.zip, ignoré(s))` : '') +
      '.',
  );
  if (!apply && changes.length > 0) log('Dry-run : rien n’a été écrit. Relancer avec --apply pour appliquer.');
  return { changes, usersScanned: zipByUser.size, usersWithoutZip, applied: apply };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const userIdx = args.indexOf('--user');
  const userEmail = userIdx >= 0 ? args[userIdx + 1] : undefined;
  if (userIdx >= 0 && !userEmail) {
    console.error('Usage : reapply:statuses [--user <email>] [--apply]');
    process.exit(1);
  }
  await reapplyImportStatuses({ userEmail, apply });
  await prisma.$disconnect();
}

// Exécution directe uniquement (le fichier est aussi importé par les tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (e) => {
    console.error('[reapply] Erreur fatale :', e);
    await prisma.$disconnect();
    process.exit(1);
  });
}
