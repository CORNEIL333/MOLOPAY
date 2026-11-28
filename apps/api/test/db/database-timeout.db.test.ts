import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, withTransaction, type Database } from '../../src/http/database';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * Neon (production) : une requête qui dépasse la limite est interrompue par la
 * base (code 57014) au lieu de bloquer une connexion ; la limite est posée par
 * `SET LOCAL` dans chaque transaction, donc valable aussi derrière le
 * regroupeur de connexions de Neon.
 */
let db: TestDatabase;
let database: Database;

beforeAll(async () => {
  db = await startTestDatabase();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: null, poolMax: 2, statementTimeoutMs: 1000 });
});

afterAll(async () => {
  await database.pool.end();
  await db.stop();
});

describe('limite de durée des requêtes (statement_timeout par transaction)', () => {
  it('une requête trop longue est interrompue (57014) ; la suivante passe ; la limite ne fuit pas hors transaction', async () => {
    await expect(withTransaction(database, (client) => client.query('SELECT pg_sleep(2)'))).rejects.toMatchObject({ code: '57014' });
    expect(await withTransaction(database, async (client) => (await client.query<{ timeout: string }>("SELECT current_setting('statement_timeout') AS timeout")).rows[0]?.timeout)).toBe('1s');
    const client = await database.pool.connect();
    try {
      expect((await client.query<{ timeout: string }>("SELECT current_setting('statement_timeout') AS timeout")).rows[0]?.timeout).toBe('0');
    } finally {
      client.release();
    }
  }, 30_000);
});
