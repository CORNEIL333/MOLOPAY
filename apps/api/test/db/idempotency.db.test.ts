import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/http/database';
import { runIdempotent } from '../../src/http/idempotency';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATION = resolve(process.cwd(), 'db/migrations/0017_api_idempotency.sql');
const KEY = 'cle-idempotence-0001';
const SCOPE = 'customer:019a9400-0000-7000-8000-0000000000a1:POST:/v1/goals';

let container: TestDatabase;
let admin: Client;
let database: Database;
let migrationSql: string;

/** Commande de test : un effet observable par ligne insérée. */
async function effectCount(): Promise<number> {
  const result = await admin.query<{ n: string }>('SELECT count(*)::text AS n FROM test_effect');
  return Number(result.rows[0]?.n ?? '-1');
}

function command(label: string, options: { readonly fail?: boolean } = {}) {
  return async (client: { query: Client['query'] }) => {
    await client.query('INSERT INTO test_effect (label) VALUES ($1)', [label]);
    if (options.fail === true) {
      throw new BusinessError('AGREEMENT_PLAN_MISMATCH', 'échec métier simulé par le test');
    }
    return { status: 201, body: { label, amountXaf: '9007199254740993' } };
  };
}

async function catchFailure(action: () => Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await action();
  } catch (error: unknown) {
    const failure = error as { code?: string; message?: string };
    return { ...(failure.code === undefined ? {} : { code: failure.code }), message: failure.message ?? '' };
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

beforeAll(async () => {
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  migrationSql = await readFile(MIGRATION, 'utf8');
  database = createDatabase({ connectionString: container.getConnectionUri(), role: 'app_rw' });
}, 120_000);

afterAll(async () => {
  await database.pool.end();
  await admin.end();
  await container.stop();
});

beforeEach(async () => {
  await admin.query('DROP SCHEMA IF EXISTS api CASCADE');
  await admin.query('DROP TABLE IF EXISTS test_effect');
  await admin.query(migrationSql);
  await admin.query('CREATE TABLE test_effect (id serial PRIMARY KEY, label text NOT NULL)');
  await admin.query('GRANT SELECT, INSERT ON test_effect TO app_rw');
  await admin.query('GRANT USAGE ON SEQUENCE test_effect_id_seq TO app_rw');
});

describe('INT-IDEM-001 · clés d’idempotence (PostgreSQL réel)', () => {
  it('INT-IDEM-001 exécute une fois puis rejoue la réponse d’origine', async () => {
    const request = { offerId: 'offre-1' };
    const first = await runIdempotent(database, { scope: SCOPE, key: KEY, request }, command('a'));
    const second = await runIdempotent(database, { scope: SCOPE, key: KEY, request }, command('b'));
    expect(first).toEqual({ status: 201, body: { label: 'a', amountXaf: '9007199254740993' }, replayed: false });
    expect(second).toEqual({ status: 201, body: { label: 'a', amountXaf: '9007199254740993' }, replayed: true });
    expect(await effectCount()).toBe(1);
  });

  it('INT-IDEM-001 refuse la même clé avec un autre contenu → IDEMPOTENCY_KEY_REUSED', async () => {
    await runIdempotent(database, { scope: SCOPE, key: KEY, request: { offerId: 'offre-1' } }, command('a'));
    const failure = await catchFailure(() =>
      runIdempotent(database, { scope: SCOPE, key: KEY, request: { offerId: 'offre-2' } }, command('b')),
    );
    expect(failure.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await effectCount()).toBe(1);
  });

  it('INT-IDEM-001 dix requêtes simultanées avec la même clé : un seul effet', async () => {
    const request = { offerId: 'offre-1' };
    const results = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        runIdempotent(database, { scope: SCOPE, key: KEY, request }, command(`r${index.toString()}`)),
      ),
    );
    expect(await effectCount()).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    const bodies = new Set(results.map((result) => JSON.stringify(result.body)));
    expect(bodies.size).toBe(1);
  });

  it('INT-IDEM-001 un échec ne consomme pas la clé : le rejeu réexécute', async () => {
    const request = { offerId: 'offre-1' };
    const failure = await catchFailure(() =>
      runIdempotent(database, { scope: SCOPE, key: KEY, request }, command('a', { fail: true })),
    );
    expect(failure.code).toBe('AGREEMENT_PLAN_MISMATCH');
    expect(await effectCount()).toBe(0);
    const retry = await runIdempotent(database, { scope: SCOPE, key: KEY, request }, command('b'));
    expect(retry.replayed).toBe(false);
    expect(await effectCount()).toBe(1);
  });

  it('INT-IDEM-001 la portée isole les appelants', async () => {
    const request = { offerId: 'offre-1' };
    await runIdempotent(database, { scope: SCOPE, key: KEY, request }, command('a'));
    const other = await runIdempotent(
      database,
      { scope: 'customer:019a9400-0000-7000-8000-0000000000b2:POST:/v1/goals', key: KEY, request },
      command('b'),
    );
    expect(other.replayed).toBe(false);
    expect(await effectCount()).toBe(2);
  });

  it.each([
    ['absente', undefined],
    ['trop courte', 'court'],
    ['avec espace', 'cle avec des espaces 01'],
    ['trop longue', 'x'.repeat(129)],
  ])('INT-IDEM-001 refuse une clé %s → REQUEST_INVALID', async (_label, key) => {
    const failure = await catchFailure(() =>
      runIdempotent(database, { scope: SCOPE, key: key as string, request: {} }, command('a')),
    );
    expect(failure.code).toBe('REQUEST_INVALID');
    expect(await effectCount()).toBe(0);
  });
});

describe('INT-IDEM-001 · registre protégé par la base (PostgreSQL réel)', () => {
  async function asAppRw(sql: string): Promise<{ code?: string; message: string }> {
    return catchFailure(async () => {
      const client = await database.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE app_rw');
        await client.query(sql);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }

  it('refuse de réécrire une réponse enregistrée', async () => {
    await runIdempotent(database, { scope: SCOPE, key: KEY, request: {} }, command('a'));
    const failure = await asAppRw(
      `UPDATE api.idempotency_record SET response_status = 200, response_body = '{}'::jsonb, completed_at = now()`,
    );
    expect(failure.message).toContain('IDEMPOTENCY_KEY_REUSED');
  });

  it('refuse suppression et troncature, même au propriétaire', async () => {
    await runIdempotent(database, { scope: SCOPE, key: KEY, request: {} }, command('a'));
    for (const sql of ['DELETE FROM api.idempotency_record', 'TRUNCATE api.idempotency_record']) {
      await expect(admin.query(sql)).rejects.toMatchObject({
        message: expect.stringContaining('REQUEST_INVALID') as unknown,
      });
    }
  });

  it('refuse une clé créée avec une réponse préremplie', async () => {
    const failure = await asAppRw(
      `INSERT INTO api.idempotency_record
         (scope, idempotency_key, request_hash, response_status, response_body, created_at, completed_at)
       VALUES ('s', 'cle-idempotence-0002', decode(repeat('00', 32), 'hex'), 201, '{}'::jsonb, now(), now())`,
    );
    expect(failure.message).toContain('REQUEST_INVALID');
  });
});
