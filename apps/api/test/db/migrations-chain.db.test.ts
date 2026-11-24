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
  'crm', 'kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api',
  'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger',
];

// Schémas en ajout seul par conception (registres financiers, décisions, traces).
// identity, notifications et api portent un état mutable légitime (sessions,
// compteurs, file d'envoi, idempotence), protégé autrement.
const APPEND_ONLY_SCHEMAS = [
  'ledger', 'audit', 'admin', 'catalog', 'agreements', 'payments',
  'reconciliation', 'disputes', 'settlement', 'risk', 'kyc', 'crm',
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

  it('F-BO-002 aucun rôle interne ne modifie ni ne supprime une écriture du grand livre (droits et tentative réelle, propriétaire compris)', async () => {
    // Tous les rôles non superutilisateurs de la base, y compris ceux ajoutés plus tard (liste dynamique).
    const roles = (await admin.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname !~ '^pg_' AND NOT rolsuper ORDER BY 1`,
    )).rows.map((row) => row.rolname);
    expect(roles).toEqual(expect.arrayContaining(['app_ro', 'app_rw']));
    const tables = (await admin.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ledger' AND c.relkind = 'r' ORDER BY 1`,
    )).rows.map((row) => row.relname);
    expect(tables).toEqual(expect.arrayContaining(['journal_entry', 'posting']));
    const granted = await admin.query<{ role: string; relation: string; privilege: string }>(
      `SELECT r.role, t.relation, p.privilege
         FROM unnest($1::text[]) AS r(role), unnest($2::text[]) AS t(relation), unnest(ARRAY['UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)
        WHERE has_table_privilege(r.role, 'ledger.' || quote_ident(t.relation), p.privilege)`,
      [roles, tables],
    );
    expect(granted.rows).toEqual([]);
    const attempt = async (role: string | null, sql: string): Promise<string> => {
      await admin.query('BEGIN');
      try {
        if (role !== null) await admin.query(`SET LOCAL ROLE ${role}`);
        await admin.query(sql);
        return 'accepted';
      } catch (error) {
        return `${(error as { code?: string }).code ?? ''} ${(error as Error).message}`;
      } finally {
        await admin.query('ROLLBACK');
      }
    };
    for (const role of roles) {
      for (const table of tables) {
        for (const sql of [`UPDATE ledger.${table} SET id = id`, `DELETE FROM ledger.${table}`, `TRUNCATE ledger.${table}`]) {
          expect(await attempt(role, sql), `${role} · ${sql}`).toMatch(/^42501 permission denied/);
        }
      }
    }
    // Même le propriétaire du schéma (migrations) est arrêté par les déclencheurs : seule la contre-passation corrige.
    // Ici le grand livre est vide (TRUNCATE : déclencheur d'instruction ; `journal_entry`, référencée par
    // d'autres schémas, est en outre protégée par ses clés étrangères) ; UPDATE et DELETE d'une écriture
    // existante par le propriétaire sont prouvés par les tests INT-LED-003 de `ledger.db.test.ts`.
    expect(await attempt(null, 'TRUNCATE ledger.posting'), 'propriétaire · TRUNCATE posting').toMatch(/^P0001 LEDGER_APPEND_ONLY/);
  });

  it('REG-LBC-004 la boîte d’envoi vers le client n’accepte que des types d’événements métier ; aucun ne relève d’un filtrage ou d’un soupçon', async () => {
    const checks = (await admin.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
        WHERE c.conrelid = 'notifications.outbox'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%event_type%'`,
    )).rows.map((row) => row.definition);
    expect(checks).toHaveLength(1);
    const types = [...(checks[0] ?? '').matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]).sort();
    expect(types).toEqual(['DISPUTE_UPDATED', 'GOAL_FUNDED', 'HANDOVER_READY', 'PAYMENT_CONFIRMED', 'PAYMENT_REMINDER', 'SETTLEMENT_CONFIRMED']);
    await admin.query('BEGIN');
    try {
      const refused = await admin.query(
        `INSERT INTO notifications.outbox (recipient_id, event_key, channel, event_type, locale, created_at)
         VALUES ('0192f6a0-0000-7000-8000-000000000001', '0192f6a0-0000-7000-8000-000000000002', 'SMS', 'SCREENING_MATCH', 'fr', now())`,
      ).then(() => 'accepted', (error: { code?: string }) => error.code ?? '');
      expect(refused).toBe('23514');
    } finally {
      await admin.query('ROLLBACK');
    }
  });
});

