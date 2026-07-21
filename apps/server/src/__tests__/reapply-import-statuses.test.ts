import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(path.join(tmpdir(), 'serietime-test-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'test.sqlite')}`;
process.env.NODE_ENV = 'test';
process.env.TMDB_API_KEY = '';
process.env.TMDB_READ_ACCESS_TOKEN = '';
process.env.TVMAZE_ENABLED = 'false';

let prisma: (typeof import('../db/client.js'))['prisma'];
let reapplyImportStatuses: (typeof import('../../scripts/reapply-import-statuses.js'))['reapplyImportStatuses'];
let importDir: (typeof import('../modules/import-tvtime/service.js'))['importDir'];

let etienneId = '';
let autreId = '';
const importDirsToClean: string[] = [];

// Zip TV Time forgé en mémoire (AdmZip), écrit là où l'import range les
// originaux : data/imports/<importId>/original.zip — même mécanique que
// saveUpload, comme les tests d'import posent leurs fichiers via l'API.
async function forgeOriginalZip(importId: string, followedCsv: string): Promise<void> {
  const zip = new AdmZip();
  zip.addFile('followed_tv_show.csv', Buffer.from(followedCsv, 'utf-8'));
  const dir = importDir(importId);
  importDirsToClean.push(dir);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'original.zip'), zip.toBuffer());
}

beforeAll(async () => {
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
    stdio: 'pipe',
  });
  ({ prisma } = await import('../db/client.js'));
  ({ importDir } = await import('../modules/import-tvtime/service.js'));
  ({ reapplyImportStatuses } = await import('../../scripts/reapply-import-statuses.js'));

  // ————— Étienne : bibliothèque actuelle —————
  // 3 séries : une « watching » que le zip dit arrêtée (le bug à réparer),
  // une « completed » que le zip dit AUSSI arrêtée (protégée), une matchée
  // par titre normalisé exact seulement (pas d'id TheTVDB, et les
  // followed_tv_show.csv TV Time n'ont pas de colonne année).
  const etienne = await prisma.user.create({
    data: { displayName: 'Etienne', email: 'etienne@example.com' },
  });
  etienneId = etienne.id;
  const vieille = await prisma.media.create({
    data: { type: 'show', title: 'Vieille Série', year: 2010, tvdbId: '424242', show: { create: {} } },
  });
  const finie = await prisma.media.create({
    data: { type: 'show', title: 'Série Finie', year: 2015, tvdbId: '777777', show: { create: {} } },
  });
  const sansId = await prisma.media.create({
    data: { type: 'show', title: 'Sans Identifiant', year: 2018, show: { create: {} } },
  });
  await prisma.userMediaStatus.createMany({
    data: [
      { userId: etienneId, mediaId: vieille.id, status: 'watching', rating: 6 },
      { userId: etienneId, mediaId: finie.id, status: 'completed' },
      { userId: etienneId, mediaId: sansId.id, status: 'not_started' },
    ],
  });

  // Son vieil import confirmé, zip d'origine conservé. active=0 = « Arrêtée »
  // (stopped_watching → abandoned via mapImportedStatus) ; active=1 sans
  // statut = rien d'explicite → jamais touché.
  const importEtienne = await prisma.import.create({
    data: { userId: etienneId, source: 'tvtime', fileName: 'tvtime.zip', fileHash: 'hash-etienne', status: 'imported' },
  });
  await forgeOriginalZip(
    importEtienne.id,
    [
      'tv_show_name,tvdb_id,active,created_at',
      'Vieille Série,424242,0,2021-01-01 10:00:00',
      'Série Finie,777777,0,2021-01-01 10:00:00',
      'Sans Identifiant,,0,2021-01-01 10:00:00',
      'Série Suivie Normale,999999,1,2021-01-01 10:00:00',
    ].join('\n') + '\n',
  );

  // ————— Autre utilisateur (pour le ciblage --user) —————
  const autre = await prisma.user.create({ data: { displayName: 'Autre', email: 'autre@example.com' } });
  autreId = autre.id;
  const autreShow = await prisma.media.create({
    data: { type: 'show', title: 'Autre Série', year: 2012, tvdbId: '131313', show: { create: {} } },
  });
  await prisma.userMediaStatus.create({
    data: { userId: autreId, mediaId: autreShow.id, status: 'watching' },
  });
  const importAutre = await prisma.import.create({
    data: { userId: autreId, source: 'tvtime', fileName: 'tvtime.zip', fileHash: 'hash-autre', status: 'imported' },
  });
  await forgeOriginalZip(
    importAutre.id,
    ['tv_show_name,tvdb_id,active,created_at', 'Autre Série,131313,0,2022-02-02 10:00:00'].join('\n') + '\n',
  );
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  for (const dir of importDirsToClean) rmSync(dir, { recursive: true, force: true });
});

