import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startTestDatabase, type TestDatabase } from './harness';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../../src/modules/audit/domain';
import {
  appendAuditEvent,
  listAuditEvents,
} from '../../src/modules/audit/audit.store';

const MIGRATION_PATH = resolve(
  process.cwd(),
  'db/migrations/0002_audit.sql',
);
const METADATA_MIGRATION_PATH = resolve(
  process.cwd(),
  'db/migrations/0005_audit_metadata.sql',
);

const CATALOG_MIGRATION_PATH = resolve(
  process.cwd(),
  'db/migrations/0010_audit_catalog.sql',
);

const ZERO_HASH = Buffer.alloc(32);

type SeedEvent = {
  readonly seq: number;
  readonly id: string;
  readonly eventType?: string;
  readonly reason?: string | null;
  readonly refs?: string;
  readonly prevHash: Buffer;
  readonly eventHash: Buffer;
};

let container: TestDatabase;
let admin: Client;
let pool: Pool;
let migrationSql: string;
let metadataMigrationSql: string;
let catalogMigrationSql: string;

function uuid(seq: number): string {
  return `019a2000-0000-7000-8000-${seq.toString().padStart(12, '0')}`;
}

async function transact<T>(
  role: 'app_rw' | 'app_ro' | null,
  action: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (role !== null) {
      await client.query(`SET LOCAL ROLE ${role}`);
    }
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function insertEvent(client: Client, seed: SeedEvent): Promise<void> {
  await client.query(
    `INSERT INTO audit.event
       (seq, id, recorded_at, event_type, actor_id, action, target_type,
        target_id, outcome, reason, refs, prev_hash, event_hash)
     VALUES ($1, $2, now(), $3, 'admin-1', 'TEST_ACTION', 'SESSION', 'sess-1',
             'SUCCESS', $4, $5::jsonb, $6, $7)`,
    [
      seed.seq,
      seed.id,
      seed.eventType ?? 'AUTH_LOGIN',
      seed.reason ?? null,
      seed.refs ?? '{}',
      seed.prevHash,
      seed.eventHash,
    ],
  );
}

async function catchFailure(action: () => Promise<unknown>): Promise<{
  code: string | undefined;
  message: string;
}> {
  try {
    await action();
  } catch (error: unknown) {
    const failure = error as { code?: string; message?: string };
    return { code: failure.code, message: failure.message ?? '' };
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

beforeAll(async () => {
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  migrationSql = await readFile(MIGRATION_PATH, 'utf8');
  metadataMigrationSql = await readFile(METADATA_MIGRATION_PATH, 'utf8');
  catalogMigrationSql = await readFile(CATALOG_MIGRATION_PATH, 'utf8');
}, 120_000);

afterAll(async () => {
  await admin.end();
  await pool.end();
  await container.stop();
});

beforeEach(async () => {
  await admin.query('DROP SCHEMA IF EXISTS audit CASCADE');
  await admin.query(migrationSql);
  await admin.query(metadataMigrationSql);
});

describe('journal d’audit · chaîne et ajout seul (base réelle)', () => {
  it('accepte un premier événement à la séquence 1 avec prev_hash nul', async () => {
    await transact('app_rw', async (client) => {
      await insertEvent(client, {
        seq: 1,
        id: uuid(1),
        prevHash: ZERO_HASH,
        eventHash: Buffer.alloc(32, 1),
      });
    });
    const rows = await admin.query<{ seq: string }>(
      'SELECT seq FROM audit.event ORDER BY seq',
    );
    expect(rows.rows.map((row) => Number(row.seq))).toEqual([1]);
  });

  it('refuse un premier événement hors séquence 1', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        insertEvent(client, {
          seq: 2,
          id: uuid(2),
          prevHash: ZERO_HASH,
          eventHash: Buffer.alloc(32, 2),
        }),
      ),
    );
    expect(failure.message).toContain('AUDIT_SEQUENCE_GAP');
  });

  it('refuse un trou de séquence', async () => {
    await transact('app_rw', async (client) => {
      await insertEvent(client, {
        seq: 1,
        id: uuid(1),
        prevHash: ZERO_HASH,
        eventHash: Buffer.alloc(32, 1),
      });
    });
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        insertEvent(client, {
          seq: 3,
          id: uuid(3),
          prevHash: Buffer.alloc(32, 1),
          eventHash: Buffer.alloc(32, 3),
        }),
      ),
    );
    expect(failure.message).toContain('AUDIT_SEQUENCE_GAP');
  });

  it('refuse un prev_hash qui ne suit pas la chaîne', async () => {
    await transact('app_rw', async (client) => {
      await insertEvent(client, {
        seq: 1,
        id: uuid(1),
        prevHash: ZERO_HASH,
        eventHash: Buffer.alloc(32, 1),
      });
    });
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        insertEvent(client, {
          seq: 2,
          id: uuid(2),
          prevHash: Buffer.alloc(32, 9),
          eventHash: Buffer.alloc(32, 2),
        }),
      ),
    );
    expect(failure.message).toContain('AUDIT_CHAIN_BROKEN');
  });

  it('exige un motif pour une lecture sensible, même en SQL direct', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        insertEvent(client, {
          seq: 1,
          id: uuid(1),
          eventType: 'SENSITIVE_DATA_READ',
          prevHash: ZERO_HASH,
          eventHash: Buffer.alloc(32, 1),
        }),
      ),
    );
    expect(failure.code).toBe('23514');
    expect(failure.message).toContain('event_sensitive_reason_required');
  });

  it('refuse une métadonnée sensible même en SQL direct', async () => {
    for (const key of [
      'client_pin',
      'pin_code',
      'pin_hash',
      'code_hash',
      'token_hash',
      'auth_token',
      'new_password',
      'cvv_code',
      'api_key',
      'private_key',
      'otp_mac',
      'recovery_code',
    ]) {
      const failure = await catchFailure(() =>
        transact('app_rw', (client) =>
          insertEvent(client, {
            seq: 1,
            id: uuid(1),
            refs: JSON.stringify({ [key]: 'x' }),
            prevHash: ZERO_HASH,
            eventHash: Buffer.alloc(32, 1),
          }),
        ),
      );
      expect(failure.message).toContain('AUDIT_SENSITIVE_METADATA');
    }

    const nested = await catchFailure(() =>
      transact('app_rw', (client) =>
        insertEvent(client, {
          seq: 1,
          id: uuid(1),
          refs: '{"context":[{"accessToken":"x"}]}',
          prevHash: ZERO_HASH,
          eventHash: Buffer.alloc(32, 1),
        }),
      ),
    );
    expect(nested.message).toContain('AUDIT_SENSITIVE_METADATA');

    const invalidKey = await catchFailure(() =>
      transact('app_rw', (client) =>
        insertEvent(client, {
          seq: 1,
          id: uuid(1),
          refs: '{"clé":"x"}',
          prevHash: ZERO_HASH,
          eventHash: Buffer.alloc(32, 1),
        }),
      ),
    );
    expect(invalidKey.message).toContain('AUDIT_INVALID_EVENT');
  });

  it('refuse modification, suppression et troncature', async () => {
    await transact('app_rw', async (client) => {
      await insertEvent(client, {
        seq: 1,
        id: uuid(1),
        prevHash: ZERO_HASH,
        eventHash: Buffer.alloc(32, 1),
      });
    });
    const update = await catchFailure(() =>
      transact('app_rw', (client) =>
        client.query(`UPDATE audit.event SET action = 'ALTERED' WHERE seq = 1`),
      ),
    );
    expect(update.message).toMatch(/AUDIT_APPEND_ONLY|permission denied/);
    const remove = await catchFailure(() =>
      transact('app_rw', (client) =>
        client.query('DELETE FROM audit.event WHERE seq = 1'),
      ),
    );
    expect(remove.message).toMatch(/AUDIT_APPEND_ONLY|permission denied/);
    const truncate = await catchFailure(() =>
      transact(null, (client) => client.query('TRUNCATE audit.event')),
    );
    expect(truncate.message).toContain('AUDIT_APPEND_ONLY');
    const ownerUpdate = await catchFailure(() =>
      transact(null, (client) =>
        client.query(`UPDATE audit.event SET action = 'ALTERED' WHERE seq = 1`),
      ),
    );
    expect(ownerUpdate.message).toContain('AUDIT_APPEND_ONLY');
    const ownerDelete = await catchFailure(() =>
      transact(null, (client) =>
        client.query('DELETE FROM audit.event WHERE seq = 1'),
      ),
    );
    expect(ownerDelete.message).toContain('AUDIT_APPEND_ONLY');
  });

  it('interdit l’écriture au rôle lecture seule', async () => {
    const failure = await catchFailure(() =>
      transact('app_ro', (client) =>
        insertEvent(client, {
          seq: 1,
          id: uuid(1),
          prevHash: ZERO_HASH,
          eventHash: Buffer.alloc(32, 1),
        }),
      ),
    );
    expect(failure.code).toBe('42501');
  });

  it('conserve une chaîne vérifiable de bout en bout via l’API', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_rw');
      for (const action of ['LOGIN_SEEN', 'LOGOUT_SEEN']) {
        await appendAuditEvent(client, {
          eventType: 'AUTH_LOGIN',
          actorId: 'admin-1',
          action,
          targetType: 'SESSION',
          targetId: 'sess-1',
          outcome: 'SUCCESS',
          refs: action === 'LOGIN_SEEN' ? { session: 'sess-1' } : {},
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const rows = await listAuditEvents(pool, {
      afterSeq: null,
      limit: 50,
      actorId: null,
      targetId: null,
      eventType: null,
    });
    expect(rows.map((row) => row.seq)).toEqual([1, 2]);
    expect(() =>
      verifyAuditChain(
        rows.map((row) => ({
          seq: row.seq,
          id: row.id,
          ts: row.recordedAt,
          eventType: row.eventType,
          actorId: row.actorId,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          outcome: row.outcome,
          reason: row.reason,
          refs: row.refs,
          prevHash: Buffer.from(row.prevHash, 'hex'),
          eventHash: Buffer.from(row.eventHash, 'hex'),
        })),
      ),
    ).not.toThrow();
  });

  it('autorise la lecture au rôle lecture seule', async () => {
    const rows = await transact('app_ro', (client) =>
      client.query('SELECT count(*)::int AS total FROM audit.event'),
    );
    expect(rows.rows[0]).toEqual({ total: 0 });
  });
});

