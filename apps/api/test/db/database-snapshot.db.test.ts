import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, withTransaction, type Database } from '../../src/http/database';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * Revue indépendante (mineur) : une lecture annoncée « instantané unique »
 * doit l'être. En READ COMMITTED, chaque requête voit les validations
 * intervenues entre-temps ; `readOnlySnapshot` fige l'instantané et interdit
 * toute écriture.
 */
let container: TestDatabase;
let admin: Client;
let database: Database;

beforeAll(async () => {
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS snapshot_probe CASCADE');
  await admin.query('CREATE SCHEMA snapshot_probe');
  await admin.query('CREATE TABLE snapshot_probe.item (id integer PRIMARY KEY)');
  database = createDatabase({ connectionString: container.getConnectionUri(), role: null });
}, 120_000);

afterAll(async () => {
  await admin.query('DROP SCHEMA IF EXISTS snapshot_probe CASCADE');
  await database.pool.end();
  await admin.end();
  await container.stop();
});

async function countTwiceAroundConcurrentInsert(options: { readonly readOnlySnapshot?: boolean }, id: number): Promise<[number, number]> {
  return withTransaction(database, async (client) => {
    const before = (await client.query<{ n: number }>('SELECT count(*)::int AS n FROM snapshot_probe.item')).rows[0]?.n ?? -1;
    await admin.query('INSERT INTO snapshot_probe.item (id) VALUES ($1)', [id]);
    const after = (await client.query<{ n: number }>('SELECT count(*)::int AS n FROM snapshot_probe.item')).rows[0]?.n ?? -1;
    return [before, after];
  }, options);
}

describe('lecture en instantané unique (goal-contributions)', () => {
  it('sans option (READ COMMITTED) : la seconde requête voit la validation concurrente', async () => {
    const [before, after] = await countTwiceAroundConcurrentInsert({}, 1);
    expect(after).toBe(before + 1);
  });

  it('readOnlySnapshot : même instantané pour toutes les requêtes', async () => {
    const [before, after] = await countTwiceAroundConcurrentInsert({ readOnlySnapshot: true }, 2);
    expect(after).toBe(before);
  });

  it('readOnlySnapshot : toute écriture refusée (25006)', async () => {
    const refused = await withTransaction(database, (client) => client.query('INSERT INTO snapshot_probe.item (id) VALUES (3)'), { readOnlySnapshot: true }).then(
      () => 'accepted',
      (error: { code?: string }) => error.code,
    );
    expect(refused).toBe('25006');
  });
});
