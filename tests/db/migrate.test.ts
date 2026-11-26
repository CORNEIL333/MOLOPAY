import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../../apps/api/test/db/harness';
import { migrate, readMigrations } from '../../tools/migrate';

/**
 * N1 (ADR-0004, Neon) : `pnpm db:migrate`. Chaque migration est appliquée et
 * inscrite dans `ops.schema_migration` (empreinte SHA-256) dans la MÊME
 * transaction ; une migration déjà appliquée puis modifiée, retirée ou
 * renumérotée bloque tout ; un échec n'inscrit rien ; deux exécutions
 * simultanées n'appliquent rien deux fois. Vérifié aussi sous un propriétaire
 * sans superutilisateur (droits du propriétaire Neon : CREATEROLE, CREATEDB).
 */
const SOURCE = resolve(process.cwd(), 'db/migrations');
const DATABASE = 'molopay_migrate_test';
const OWNER = 'molopay_migrate_owner';

let db: TestDatabase;
let admin: Client;
let url: string;
let ownerUrl: string;
let work: string;

function copyMigrations(count?: number): string {
  const directory = mkdtempSync(join(work, 'migrations-'));
  cpSync(SOURCE, directory, { recursive: true });
  if (count !== undefined) {
    for (const file of readMigrations(directory).filter((m) => m.version > count)) rmSync(join(directory, file.name));
  }
  return directory;
}

async function rows(target: string): Promise<{ version: number; name: string; sha256: string }[]> {
  const client = new Client({ connectionString: target });
  await client.connect();
  try {
    return (await client.query<{ version: number; name: string; sha256: string }>(`SELECT version, name, encode(sha256, 'hex') AS sha256 FROM ops.schema_migration ORDER BY version`)).rows;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  work = mkdtempSync(join(tmpdir(), 'molopay-migrate-'));
  const base = new URL(db.getConnectionUri());
  base.pathname = `/${DATABASE}`;
  url = base.toString();
  const owner = new URL(url);
  owner.username = OWNER;
  owner.password = '';
  ownerUrl = owner.toString();
}, 300_000);

afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
  await admin.end();
  await db.stop();
  rmSync(work, { recursive: true, force: true });
});

beforeEach(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
  await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${OWNER}') THEN CREATE ROLE ${OWNER} LOGIN NOSUPERUSER CREATEROLE CREATEDB; END IF; END $$`);
  await admin.query(`CREATE DATABASE ${DATABASE} OWNER ${OWNER}`);
});

