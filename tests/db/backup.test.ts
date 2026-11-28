import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { localKeyWrapper } from '../../apps/api/src/crypto/envelope';
import { startTestDatabase, type TestDatabase } from '../../apps/api/test/db/harness';
import { runRealFlowsScenario } from '../../apps/api/test/db/real-flows-scenario';
import { backupDatabase, backupKeyWrapperFromEnv, decryptBackupFile, encryptBackupFile, restoreBackup } from '../../tools/backup';

/**
 * N4 (ADR-0004 : « notre propre copie quotidienne, chiffrée par nos clés,
 * dans une seconde région AWS ; elle est aussi la porte de sortie ») : la
 * copie est produite et chiffrée sans jamais laisser de clair sur disque ;
 * toute altération, troncature ou mauvaise clé est refusée ; la restauration
 * dans une base vide redonne exactement le même contenu, mêmes déclencheurs
 * et mêmes droits, grand livre équilibré et sans trou.
 */
const PG_BIN = process.env['TRANSFER_PG_BIN'] ?? '/usr/lib/postgresql/16/bin';
const TARGET_DB = 'molopay_backup_target';

let db: TestDatabase;
let admin: Client;
let sourceUrl: string;
let targetUrl: string;
let work: string;
const MASTER = randomBytes(32);

beforeAll(async () => {
  db = await startTestDatabase();
  sourceUrl = db.getConnectionUri();
  const target = new URL(sourceUrl);
  target.pathname = `/${TARGET_DB}`;
  targetUrl = target.toString();
  admin = new Client({ connectionString: sourceUrl });
  await admin.connect();
  await runRealFlowsScenario(sourceUrl, admin);
}, 600_000);

afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${TARGET_DB} WITH (FORCE)`);
  await admin.end();
  await db.stop();
});

beforeEach(async () => {
  work = mkdtempSync(join(tmpdir(), 'molopay-backup-test-'));
  await admin.query(`DROP DATABASE IF EXISTS ${TARGET_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TARGET_DB}`);
});

describe('N4 — copie quotidienne chiffrée par nos clés, restaurable et vérifiée', () => {
  it('copie puis restauration dans une base vide : contenu, déclencheurs, droits identiques ; grand livre intact', async () => {
    const wrapper = localKeyWrapper(MASTER);
    const backup = await backupDatabase({ sourceUrl, outDirectory: work, wrapper, pgBin: PG_BIN, now: new Date('2026-11-26T02:00:00Z') });
    expect(backup.file).toMatch(/molopay-20261126T020000Z\.dump\.enc$/);
    expect(backup.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Rien d'autre que la copie chiffrée et son empreinte dans le répertoire de sortie : aucun clair.
    expect(readdirSync(work).sort()).toEqual(['molopay-20261126T020000Z.dump.enc', 'molopay-20261126T020000Z.dump.enc.sha256']);
    expect(readFileSync(`${backup.file}.sha256`, 'utf8')).toBe(`${backup.sha256}  molopay-20261126T020000Z.dump.enc\n`);
    // Le format de pg_dump (« PGDMP ») et les noms de tables n'apparaissent pas dans le chiffré.
    const sealed = readFileSync(backup.file);
    expect(sealed.includes(Buffer.from('PGDMP'))).toBe(false);
    expect(sealed.includes(Buffer.from('journal_entry'))).toBe(false);

    const report = await restoreBackup({ file: backup.file, targetUrl, wrapper, pgBin: PG_BIN, sourceUrlForComparison: sourceUrl });
    expect(report.mismatches).toEqual([]);
    expect(report.status).toBe('VERIFIED');
    expect(report.rows).toBeGreaterThan(0);
  }, 600_000);

  it('refuse : octet modifié, copie tronquée, mauvaise clé (BACKUP_INTEGRITY_FAILED), sans clair laissé', async () => {
    const wrapper = localKeyWrapper(MASTER);
    const plain = join(work, 'plain.bin');
    const sealed = join(work, 'plain.bin.enc');
    const data = randomBytes(3 * 1024 * 1024 + 17);
    writeFileSync(plain, data);
    await encryptBackupFile(plain, sealed, wrapper);
    const roundTrip = join(work, 'retour.bin');
    await decryptBackupFile(sealed, roundTrip, wrapper);
    expect(readFileSync(roundTrip).equals(data)).toBe(true);

    const bytes = readFileSync(sealed);
    const flipped = Buffer.from(bytes);
    flipped[flipped.length - 40] = (flipped[flipped.length - 40] ?? 0) ^ 1;
    writeFileSync(join(work, 'altere.enc'), flipped);
    await expect(decryptBackupFile(join(work, 'altere.enc'), join(work, 'x1'), wrapper)).rejects.toThrow(/^BACKUP_INTEGRITY_FAILED/);
    writeFileSync(join(work, 'tronque.enc'), bytes.subarray(0, bytes.length - 1024 * 1024));
    await expect(decryptBackupFile(join(work, 'tronque.enc'), join(work, 'x2'), wrapper)).rejects.toThrow(/^BACKUP_INTEGRITY_FAILED/);
    await expect(decryptBackupFile(sealed, join(work, 'x3'), localKeyWrapper(randomBytes(32)))).rejects.toThrow(/^BACKUP_INTEGRITY_FAILED/);
    // Troncature exacte au dernier bloc (5 octets d'en-tête de bloc + 17 octets + étiquette de 16) : l'indicateur de fin manque.
    writeFileSync(join(work, 'sans-fin.enc'), bytes.subarray(0, bytes.length - (5 + 17 + 16)));
    await expect(decryptBackupFile(join(work, 'sans-fin.enc'), join(work, 'x4'), wrapper)).rejects.toThrow(/^BACKUP_INTEGRITY_FAILED/);
    // Octets ajoutés après le dernier bloc : refusés.
    writeFileSync(join(work, 'rallonge.enc'), Buffer.concat([bytes, Buffer.from([0])]));
    await expect(decryptBackupFile(join(work, 'rallonge.enc'), join(work, 'x5'), wrapper)).rejects.toThrow(/^BACKUP_INTEGRITY_FAILED/);
    // Un déchiffrement refusé ne laisse aucun fichier de sortie partiel.
    for (const name of ['x1', 'x2', 'x3', 'x4', 'x5', 'x1.partial', 'x4.partial']) expect(readdirSync(work)).not.toContain(name);
  });

  it('refuse : restauration dans une base non vide (TARGET_NOT_EMPTY) ; source distante sans TLS vérifié', async () => {
    const wrapper = localKeyWrapper(MASTER);
    const backup = await backupDatabase({ sourceUrl, outDirectory: work, wrapper, pgBin: PG_BIN, now: new Date('2026-11-26T03:00:00Z') });
    await expect(restoreBackup({ file: backup.file, targetUrl: sourceUrl, wrapper, pgBin: PG_BIN })).rejects.toThrow(/^TARGET_NOT_EMPTY/);
    await expect(backupDatabase({ sourceUrl: 'postgresql://u@ep-x.eu-central-1.aws.neon.tech/db?sslmode=require', outDirectory: work, wrapper, pgBin: PG_BIN })).rejects.toThrow(/^DATABASE_TLS_REQUIRED/);
    await expect(backupDatabase({ sourceUrl: 'postgresql://u@ep-x-pooler.eu-central-1.aws.neon.tech/db?sslmode=verify-full', outDirectory: work, wrapper, pgBin: PG_BIN })).rejects.toThrow(/^DATABASE_POOLER_FORBIDDEN/);
  }, 600_000);

  it('clé : AWS KMS (clé distincte de celle des données personnelles) en production ; clé locale refusée en production', () => {
    expect(() => backupKeyWrapperFromEnv({ NODE_ENV: 'production', BACKUP_LOCAL_MASTER_KEY: MASTER.toString('hex') })).toThrow(/^BACKUP_LOCAL_KEY_FORBIDDEN_IN_PRODUCTION/);
    expect(() => backupKeyWrapperFromEnv({ NODE_ENV: 'production' })).toThrow(/^BACKUP_KEY_MISSING/);
    expect(() => backupKeyWrapperFromEnv({ BACKUP_KMS_KEY_ARN: 'arn:aws:kms:eu-central-1:123456789012:key/00000000-0000-0000-0000-000000000000', PII_KMS_KEY_ARN: 'arn:aws:kms:eu-central-1:123456789012:key/00000000-0000-0000-0000-000000000000' })).toThrow(/^BACKUP_KEY_NOT_DISTINCT/);
    expect(backupKeyWrapperFromEnv({ BACKUP_KMS_KEY_ARN: 'arn:aws:kms:eu-central-1:123456789012:key/11111111-1111-1111-1111-111111111111' }).keyId).toContain('11111111');
    expect(backupKeyWrapperFromEnv({ BACKUP_LOCAL_MASTER_KEY: MASTER.toString('hex') }).keyId).toBe('local');
  });
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});
