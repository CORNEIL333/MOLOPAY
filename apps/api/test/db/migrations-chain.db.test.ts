import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * Chaîne complète des migrations, dans l'ordre, sur une base vierge : c'est
 * le chemin de la production. Chaque autre suite n'en charge qu'un
 * sous-ensemble ; celle-ci prouve que l'ensemble s'applique et reste cohérent.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = [
  'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api',
  'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger',
];

// Schémas en ajout seul par conception (registres financiers, décisions, traces).
// identity, notifications et api portent un état mutable légitime (sessions,
// compteurs, file d'envoi, idempotence), protégé autrement.
const APPEND_ONLY_SCHEMAS = [
  'ledger', 'audit', 'admin', 'catalog', 'agreements', 'payments',
  'reconciliation', 'disputes', 'settlement', 'risk',
];

let container: TestDatabase;
let admin: Client;
let files: string[];

beforeAll(async () => {
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  files = (await readdir(DIRECTORY)).filter((name) => name.endsWith('.sql')).sort();
}, 120_000);

afterAll(async () => {
  await admin.end();
  await container.stop();
});

describe('Migrations : chaîne complète et ordonnée', () => {
  it('numérotation continue à partir de 0001, sans doublon ni trou, noms en liste blanche', () => {
    const numbers = files.map((name) => {
      const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name);
      expect(match, name).not.toBeNull();
      return Number(match?.[1]);
    });
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });

  it('s’applique entièrement dans l’ordre sur une base vierge', async () => {
    for (const schema of SCHEMAS) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
    for (const name of files) {
      const sql = await readFile(resolve(DIRECTORY, name), 'utf8');
      await expect(admin.query(sql), name).resolves.toBeDefined();
    }
    const created = await admin.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[]) ORDER BY nspname`,
      [SCHEMAS],
    );
    expect(created.rows.map((row) => row.nspname)).toEqual([...SCHEMAS].sort());
  });

  it('I-2 aucune table métier n’accorde UPDATE, DELETE ou TRUNCATE aux rôles applicatifs', async () => {
    const grants = await admin.query<{ grantee: string; table_schema: string; table_name: string; privilege_type: string }>(
      `SELECT grantee, table_schema, table_name, privilege_type
         FROM information_schema.role_table_grants
        WHERE grantee IN ('app_rw', 'app_ro')
          AND table_schema = ANY($1::text[])
          AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
        ORDER BY 1, 2, 3, 4`,
      [SCHEMAS],
    );
    expect(grants.rows).toEqual([]);
  });

  it('I-2 toute table des schémas en ajout seul a un déclencheur toujours actif contre la modification', async () => {
    const unguarded = await admin.query<{ relation: string }>(
      `SELECT n.nspname || '.' || c.relname AS relation
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1 FROM pg_trigger t
             WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND t.tgenabled = 'A'
               AND (t.tgtype & 16) <> 0
          )
        ORDER BY 1`,
      [APPEND_ONLY_SCHEMAS],
    );
    expect(unguarded.rows).toEqual([]);
  });
});