describe('N1 — outil de migration (Neon, rôle sans superutilisateur)', () => {
  it('lecture : toutes les migrations du dépôt sont au format attendu, numérotées sans trou', () => {
    const files = readMigrations(SOURCE);
    expect(files.length).toBeGreaterThanOrEqual(77);
    expect(files.map((file) => file.version)).toEqual(files.map((_, index) => index + 1));
    for (const file of files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('base vide, propriétaire sans superutilisateur : tout est appliqué et inscrit, puis plus rien', async () => {
    const isSuper = (await admin.query<{ rolsuper: boolean }>('SELECT rolsuper FROM pg_roles WHERE rolname = $1', [OWNER])).rows[0]?.rolsuper;
    expect(isSuper).toBe(false);
    const files = readMigrations(SOURCE);
    const first = await migrate({ url: ownerUrl, directory: SOURCE });
    expect(first).toMatchObject({ status: 'APPLIED', current: files.length });
    expect(first.applied).toEqual(files.map((file) => file.version));
    const recorded = await rows(ownerUrl);
    expect(recorded).toEqual(files.map((file) => ({ version: file.version, name: file.name, sha256: file.sha256 })));
    expect(await migrate({ url: ownerUrl, directory: SOURCE })).toEqual({ status: 'UP_TO_DATE', applied: [], pending: [], current: files.length });
    // Les protections sont bien en place sous ce propriétaire (exemple : grand livre en ajout seul).
    const client = new Client({ connectionString: ownerUrl });
    await client.connect();
    try {
      await expect(client.query('TRUNCATE ledger.journal_entry CASCADE')).rejects.toThrow(/LEDGER_APPEND_ONLY/);
    } finally {
      await client.end();
    }
  }, 300_000);

  it('applique seulement les nouvelles migrations ; simulation : liste sans rien appliquer', async () => {
    await migrate({ url: ownerUrl, directory: copyMigrations(70) });
    const all = readMigrations(SOURCE).length;
    const planned = await migrate({ url: ownerUrl, directory: SOURCE, dryRun: true });
    expect(planned).toMatchObject({ status: 'PENDING', applied: [], current: 70 });
    expect(planned.pending).toEqual(Array.from({ length: all - 70 }, (_, index) => 71 + index));
    expect((await rows(ownerUrl)).length).toBe(70);
    expect(await migrate({ url: ownerUrl, directory: SOURCE })).toMatchObject({ status: 'APPLIED', applied: planned.pending, current: all });
  }, 300_000);

  it('refuse : une migration déjà appliquée puis modifiée (MIGRATION_CHECKSUM_MISMATCH), rien n’est appliqué', async () => {
    await migrate({ url: ownerUrl, directory: copyMigrations(10) });
    const tampered = copyMigrations(12);
    const target = readMigrations(tampered).find((file) => file.version === 5);
    writeFileSync(join(tampered, target?.name ?? ''), readFileSync(join(tampered, target?.name ?? ''), 'utf8').replace('BEGIN;', 'BEGIN;\n-- modifiée après coup'));
    await expect(migrate({ url: ownerUrl, directory: tampered })).rejects.toThrow(/^MIGRATION_CHECKSUM_MISMATCH: 0005/);
    expect((await rows(ownerUrl)).length).toBe(10);
  }, 300_000);

  it('refuse : migration appliquée absente du dépôt ou renommée (MIGRATION_UNKNOWN_APPLIED)', async () => {
    await migrate({ url: ownerUrl, directory: copyMigrations(10) });
    await expect(migrate({ url: ownerUrl, directory: copyMigrations(8) })).rejects.toThrow(/^MIGRATION_UNKNOWN_APPLIED: 0009/);
    const renamed = copyMigrations(10);
    const file = readMigrations(renamed).find((m) => m.version === 10)?.name ?? '';
    cpSync(join(renamed, file), join(renamed, '0010_autre_nom.sql'));
    rmSync(join(renamed, file));
    await expect(migrate({ url: ownerUrl, directory: renamed })).rejects.toThrow(/^MIGRATION_UNKNOWN_APPLIED: 0010/);
  }, 300_000);

  it('refuse : base distante sans TLS vérifié, avant toute connexion (DATABASE_TLS_REQUIRED)', async () => {
    await expect(migrate({ url: 'postgresql://owner@ep-exemple.eu-central-1.aws.neon.tech/molopay?sslmode=require', directory: SOURCE })).rejects.toThrow(/^DATABASE_TLS_REQUIRED/);
  });

  it('refuse : trou de numérotation ou fichier hors format, avant toute connexion', () => {
    const gap = copyMigrations(10);
    const file = readMigrations(gap).find((m) => m.version === 7)?.name ?? '';
    rmSync(join(gap, file));
    expect(() => readMigrations(gap)).toThrow(/^MIGRATION_SEQUENCE_GAP: 0007/);
    const noTransaction = copyMigrations(3);
    writeFileSync(join(noTransaction, '0004_sans_transaction.sql'), 'CREATE TABLE x (id int);\n');
    expect(() => readMigrations(noTransaction)).toThrow(/^MIGRATION_FORMAT_INVALID: 0004/);
    const twoTransactions = copyMigrations(3);
    writeFileSync(join(twoTransactions, '0004_deux.sql'), 'BEGIN;\nSELECT 1;\nCOMMIT;\nBEGIN;\nSELECT 2;\nCOMMIT;\n');
    expect(() => readMigrations(twoTransactions)).toThrow(/^MIGRATION_FORMAT_INVALID: 0004/);
    const badName = copyMigrations(3);
    writeFileSync(join(badName, '4_Mauvais Nom.sql'), 'BEGIN;\nSELECT 1;\nCOMMIT;\n');
    expect(() => readMigrations(badName)).toThrow(/^MIGRATION_FORMAT_INVALID/);
  });

  it('échec en cours : la migration fautive n’est ni appliquée ni inscrite, les précédentes restent', async () => {
    const failing = copyMigrations(3);
    writeFileSync(join(failing, '0004_echec.sql'), 'BEGIN;\nCREATE TABLE ledger.temporaire (id int);\nSELECT 1/0;\nCOMMIT;\n');
    await expect(migrate({ url: ownerUrl, directory: failing })).rejects.toThrow(/^MIGRATION_FAILED: 0004/);
    expect((await rows(ownerUrl)).map((row) => row.version)).toEqual([1, 2, 3]);
    const client = new Client({ connectionString: ownerUrl });
    await client.connect();
    try {
      expect((await client.query(`SELECT to_regclass('ledger.temporaire') AS t`)).rows[0]).toEqual({ t: null });
    } finally {
      await client.end();
    }
  }, 300_000);

  it('atomicité : si l’inscription dans l’historique échoue, la migration elle-même est annulée', async () => {
    const failing = copyMigrations(3);
    await migrate({ url: ownerUrl, directory: failing });
    writeFileSync(join(failing, '0004_inscription_refusee.sql'), [
      'BEGIN;',
      'CREATE TABLE ledger.atomicite (id int);',
      "CREATE FUNCTION ops.refuse_inscription() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INSCRIPTION_REFUSEE'; END $$;",
      'CREATE TRIGGER refuse_inscription BEFORE INSERT ON ops.schema_migration FOR EACH ROW EXECUTE FUNCTION ops.refuse_inscription();',
      'COMMIT;',
      '',
    ].join('\n'));
    await expect(migrate({ url: ownerUrl, directory: failing })).rejects.toThrow(/^MIGRATION_FAILED: 0004.*INSCRIPTION_REFUSEE/);
    const client = new Client({ connectionString: ownerUrl });
    await client.connect();
    try {
      expect((await client.query(`SELECT to_regclass('ledger.atomicite') AS t`)).rows[0]).toEqual({ t: null });
    } finally {
      await client.end();
    }
    expect((await rows(ownerUrl)).map((row) => row.version)).toEqual([1, 2, 3]);
  }, 300_000);

  it('deux exécutions simultanées : chaque migration n’est appliquée qu’une fois', async () => {
    const directory = copyMigrations(20);
    const [a, b] = await Promise.all([migrate({ url: ownerUrl, directory }), migrate({ url: ownerUrl, directory })]);
    expect([...a.applied, ...b.applied].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect((await rows(ownerUrl)).length).toBe(20);
  }, 300_000);

  it('refuse : base déjà peuplée sans historique (MIGRATION_BASELINE_REQUIRED) ; historique en ajout seul', async () => {
    const client = new Client({ connectionString: ownerUrl });
    await client.connect();
    try {
      await client.query('CREATE SCHEMA ledger');
      await expect(migrate({ url: ownerUrl, directory: SOURCE })).rejects.toThrow(/^MIGRATION_BASELINE_REQUIRED/);
      await client.query('DROP SCHEMA ledger');
      await migrate({ url: ownerUrl, directory: copyMigrations(2) });
      await expect(client.query('UPDATE ops.schema_migration SET name = name')).rejects.toThrow(/OPS_APPEND_ONLY/);
      await expect(client.query('DELETE FROM ops.schema_migration')).rejects.toThrow(/OPS_APPEND_ONLY/);
      await expect(client.query(`INSERT INTO ops.schema_migration (version, name, sha256) VALUES (9, '0009_x.sql', decode(repeat('00', 32), 'hex'))`)).rejects.toThrow(/OPS_MIGRATION_SEQUENCE/);
    } finally {
      await client.end();
    }
  }, 300_000);
});