describe('Réparation des statuts depuis les zips d’import conservés', () => {
  const silent = () => undefined;

  it('dry-run : liste les changements SANS rien écrire', async () => {
    const lines: string[] = [];
    const result = await reapplyImportStatuses({ userEmail: 'etienne@example.com', log: (l) => lines.push(l) });

    expect(result.applied).toBe(false);
    expect(result.usersScanned).toBe(1);
    // 2 changements : la série watching (id TheTVDB) et celle matchée par
    // titre+année. La 'completed' est protégée, active=1 n'a rien d'explicite.
    expect(result.changes).toHaveLength(2);
    const byTitle = new Map(result.changes.map((c) => [c.title, c]));
    expect(byTitle.get('Vieille Série')).toMatchObject({ from: 'watching', to: 'abandoned', email: 'etienne@example.com' });
    expect(byTitle.get('Sans Identifiant')).toMatchObject({ from: 'not_started', to: 'abandoned' });
    expect(byTitle.has('Série Finie')).toBe(false);
    expect(lines.join('\n')).toContain('« Vieille Série » watching → abandoned');

    // Rien n'a été écrit.
    const statuses = await prisma.userMediaStatus.findMany({ where: { userId: etienneId }, include: { media: true } });
    const current = new Map(statuses.map((s) => [s.media.title, s.status]));
    expect(current.get('Vieille Série')).toBe('watching');
    expect(current.get('Série Finie')).toBe('completed');
    expect(current.get('Sans Identifiant')).toBe('not_started');
  });

  it('--user ne scanne que l’utilisateur ciblé', async () => {
    const result = await reapplyImportStatuses({ userEmail: 'autre@example.com', log: silent });
    expect(result.usersScanned).toBe(1);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ email: 'autre@example.com', title: 'Autre Série', to: 'abandoned' });
  });

  it('--apply écrit le statut « abandoned » sans écraser « completed » ni le reste', async () => {
    const result = await reapplyImportStatuses({ apply: true, log: silent });
    // Tous utilisateurs confondus : 2 pour Étienne + 1 pour l'autre compte.
    expect(result.applied).toBe(true);
    expect(result.usersScanned).toBe(2);
    expect(result.changes).toHaveLength(3);

    const statuses = await prisma.userMediaStatus.findMany({ where: { userId: etienneId }, include: { media: true } });
    const current = new Map(statuses.map((s) => [s.media.title, s]));
    expect(current.get('Vieille Série')?.status).toBe('abandoned');
    expect(current.get('Sans Identifiant')?.status).toBe('abandoned');
    // Jamais écrasé, et rien d'autre que le statut n'a bougé (note intacte).
    expect(current.get('Série Finie')?.status).toBe('completed');
    expect(current.get('Vieille Série')?.rating).toBe(6);

    const autre = await prisma.userMediaStatus.findFirst({ where: { userId: autreId }, include: { media: true } });
    expect(autre?.status).toBe('abandoned');
  });

  it('relance : plus rien à changer (idempotent)', async () => {
    const result = await reapplyImportStatuses({ log: silent });
    expect(result.changes).toHaveLength(0);
  });
});