describe('F-CAT-002 · vocabulaire d’audit du catalogue (base réelle)', () => {
  it('F-CAT-002 refuse CATALOG_ACTION avant 0010 et l’accepte après', async () => {
    const seed = {
      seq: 1,
      id: uuid(1),
      eventType: 'CATALOG_ACTION',
      prevHash: ZERO_HASH,
      eventHash: Buffer.alloc(32, 1),
    };
    const before = await catchFailure(() =>
      transact('app_rw', (client) => insertEvent(client, seed)),
    );
    expect(before.code).toBe('23514');
    await admin.query(catalogMigrationSql);
    await transact('app_rw', (client) => insertEvent(client, seed));
    const rows = await admin.query<{ event_type: string }>(
      'SELECT event_type FROM audit.event',
    );
    expect(rows.rows).toEqual([{ event_type: 'CATALOG_ACTION' }]);
  });

  it('F-CAT-002 0010 conserve les types existants', async () => {
    await admin.query(catalogMigrationSql);
    await transact('app_rw', (client) =>
      insertEvent(client, {
        seq: 1,
        id: uuid(1),
        eventType: 'IDENTITY_ACTION',
        prevHash: ZERO_HASH,
        eventHash: Buffer.alloc(32, 1),
      }),
    );
  });
});
