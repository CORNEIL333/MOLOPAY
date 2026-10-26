import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const POSTGRES_IMAGE =
  'postgres:16.15-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab';
const MIGRATION_PATH = resolve(
  process.cwd(),
  'db/migrations/0002_audit.sql',
);

const ZERO_HASH = Buffer.alloc(32);

type SeedEvent = {
  readonly seq: number;
  readonly id: string;
  readonly eventType?: string;
  readonly reason?: string | null;
  readonly prevHash: Buffer;
  readonly eventHash: Buffer;
};

let container: StartedPostgreSqlContainer;
let admin: Client;
let migrationSql: string;

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
             'SUCCESS', $4, '{}'::jsonb, $5, $6)`,
    [
      seed.seq,
      seed.id,
      seed.eventType ?? 'AUTH_LOGIN',
      seed.reason ?? null,
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
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  migrationSql = await readFile(MIGRATION_PATH, 'utf8');
}, 120_000);

afterAll(async () => {
  await admin.end();
  await container.stop();
});

beforeEach(async () => {
  await admin.query('DROP SCHEMA IF EXISTS audit CASCADE');
  await admin.query(migrationSql);
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

  it('autorise la lecture au rôle lecture seule', async () => {
    const rows = await transact('app_ro', (client) =>
      client.query('SELECT count(*)::int AS total FROM audit.event'),
    );
    expect(rows.rows[0]).toEqual({ total: 0 });
  });
});
