import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startTestDatabase, type TestDatabase } from './harness';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const MIGRATION_PATH = resolve(
  process.cwd(),
  'db/migrations/0003_admin.sql',
);
const CLOCK_MIGRATION_PATH = resolve(
  process.cwd(),
  'db/migrations/0006_admin_clock.sql',
);

const HASH = Buffer.alloc(32, 7);
const PREPARED_AT = '2026-10-26T08:00:00.000Z';
const EXPIRES_AT = '2026-10-27T08:00:00.000Z';

let container: TestDatabase;
let admin: Client;
let migrationSql: string;
let clockMigrationSql: string;

function uuid(seq: number): string {
  return `019a4000-0000-7000-8000-${seq.toString().padStart(12, '0')}`;
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

async function insertRequest(
  client: Client,
  options: {
    readonly id: string;
    readonly maker?: string;
    readonly kind?: string;
    readonly preparedAt?: string;
    readonly expiresAt?: string;
    readonly payload?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO admin.approval_request
       (id, kind, maker_id, payload, payload_hash, reason, prepared_at, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, $5,
             'Règlement du lot 42', $6, $7)`,
    [
      options.id,
      options.kind ?? 'SETTLEMENT',
      options.maker ?? 'ops-1',
      options.payload ?? '{"settlement_id":"set-1"}',
      HASH,
      options.preparedAt ?? PREPARED_AT,
      options.expiresAt ?? EXPIRES_AT,
    ],
  );
}

async function insertDecision(
  client: Client,
  requestId: string,
  options: {
    readonly decision: string;
    readonly decidedBy: string;
    readonly decidedAt?: string;
    readonly reason?: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO admin.approval_decision
       (request_id, decision, decided_by, decided_at, decision_reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      requestId,
      options.decision,
      options.decidedBy,
      options.decidedAt ?? '2026-10-26T09:00:00.000Z',
      options.reason ?? null,
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
  migrationSql = await readFile(MIGRATION_PATH, 'utf8');
  clockMigrationSql = await readFile(CLOCK_MIGRATION_PATH, 'utf8');
}, 120_000);

afterAll(async () => {
  await admin.end();
  await container.stop();
});

beforeEach(async () => {
  await admin.query('DROP SCHEMA IF EXISTS admin CASCADE');
  await admin.query(migrationSql);
  await admin.query(clockMigrationSql);
});

describe('maker-checker · contraintes de base (PostgreSQL réel)', () => {
  it('accepte une décision par un acteur distinct', async () => {
    await transact('app_rw', async (client) => {
      await insertRequest(client, { id: uuid(1) });
      await insertDecision(client, uuid(1), {
        decision: 'APPROVED',
        decidedBy: 'fin-1',
      });
    });
    const state = await admin.query<{ status: string }>(
      'SELECT status FROM admin.approval_request_state WHERE id = $1',
      [uuid(1)],
    );
    expect(state.rows[0]?.status).toBe('APPROVED');
  });

  it('refuse que le préparateur approuve sa demande', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertRequest(client, { id: uuid(1), maker: 'ops-1' });
        await insertDecision(client, uuid(1), {
          decision: 'APPROVED',
          decidedBy: 'ops-1',
        });
      }),
    );
    expect(failure.message).toContain('MAKER_CANNOT_APPROVE');
  });

  it('réserve l’annulation au préparateur', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertRequest(client, { id: uuid(1), maker: 'ops-1' });
        await insertDecision(client, uuid(1), {
          decision: 'CANCELLED',
          decidedBy: 'fin-1',
        });
      }),
    );
    expect(failure.message).toContain('ADMIN_FORBIDDEN');

    await transact('app_rw', async (client) => {
      await insertRequest(client, { id: uuid(2), maker: 'ops-1' });
      await insertDecision(client, uuid(2), {
        decision: 'CANCELLED',
        decidedBy: 'ops-1',
      });
    });
  });

  it('refuse une seconde décision et une décision après expiration', async () => {
    const duplicate = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertRequest(client, { id: uuid(1) });
        await insertDecision(client, uuid(1), {
          decision: 'APPROVED',
          decidedBy: 'fin-1',
        });
        await insertDecision(client, uuid(1), {
          decision: 'REJECTED',
          decidedBy: 'fin-2',
          reason: 'Second avis',
        });
      }),
    );
    expect(duplicate.code).toBe('23505');

    const expired = await catchFailure(async () => {
      await transact('app_rw', (client) =>
        insertRequest(client, {
          id: uuid(3),
          expiresAt: '2026-10-26T08:00:00.250Z',
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      await transact('app_rw', (client) =>
        insertDecision(client, uuid(3), {
          decision: 'APPROVED',
          decidedBy: 'fin-1',
          decidedAt: PREPARED_AT,
        }),
      );
    });
    expect(expired.message).toContain('ADMIN_REQUEST_EXPIRED');
  });

  it('borne la durée de validité à sept jours', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        insertRequest(client, {
          id: uuid(1),
          expiresAt: '2026-11-03T08:00:00.001Z',
        }),
      ),
    );
    expect(failure.code).toBe('P0001');
    expect(failure.message).toContain('sept jours');
  });

  it('ancre préparation et décision sur l’horloge serveur', async () => {
    await transact('app_rw', async (client) => {
      await insertRequest(client, {
        id: uuid(1),
        preparedAt: '2026-10-27T08:00:00.000Z',
        expiresAt: '2026-10-28T08:00:00.000Z',
      });
      await insertDecision(client, uuid(1), {
        decision: 'APPROVED',
        decidedBy: 'fin-1',
        decidedAt: '2020-01-01T00:00:00.000Z',
      });
    });
    const state = await admin.query<{
      prepared_age: string;
      decided_age: string;
      lifetime_seconds: string;
    }>(
      `SELECT EXTRACT(EPOCH FROM now() - r.prepared_at) AS prepared_age,
              EXTRACT(EPOCH FROM now() - d.decided_at) AS decided_age,
              EXTRACT(EPOCH FROM r.expires_at - r.prepared_at) AS lifetime_seconds
         FROM admin.approval_request r
         JOIN admin.approval_decision d ON d.request_id = r.id
        WHERE r.id = $1`,
      [uuid(1)],
    );
    const row = state.rows[0];
    expect(Number(row?.prepared_age)).toBeLessThan(5);
    expect(Number(row?.decided_age)).toBeLessThan(5);
    expect(Number(row?.lifetime_seconds)).toBe(86_400);
  });

  it('exige un motif de refus et borne le bris de glace à deux heures', async () => {
    const noReason = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertRequest(client, { id: uuid(1) });
        await insertDecision(client, uuid(1), {
          decision: 'REJECTED',
          decidedBy: 'fin-1',
        });
      }),
    );
    expect(noReason.code).toBe('23514');

    const tooLong = await catchFailure(() =>
      transact('app_rw', (client) =>
        insertRequest(client, {
          id: uuid(2),
          kind: 'BREAK_GLASS',
          expiresAt: '2026-10-26T10:00:00.001Z',
        }),
      ),
    );
    expect(tooLong.code).toBe('23514');
    expect(tooLong.message).toContain('request_break_glass_max_two_hours');
  });

  it('refuse modification, suppression et troncature', async () => {
    await transact('app_rw', async (client) => {
      await insertRequest(client, { id: uuid(1) });
    });
    const update = await catchFailure(() =>
      transact('app_rw', (client) =>
        client.query(`UPDATE admin.approval_request SET reason = 'altéré'`),
      ),
    );
    expect(update.message).toMatch(/ADMIN_APPEND_ONLY|permission denied/);
    const remove = await catchFailure(() =>
      transact('app_rw', (client) =>
        client.query('DELETE FROM admin.approval_request'),
      ),
    );
    expect(remove.message).toMatch(/ADMIN_APPEND_ONLY|permission denied/);
    const truncate = await catchFailure(() =>
      transact(null, (client) => client.query('TRUNCATE admin.approval_request')),
    );
    expect(truncate.message).toContain('ADMIN_APPEND_ONLY');
  });

  it('publie des paramètres versionnés liés à une demande approuvée', async () => {
    await transact('app_rw', async (client) => {
      await insertRequest(client, {
        id: uuid(1),
        kind: 'FINANCIAL_SETTING',
        payload: '{"key":"settlement_threshold_xaf","value":"500000"}',
      });
      await insertDecision(client, uuid(1), {
        decision: 'APPROVED',
        decidedBy: 'fin-2',
      });
      await client.query(
        `INSERT INTO admin.setting_version
           (key, version, value, created_by, created_at, approval_request_id)
         VALUES ('settlement_threshold_xaf', 1, '"500000"'::jsonb, 'ops-1',
                 $1, $2)`,
        [PREPARED_AT, uuid(1)],
      );
    });
    const rows = await admin.query<{ key: string; version: number }>(
      'SELECT key, version FROM admin.setting_version',
    );
    expect(rows.rows).toEqual([{ key: 'settlement_threshold_xaf', version: 1 }]);

    const duplicateRequest = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          `INSERT INTO admin.setting_version
             (key, version, value, created_by, created_at, approval_request_id)
           VALUES ('settlement_threshold_xaf', 2, '"500000"'::jsonb, 'ops-1',
                   $1, $2)`,
          [PREPARED_AT, uuid(1)],
        );
      }),
    );
    expect(duplicateRequest.code).toBe('23505');
  });

  it('refuse un paramètre non approuvé ou différent de la demande', async () => {
    const pending = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertRequest(client, {
          id: uuid(1),
          kind: 'FINANCIAL_SETTING',
          payload: '{"key":"settlement_threshold_xaf","value":"500000"}',
        });
        await client.query(
          `INSERT INTO admin.setting_version
             (key, version, value, created_by, created_at, approval_request_id)
           VALUES ('settlement_threshold_xaf', 1, '"500000"'::jsonb, 'ops-1',
                   $1, $2)`,
          [PREPARED_AT, uuid(1)],
        );
      }),
    );
    expect(pending.message).toContain('ADMIN_INVALID_REQUEST');

    const altered = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertRequest(client, {
          id: uuid(2),
          kind: 'FINANCIAL_SETTING',
          payload: '{"key":"settlement_threshold_xaf","value":"500000"}',
        });
        await insertDecision(client, uuid(2), {
          decision: 'APPROVED',
          decidedBy: 'fin-2',
        });
        await client.query(
          `INSERT INTO admin.setting_version
             (key, version, value, created_by, created_at, approval_request_id)
           VALUES ('settlement_threshold_xaf', 1, '"9000000"'::jsonb, 'ops-1',
                   $1, $2)`,
          [PREPARED_AT, uuid(2)],
        );
      }),
    );
    expect(altered.message).toContain('ADMIN_INVALID_REQUEST');
  });

  it('refuse une publication par un autre acteur ou depuis un autre type', async () => {
    const otherActor = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertRequest(client, {
          id: uuid(1),
          kind: 'FINANCIAL_SETTING',
          payload: '{"key":"settlement_threshold_xaf","value":"500000"}',
        });
        await insertDecision(client, uuid(1), {
          decision: 'APPROVED',
          decidedBy: 'fin-2',
        });
        await client.query(
          `INSERT INTO admin.setting_version
             (key, version, value, created_by, created_at, approval_request_id)
           VALUES ('settlement_threshold_xaf', 1, '"500000"'::jsonb, 'fin-9',
                   $1, $2)`,
          [PREPARED_AT, uuid(1)],
        );
      }),
    );
    expect(otherActor.message).toContain('ADMIN_INVALID_REQUEST');

    const wrongKind = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertRequest(client, {
          id: uuid(2),
          kind: 'SETTLEMENT',
          payload: '{"key":"settlement_threshold_xaf","value":"500000"}',
        });
        await insertDecision(client, uuid(2), {
          decision: 'APPROVED',
          decidedBy: 'fin-2',
        });
        await client.query(
          `INSERT INTO admin.setting_version
             (key, version, value, created_by, created_at, approval_request_id)
           VALUES ('settlement_threshold_xaf', 1, '"500000"'::jsonb, 'ops-1',
                   $1, $2)`,
          [PREPARED_AT, uuid(2)],
        );
      }),
    );
    expect(wrongKind.message).toContain('ADMIN_INVALID_REQUEST');
  });

  it('refuse un identifiant de préparateur ou de décideur avec espace', async () => {
    const maker = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertRequest(client, { id: uuid(1), maker: 'ops-1 ' });
      }),
    );
    expect(maker.code).toBe('23514');

    const checker = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertRequest(client, { id: uuid(2), maker: 'ops-1' });
        await insertDecision(client, uuid(2), {
          decision: 'APPROVED',
          decidedBy: 'fin-1\t',
        });
      }),
    );
    expect(checker.code).toBe('23514');
  });

  it('interdit l’écriture au rôle lecture seule', async () => {
    const failure = await catchFailure(() =>
      transact('app_ro', (client) => insertRequest(client, { id: uuid(1) })),
    );
    expect(failure.code).toBe('42501');
  });
});
