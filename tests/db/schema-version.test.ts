import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../apps/api/src/http/database';
import { assertSchemaCurrent, readMigrations, verifySchemaAtStartup } from '../../apps/api/src/http/migration-manifest';
import { startTestDatabase, type TestDatabase } from '../../apps/api/test/db/harness';
import { migrate } from '../../tools/migrate';

/**
 * N6 (AGENTS.md § 0.7 « ce qui est déployé se lit ») : en production, l'API
 * ne démarre que sur une base dont l'historique `ops.schema_migration` est
 * EXACTEMENT celui de ses migrations (mêmes noms, mêmes empreintes, même
 * nombre). Base en retard, en avance ou divergente : refus de démarrer
 * (`SCHEMA_VERSION_MISMATCH`). Lecture par le rôle `app_ro`, seul droit
 * accordé sur l'historique.
 */
const SOURCE = resolve(process.cwd(), 'db/migrations');
const DATABASE = 'molopay_schema_test';
const OWNER = 'molopay_migrate_owner';

let db: TestDatabase;
let admin: Client;
let ownerUrl: string;
let work: string;

function copyMigrations(count: number): string {
  const directory = mkdtempSync(join(work, 'migrations-'));
  cpSync(SOURCE, directory, { recursive: true });
  for (const file of readMigrations(directory).filter((m) => m.version > count)) rmSync(join(directory, file.name));
  return directory;
}

async function asAppRo<T>(action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    // Le propriétaire administre app_ro (il l'a créé, ou l'a reçu ici avec ADMIN) : il peut le prendre pour le test.
    await client.query('SET LOCAL ROLE app_ro');
    const result = await action(client);
    await client.query('ROLLBACK');
    return result;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  work = mkdtempSync(join(tmpdir(), 'molopay-schema-'));
  const owner = new URL(db.getConnectionUri());
  owner.pathname = `/${DATABASE}`;
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
  await admin.query(`GRANT app_ro TO ${OWNER} WITH ADMIN OPTION, INHERIT FALSE, SET TRUE`).catch(() => undefined);
});

describe('N6 — l’API ne démarre que sur le schéma exact de son code', () => {
  it('à jour : accepté ; app_ro lit l’historique et ne peut rien y écrire', async () => {
    const directory = copyMigrations(12);
    await migrate({ url: ownerUrl, directory });
    const files = readMigrations(directory);
    await expect(asAppRo((client) => assertSchemaCurrent(client, files))).resolves.toEqual({ version: 12 });
    await expect(asAppRo((client) => client.query(`INSERT INTO ops.schema_migration (version, name, sha256) VALUES (13, '0013_x.sql', decode(repeat('00', 32), 'hex'))`))).rejects.toThrow(/permission denied/);
  }, 300_000);

  it('refuse : base en retard (migrations non appliquées) → SCHEMA_VERSION_MISMATCH', async () => {
    await migrate({ url: ownerUrl, directory: copyMigrations(10) });
    await expect(asAppRo((client) => assertSchemaCurrent(client, readMigrations(copyMigrations(12))))).rejects.toThrow(/^SCHEMA_VERSION_MISMATCH: base en version 10, code en version 12/);
  }, 300_000);

  it('refuse : base en avance (code plus ancien que la base) → SCHEMA_VERSION_MISMATCH', async () => {
    await migrate({ url: ownerUrl, directory: copyMigrations(12) });
    await expect(asAppRo((client) => assertSchemaCurrent(client, readMigrations(copyMigrations(10))))).rejects.toThrow(/^SCHEMA_VERSION_MISMATCH: base en version 12, code en version 10/);
  }, 300_000);

  it('refuse : même version mais empreinte différente (migration réécrite) → SCHEMA_VERSION_MISMATCH', async () => {
    await migrate({ url: ownerUrl, directory: copyMigrations(12) });
    const rewritten = copyMigrations(12);
    const target = readMigrations(rewritten).find((file) => file.version === 7)?.name ?? '';
    writeFileSync(join(rewritten, target), readFileSync(join(rewritten, target), 'utf8').replace('BEGIN;', 'BEGIN;\n-- réécrite'));
    await expect(asAppRo((client) => assertSchemaCurrent(client, readMigrations(rewritten)))).rejects.toThrow(/^SCHEMA_VERSION_MISMATCH: 0007 diffère/);
  }, 300_000);

  it('refuse : base sans historique (non migrée par l’outil) → SCHEMA_VERSION_MISMATCH', async () => {
    await expect(asAppRo((client) => assertSchemaCurrent(client, readMigrations(SOURCE)))).rejects.toThrow(/^SCHEMA_VERSION_MISMATCH: historique des migrations absent ou illisible/);
  }, 300_000);

  it('démarrage : contrôlé en production (rôle app_ro, répertoire des migrations livré) ; ignoré hors production', async () => {
    const directory = copyMigrations(12);
    await migrate({ url: ownerUrl, directory: copyMigrations(10) });
    const database = createDatabase({ connectionString: ownerUrl, role: 'app_rw' });
    try {
      await expect(verifySchemaAtStartup(database, { NODE_ENV: 'production', MIGRATIONS_DIR: directory })).rejects.toThrow(/^SCHEMA_VERSION_MISMATCH: base en version 10, code en version 12/);
      await expect(verifySchemaAtStartup(database, { MIGRATIONS_DIR: directory })).resolves.toBeNull();
      await migrate({ url: ownerUrl, directory });
      await expect(verifySchemaAtStartup(database, { NODE_ENV: 'production', MIGRATIONS_DIR: directory })).resolves.toEqual({ version: 12 });
      await expect(verifySchemaAtStartup(database, { NODE_ENV: 'production', MIGRATIONS_DIR: join(work, 'absent') })).rejects.toThrow(/^SCHEMA_MANIFEST_MISSING/);
    } finally {
      await database.pool.end();
    }
  }, 300_000);
});
