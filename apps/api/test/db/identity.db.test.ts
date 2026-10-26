import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startTestDatabase, type TestDatabase } from './harness';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const AUDIT_MIGRATION = resolve(
  process.cwd(),
  'db/migrations/0002_audit.sql',
);
const IDENTITY_MIGRATION = resolve(
  process.cwd(),
  'db/migrations/0004_identity.sql',
);
const AUDIT_METADATA_MIGRATION = resolve(
  process.cwd(),
  'db/migrations/0005_audit_metadata.sql',
);
const IDENTITY_CLOCK_MIGRATION = resolve(
  process.cwd(),
  'db/migrations/0007_identity_clock.sql',
);

const PHONE = '+237612345678';
const OTHER_PHONE = '+237698765432';
// Horloge base capturée avant chaque test : les triggers comparent à now()
// réel, un horodatage figé rendrait les tests dépendants de l'heure.
let NOW = '';
const PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAdGVzdA==\n-----END PUBLIC KEY-----\n';
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2VsZWN0c2VsZWN0$aGFzaA';

let container: TestDatabase;
let admin: Client;
let auditSql: string;
let auditMetadataSql: string;
let identitySql: string;
let identityClockSql: string;

function uuid(seq: number, variant = '8'): string {
  return `019a5000-0000-7000-${variant}000-${seq.toString().padStart(12, '0')}`;
}

function bytes(value: number): Buffer {
  return Buffer.alloc(value, 7);
}

function plus(milliseconds: number): string {
  return new Date(Date.parse(NOW) + milliseconds).toISOString();
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

async function insertAccount(
  client: Client,
  seq: number,
  options?: { readonly phone?: string },
): Promise<string> {
  const id = seq === 1 ? uuid(1) : uuid(seq);
  await client.query(
    `INSERT INTO identity.account (id, phone, phone_verified_at)
     VALUES ($1, $2, $3)`,
    [id, options?.phone ?? PHONE, NOW],
  );
  return id;
}

// Le niveau KYC n'est pas accordé à app_rw : seul le propriétaire du schéma
// peut l'élever (le lot KYC le fera par un chemin dédié et audité).
async function setStrongKyc(accountId: string): Promise<void> {
  await admin.query(
    `UPDATE identity.account SET kyc_level = 'STRONG' WHERE id = $1`,
    [accountId],
  );
}

async function insertDevice(
  client: Client,
  seq: number,
  accountId: string,
): Promise<string> {
  const id = uuid(seq);
  await client.query(
    `INSERT INTO identity.device
       (id, account_id, public_key_pem, fingerprint, name, status, registered_at)
     VALUES ($1, $2, $3, $4, 'Appareil', 'ACTIVE', $5)`,
    [id, accountId, PUBLIC_KEY, bytes(32), NOW],
  );
  return id;
}

async function insertPin(
  client: Client,
  accountId: string,
  deviceId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO identity.pin_credential
       (device_id, account_id, pin_hash, updated_at)
     VALUES ($1, $2, $3, $4)`,
    [deviceId, accountId, PIN_HASH, NOW],
  );
}

async function insertSession(
  client: Client,
  seq: number,
  accountId: string,
  deviceId: string,
  options?: {
    readonly accessIssuedAt?: string;
    readonly accessExpiresAt?: string;
    readonly refreshExpiresAt?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO identity.session
       (id, account_id, device_id, access_token_hash, refresh_token_hash,
        access_issued_at, access_expires_at, refresh_expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      uuid(seq),
      accountId,
      deviceId,
      bytes(32),
      bytes(32),
      options?.accessIssuedAt ?? NOW,
      options?.accessExpiresAt ?? plus(15 * 60_000),
      options?.refreshExpiresAt ?? plus(30 * 24 * 60 * 60_000),
      NOW,
    ],
  );
}

async function insertRecovery(
  client: Client,
  seq: number,
  accountId: string,
  options?: {
    readonly hadBalance?: boolean;
    readonly newPhone?: string;
    readonly oldPhone?: string;
  },
): Promise<string> {
  const id = uuid(seq);
  await client.query(
    `INSERT INTO identity.recovery
       (id, account_id, old_phone, new_phone, method, had_balance)
     VALUES ($1, $2, $3, $4, 'KYC_STRONG', $5)`,
    [
      id,
      accountId,
      options?.oldPhone ?? PHONE,
      options?.newPhone ?? OTHER_PHONE,
      options?.hadBalance ?? false,
    ],
  );
  return id;
}

async function insertConsumedRecoveryOtp(
  client: Client,
  seq: number,
  accountId: string,
  newPhone: string,
  options?: {
    readonly purpose?: string;
    readonly binding?: string;
    readonly phone?: string;
    readonly unconsumed?: boolean;
    readonly stale?: boolean;
  },
): Promise<string> {
  const id = uuid(seq);
  await client.query(
    `INSERT INTO identity.otp_challenge
       (id, phone, purpose, binding, code_hash, expires_at, attempts_remaining)
     VALUES ($1, $2, $3, $4, $5,
             now() + CASE WHEN $6 THEN interval '-1 minute'
                          ELSE interval '10 minutes' END,
             0)`,
    [
      id,
      options?.phone ?? newPhone,
      options?.purpose ?? 'RECOVERY',
      options?.binding ?? accountId,
      bytes(32),
      options?.stale === true,
    ],
  );
  if (options?.unconsumed !== true) {
    await client.query(
      `UPDATE identity.otp_challenge
       SET consumed_at = now()
           - CASE WHEN $2 THEN interval '11 minutes' ELSE interval '0' END
       WHERE id = $1`,
      [id, options?.stale === true],
    );
  }
  return id;
}

async function insertTransaction(
  client: Client,
  options?: {
    readonly accountId?: string;
    readonly deviceId?: string;
    readonly operationId?: string;
    readonly nonce?: string;
    readonly amount?: bigint;
    readonly signature?: Buffer;
    readonly expiresAt?: string;
    readonly pinVerified?: boolean;
  },
): Promise<{ readonly accountId: string; readonly deviceId: string }> {
  const accountId = options?.accountId ?? (await insertAccount(client, 1));
  const deviceId =
    options?.deviceId ?? (await insertDevice(client, 2, accountId));
  await client.query(
    `INSERT INTO identity.transaction_signature
       (operation_id, account_id, device_id, payload_hash, signature, nonce,
        action, amount_xaf, issued_at, expires_at, authorized_at, pin_verified)
     VALUES ($1, $2, $3, $4, $5, $6, 'WITHDRAWAL', $7, $8, $9, $8, $10)`,
    [
      options?.operationId ?? uuid(3),
      accountId,
      deviceId,
      bytes(32),
      options?.signature ?? bytes(64),
      options?.nonce ?? uuid(4),
      options?.amount ?? 25_000n,
      NOW,
      options?.expiresAt ?? plus(5 * 60_000),
      options?.pinVerified ?? true,
    ],
  );
  return { accountId, deviceId };
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
  auditSql = await readFile(AUDIT_MIGRATION, 'utf8');
  auditMetadataSql = await readFile(AUDIT_METADATA_MIGRATION, 'utf8');
  identitySql = await readFile(IDENTITY_MIGRATION, 'utf8');
  identityClockSql = await readFile(IDENTITY_CLOCK_MIGRATION, 'utf8');
}, 120_000);

afterAll(async () => {
  await admin.end();
  await container.stop();
});

beforeEach(async () => {
  await admin.query('DROP SCHEMA IF EXISTS identity CASCADE');
  await admin.query('DROP SCHEMA IF EXISTS audit CASCADE');
  await admin.query(auditSql);
  await admin.query(identitySql);
  await admin.query(auditMetadataSql);
  await admin.query(identityClockSql);
  const clock = await admin.query<{ now: Date }>('SELECT now() AS now');
  const current = clock.rows[0]?.now;
  if (!(current instanceof Date)) {
    throw new Error('Horloge base indisponible');
  }
  NOW = current.toISOString();
});

describe('identité · contraintes de base (PostgreSQL réel)', () => {
  it('accepte un compte, un appareil, un PIN et une session', async () => {
    await transact('app_rw', async (client) => {
      const accountId = await insertAccount(client, 1);
      const deviceId = await insertDevice(client, 2, accountId);
      await insertPin(client, accountId, deviceId);
      await insertSession(client, 3, accountId, deviceId);
    });
    const rows = await admin.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM identity.session',
    );
    expect(rows.rows[0]?.count).toBe(1);
  });

  it('refuse les écritures au rôle lecture seule', async () => {
    const failure = await catchFailure(() =>
      transact('app_ro', async (client) => {
        await insertAccount(client, 1);
      }),
    );
    expect(failure.code).toBe('42501');
  });

  it('refuse un numéro non E.164 et un état de blocage incohérent', async () => {
    const badPhone = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertAccount(client, 1, { phone: '612345678' });
      }),
    );
    expect(badPhone.code).toBe('23514');

    const blocked = await catchFailure(() =>
      transact('app_rw', async (client) => {
        const accountId = await insertAccount(client, 1);
        await client.query(
          `UPDATE identity.account SET status = 'BLOCKED' WHERE id = $1`,
          [accountId],
        );
      }),
    );
    expect(blocked.code).toBe('23514');
  });

  it('interdit à l’application de créer un compte déjà vérifié KYC', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          `INSERT INTO identity.account
             (id, phone, phone_verified_at, kyc_level)
           VALUES ($1, $2, $3, 'STRONG')`,
          [uuid(1), PHONE, NOW],
        );
      }),
    );
    expect(failure.code).toBe('42501');
  });

  it('refuse un PIN en clair ou un hash OTP de mauvaise taille', async () => {
    const badPin = await catchFailure(() =>
      transact('app_rw', async (client) => {
        const accountId = await insertAccount(client, 1);
        const deviceId = await insertDevice(client, 2, accountId);
        await client.query(
          `INSERT INTO identity.pin_credential
             (device_id, account_id, pin_hash, updated_at)
           VALUES ($1, $2, '284917', $3)`,
          [deviceId, accountId, NOW],
        );
      }),
    );
    expect(badPin.code).toBe('23514');

    const badOtp = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          `INSERT INTO identity.otp_challenge
             (id, phone, purpose, binding, code_hash, expires_at,
              attempts_remaining)
           VALUES ($1, $2, 'SIGNUP', $2, $3, $4, 5)`,
          [uuid(1), PHONE, bytes(16), plus(5 * 60_000)],
        );
      }),
    );
    expect(badOtp.code).toBe('23514');
  });

  it('n’autorise que la décroissance des essais OTP', async () => {
    await transact('app_rw', async (client) => {
      await client.query(
        `INSERT INTO identity.otp_challenge
           (id, phone, purpose, binding, code_hash, expires_at,
            attempts_remaining)
         VALUES ($1, $2, 'SIGNUP', $2, $3, $4, 5)`,
        [uuid(1), PHONE, bytes(32), plus(5 * 60_000)],
      );
      await client.query(
        'UPDATE identity.otp_challenge SET attempts_remaining = 4 WHERE id = $1',
        [uuid(1)],
      );
    });
    const increase = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          'UPDATE identity.otp_challenge SET attempts_remaining = 5 WHERE id = $1',
          [uuid(1)],
        );
      }),
    );
    expect(increase.code).toBe('P0001');
    expect(increase.message).toContain('IDENTITY_APPEND_ONLY');

    const rebind = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          `UPDATE identity.otp_challenge SET binding = 'autre' WHERE id = $1`,
          [uuid(1)],
        );
      }),
    );
    expect(rebind.code).toBe('42501');
  });

  it('refuse une consommation OTP après expiration et une suppression', async () => {
    const born = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          `INSERT INTO identity.otp_challenge
             (id, phone, purpose, binding, code_hash, expires_at,
              attempts_remaining, consumed_at)
           VALUES ($1, $2, 'SIGNUP', $2, $3, $4, 5, $4)`,
          [uuid(1), PHONE, bytes(32), plus(5 * 60_000)],
        );
      }),
    );
    expect(born.code).toBe('42501');

    const expired = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          `INSERT INTO identity.otp_challenge
             (id, phone, purpose, binding, code_hash, expires_at,
              attempts_remaining)
           VALUES ($1, $2, 'SIGNUP', $2, $3, $4, 5)`,
          [uuid(1), PHONE, bytes(32), plus(5 * 60_000)],
        );
        await client.query(
          `UPDATE identity.otp_challenge SET consumed_at = $1 WHERE id = $2`,
          [plus(6 * 60_000), uuid(1)],
        );
      }),
    );
    expect(expired.code).toBe('23514');

    await transact('app_rw', async (client) => {
      await client.query(
        `INSERT INTO identity.otp_challenge
           (id, phone, purpose, binding, code_hash, expires_at,
            attempts_remaining)
         VALUES ($1, $2, 'SIGNUP', $2, $3, $4, 5)`,
        [uuid(2), PHONE, bytes(32), plus(5 * 60_000)],
      );
    });
    const deleted = await catchFailure(() =>
      admin.query('DELETE FROM identity.otp_challenge WHERE id = $1', [uuid(2)]),
    );
    expect(deleted.code).toBe('P0001');
    expect(deleted.message).toContain('IDENTITY_APPEND_ONLY');
  });

  it('borne l’accès de session à quinze minutes depuis l’émission', async () => {
    const longSession = await catchFailure(() =>
      transact('app_rw', async (client) => {
        const accountId = await insertAccount(client, 1);
        const deviceId = await insertDevice(client, 2, accountId);
        await insertSession(client, 3, accountId, deviceId, {
          accessExpiresAt: plus(15 * 60_000 + 1),
        });
      }),
    );
    expect(longSession.code).toBe('23514');

    const staleAnchor = await catchFailure(() =>
      transact('app_rw', async (client) => {
        const accountId = await insertAccount(client, 1);
        const deviceId = await insertDevice(client, 2, accountId);
        await insertSession(client, 3, accountId, deviceId, {
          accessIssuedAt: plus(-60 * 60_000),
        });
      }),
    );
    expect(staleAnchor.code).toBe('23514');

    const futureAnchor = await catchFailure(() =>
      transact('app_rw', async (client) => {
        const accountId = await insertAccount(client, 1);
        const deviceId = await insertDevice(client, 2, accountId);
        await insertSession(client, 3, accountId, deviceId, {
          accessIssuedAt: '9999-01-01T00:00:00.000Z',
          accessExpiresAt: '9999-01-01T00:15:00.000Z',
          refreshExpiresAt: '9999-02-01T00:00:00.000Z',
        });
      }),
    );
    expect(futureAnchor.code).toBe('P0001');
    expect(futureAnchor.message).toContain('IDENTITY_SESSION_INVALID');

    const duplicate = await catchFailure(() =>
      transact('app_rw', async (client) => {
        const accountId = await insertAccount(client, 1);
        await insertDevice(client, 2, accountId);
        await insertDevice(client, 3, accountId);
      }),
    );
    expect(duplicate.code).toBe('23505');
  });

  it('interdit de réancrer created_at et borne chaque rotation de jeton', async () => {
    await transact('app_rw', async (client) => {
      const accountId = await insertAccount(client, 1);
      const deviceId = await insertDevice(client, 2, accountId);
      await insertSession(client, 3, accountId, deviceId);
    });

    const created = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          'UPDATE identity.session SET created_at = $1 WHERE id = $2',
          [plus(-60 * 60_000), uuid(3)],
        );
      }),
    );
    expect(created.code).toBe('42501');

    const tooLong = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          `UPDATE identity.session
           SET access_issued_at = $1, access_expires_at = $2 WHERE id = $3`,
          [NOW, plus(15 * 60_000 + 1), uuid(3)],
        );
      }),
    );
    expect(tooLong.code).toBe('23514');

    await transact('app_rw', async (client) => {
      await client.query(
        `UPDATE identity.session
         SET access_token_hash = $1, refresh_token_hash = $2,
             access_issued_at = $3, access_expires_at = $4
         WHERE id = $5`,
        [
          bytes(32),
          bytes(32),
          NOW,
          plus(15 * 60_000),
          uuid(3),
        ],
      );
    });
    const rotated = await admin.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM identity.session',
    );
    expect(rotated.rows[0]?.count).toBe(1);
  });

  it('cache les hachés OTP et PIN au rôle de lecture seule', async () => {
    await transact('app_rw', async (client) => {
      const accountId = await insertAccount(client, 1);
      const deviceId = await insertDevice(client, 2, accountId);
      await insertPin(client, accountId, deviceId);
      await client.query(
        `INSERT INTO identity.otp_challenge
           (id, phone, purpose, binding, code_hash, expires_at,
            attempts_remaining)
         VALUES ($1, $2, 'SIGNUP', $2, $3, $4, 5)`,
        [uuid(3), PHONE, bytes(32), plus(5 * 60_000)],
      );
    });

    await transact('app_ro', async (client) => {
      const allowed = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM identity.account',
      );
      expect(allowed.rows[0]?.count).toBe(1);
    });

    for (const table of ['otp_challenge', 'pin_credential']) {
      const denied = await catchFailure(() =>
        transact('app_ro', async (client) => {
          await client.query(`SELECT * FROM identity.${table}`);
        }),
      );
      expect(denied.code).toBe('42501');
    }
  });

  it('refuse à app_ro les hachés de session et les fonctions sensibles', async () => {
    let recoveryId = '';
    await transact('app_rw', async (client) => {
      const accountId = await insertAccount(client, 1);
      const deviceId = await insertDevice(client, 2, accountId);
      await insertSession(client, 3, accountId, deviceId);
      recoveryId = await insertRecovery(client, 4, accountId);
    });

    for (const column of ['access_token_hash', 'refresh_token_hash']) {
      const denied = await catchFailure(() =>
        transact('app_ro', async (client) => {
          await client.query(`SELECT ${column} FROM identity.session`);
        }),
      );
      expect(denied.code).toBe('42501');
    }

    const cancelDenied = await catchFailure(() =>
      transact('app_ro', async (client) => {
        await client.query('SELECT identity.cancel_recovery($1)', [recoveryId]);
      }),
    );
    expect(cancelDenied.code).toBe('42501');

    const completeDenied = await catchFailure(() =>
      transact('app_ro', async (client) => {
        await client.query('SELECT identity.complete_recovery($1, NULL)', [
          recoveryId,
        ]);
      }),
    );
    expect(completeDenied.code).toBe('42501');
  });

  it('refuse une récupération OTP seule, antidatée ou vers le même numéro', async () => {
    const otpOnly = await catchFailure(() =>
      transact('app_rw', async (client) => {
        const accountId = await insertAccount(client, 1);
        await client.query(
          `INSERT INTO identity.recovery
             (id, account_id, old_phone, new_phone, method, had_balance)
           VALUES ($1, $2, $3, $4, 'OTP_ONLY', false)`,
          [uuid(2), accountId, PHONE, OTHER_PHONE],
        );
      }),
    );
    expect(otpOnly.code).toBe('23514');

    const backdated = await catchFailure(() =>
      transact('app_rw', async (client) => {
        const accountId = await insertAccount(client, 1);
        await client.query(
          `INSERT INTO identity.recovery
             (id, account_id, old_phone, new_phone, method, had_balance,
              requested_at, available_at, status)
           VALUES ($1, $2, $3, $4, 'KYC_STRONG', false,
                   '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
                   'PENDING')`,
          [uuid(2), accountId, PHONE, OTHER_PHONE],
        );
      }),
    );
    expect(backdated.code).toBe('42501');

    const samePhone = await catchFailure(() =>
      transact('app_rw', async (client) => {
        const accountId = await insertAccount(client, 1);
        await insertRecovery(client, 2, accountId, {
          oldPhone: PHONE,
          newPhone: PHONE,
        });
      }),
    );
    expect(samePhone.code).toBe('23514');
  });

  it('ancre la demande de récupération sur l’horloge base et le solde', async () => {
    await transact('app_rw', async (client) => {
      const accountId = await insertAccount(client, 1);
      await insertRecovery(client, 2, accountId, { hadBalance: true });
    });
    const anchored = await admin.query<{
      requested_at: Date;
      available_at: Date;
      status: string;
      completed_at: Date | null;
      delay_hours: number;
      age_seconds: number;
    }>(
      `SELECT requested_at, available_at, status, completed_at,
              (EXTRACT(EPOCH FROM (available_at - requested_at)) / 3600)::float8
                AS delay_hours,
              (EXTRACT(EPOCH FROM (now() - requested_at)))::float8
                AS age_seconds
       FROM identity.recovery`,
    );
    expect(anchored.rows[0]?.status).toBe('PENDING');
    expect(anchored.rows[0]?.completed_at).toBeNull();
    expect(anchored.rows[0]?.delay_hours).toBeCloseTo(24, 3);
    expect(anchored.rows[0]?.age_seconds).toBeLessThan(5);
  });

  it('n’utilise pas le début de transaction comme horloge de récupération', async () => {
    let transactionStart = 0;
    await transact('app_rw', async (client) => {
      const clock = await client.query<{ now: Date }>('SELECT now() AS now');
      const start = clock.rows[0]?.now;
      if (!(start instanceof Date)) {
        throw new Error('Horloge base indisponible');
      }
      transactionStart = start.getTime();
      await client.query('SELECT pg_sleep(0.2)');
      const accountId = await insertAccount(client, 1);
      await insertRecovery(client, 2, accountId, { hadBalance: true });
    });
    const row = await admin.query<{ requested_at: Date; available_at: Date }>(
      'SELECT requested_at, available_at FROM identity.recovery',
    );
    const requestedAt = row.rows[0]?.requested_at;
    const availableAt = row.rows[0]?.available_at;
    if (!(requestedAt instanceof Date) || !(availableAt instanceof Date)) {
      throw new Error('Horodatage de récupération absent');
    }
    expect(requestedAt.getTime() - transactionStart).toBeGreaterThan(100);
    expect(availableAt.getTime() - requestedAt.getTime()).toBe(86_400_000);
  });

  it('refuse une transaction sans signature complète, à montant nul ou trop longue', async () => {
    const shortSignature = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertTransaction(client, { signature: bytes(63) });
      }),
    );
    expect(shortSignature.code).toBe('23514');

    const zero = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertTransaction(client, { amount: 0n });
      }),
    );
    expect(zero.code).toBe('23514');

    const tooLong = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertTransaction(client, {
          expiresAt: plus(15 * 60_000 + 1),
        });
      }),
    );
    expect(tooLong.code).toBe('23514');

    const noPin = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertTransaction(client, { pinVerified: false });
      }),
    );
    expect(noPin.code).toBe('23514');
  });

  it('refuse le rejeu du nonce et la modification d’une signature', async () => {
    const fixture = await transact('app_rw', async (client) =>
      insertTransaction(client),
    );
    const duplicate = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertTransaction(client, {
          accountId: fixture.accountId,
          deviceId: fixture.deviceId,
          operationId: uuid(5),
          nonce: uuid(4),
        });
      }),
    );
    expect(duplicate.code).toBe('23505');

    const deleted = await catchFailure(() =>
      admin.query(
        'DELETE FROM identity.transaction_signature WHERE operation_id = $1',
        [uuid(3)],
      ),
    );
    expect(deleted.code).toBe('P0001');
    expect(deleted.message).toContain('IDENTITY_APPEND_ONLY');
    const updated = await catchFailure(() =>
      admin.query(
        'UPDATE identity.transaction_signature SET amount_xaf = 1 WHERE operation_id = $1',
        [uuid(3)],
      ),
    );
    expect(updated.code).toBe('P0001');
    expect(updated.message).toContain('IDENTITY_APPEND_ONLY');
  });

  it('interdit de réactiver un appareil, une session ou une récupération terminée', async () => {
    await transact('app_rw', async (client) => {
      const accountId = await insertAccount(client, 1);
      const deviceId = await insertDevice(client, 2, accountId);
      await client.query(
        `UPDATE identity.device
         SET status = 'REVOKED', revoked_at = $1 WHERE id = $2`,
        [NOW, deviceId],
      );
      await insertSession(client, 3, accountId, deviceId);
      await client.query(
        'UPDATE identity.session SET revoked_at = $1 WHERE id = $2',
        [NOW, uuid(3)],
      );
      await insertRecovery(client, 4, accountId);
      await client.query('SELECT identity.cancel_recovery($1)', [uuid(4)]);
    });

    const device = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          `UPDATE identity.device
           SET status = 'ACTIVE', revoked_at = NULL WHERE id = $1`,
          [uuid(2)],
        );
      }),
    );
    expect(device.code).toBe('P0001');
    expect(device.message).toContain('IDENTITY_APPEND_ONLY');

    const session = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          'UPDATE identity.session SET revoked_at = NULL WHERE id = $1',
          [uuid(3)],
        );
      }),
    );
    expect(session.code).toBe('P0001');
    expect(session.message).toContain('IDENTITY_APPEND_ONLY');

    const recovery = await catchFailure(() =>
      admin.query(
        `UPDATE identity.recovery SET status = 'PENDING' WHERE id = $1`,
        [uuid(4)],
      ),
    );
    expect(recovery.code).toBe('P0001');
    expect(recovery.message).toContain('IDENTITY_APPEND_ONLY');
  });

  it('interdit à l’application de changer le numéro ou la clé d’un appareil', async () => {
    const phone = await catchFailure(() =>
      transact('app_rw', async (client) => {
        const accountId = await insertAccount(client, 1);
        await client.query(
          'UPDATE identity.account SET phone = $1 WHERE id = $2',
          [OTHER_PHONE, accountId],
        );
      }),
    );
    expect(phone.code).toBe('42501');

    const key = await catchFailure(() =>
      transact('app_rw', async (client) => {
        const accountId = await insertAccount(client, 1);
        const deviceId = await insertDevice(client, 2, accountId);
        await client.query(
          'UPDATE identity.device SET public_key_pem = $1 WHERE id = $2',
          [PUBLIC_KEY, deviceId],
        );
      }),
    );
    expect(key.code).toBe('42501');
  });

  it('termine la récupération atomiquement : numéro, appareils et sessions', async () => {
    let recoveryId = '';
    let challengeId = '';
    let accountId = '';
    await transact('app_rw', async (client) => {
      accountId = await insertAccount(client, 1);
      const deviceId = await insertDevice(client, 2, accountId);
      await insertSession(client, 3, accountId, deviceId);
      recoveryId = await insertRecovery(client, 4, accountId);
      challengeId = await insertConsumedRecoveryOtp(
        client,
        5,
        accountId,
        OTHER_PHONE,
      );
    });
    await setStrongKyc(accountId);

    await transact('app_rw', async (client) => {
      await client.query('SELECT identity.complete_recovery($1, $2)', [
        recoveryId,
        challengeId,
      ]);
    });

    const replay = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query('SELECT identity.complete_recovery($1, $2)', [
          recoveryId,
          challengeId,
        ]);
      }),
    );
    expect(replay.code).toBe('P0001');
    expect(replay.message).toContain('IDENTITY_RECOVERY_FORBIDDEN');

    const account = await admin.query<{
      phone: string;
      phone_verified_at: string;
      kyc_level: string;
    }>('SELECT phone, phone_verified_at, kyc_level FROM identity.account');
    expect(account.rows[0]).toMatchObject({
      phone: OTHER_PHONE,
      kyc_level: 'STRONG',
    });

    const device = await admin.query<{ status: string; revoked_at: string | null }>(
      'SELECT status, revoked_at FROM identity.device',
    );
    expect(device.rows[0]).toMatchObject({ status: 'REVOKED' });

    const session = await admin.query<{ revoked_at: string | null }>(
      'SELECT revoked_at FROM identity.session',
    );
    expect(session.rows[0]?.revoked_at).not.toBeNull();

    const recovery = await admin.query<{ status: string; completed_at: string | null }>(
      'SELECT status, completed_at FROM identity.recovery',
    );
    expect(recovery.rows[0]).toMatchObject({ status: 'COMPLETED' });
  });

  it('refuse une récupération sans KYC, preuve invalide ou avant le délai déclaré', async () => {
    type Proof =
      | 'valid'
      | 'none'
      | 'wrong-binding'
      | 'wrong-purpose'
      | 'wrong-phone'
      | 'stale';

    async function setup(input: {
      readonly seqBase: number;
      readonly phone: string;
      readonly kyc?: 'STRONG';
      readonly proof?: Proof;
      readonly hadBalance?: boolean;
    }): Promise<{
      recoveryId: string;
      challengeId: string | null;
      accountId: string;
    }> {
      const proof = input.proof ?? 'valid';
      let recoveryId = '';
      let challengeId: string | null = null;
      let accountId = '';
      await transact('app_rw', async (client) => {
        accountId = await insertAccount(client, input.seqBase, {
          phone: input.phone,
        });
        recoveryId = await insertRecovery(client, input.seqBase + 1, accountId, {
          hadBalance: input.hadBalance ?? false,
          oldPhone: input.phone,
        });
        if (proof !== 'none') {
          challengeId = await insertConsumedRecoveryOtp(
            client,
            input.seqBase + 2,
            accountId,
            OTHER_PHONE,
            {
              binding: proof === 'wrong-binding' ? uuid(900) : accountId,
              purpose: proof === 'wrong-purpose' ? 'SIGNUP' : 'RECOVERY',
              phone:
                proof === 'wrong-phone' ? '+237699999999' : OTHER_PHONE,
              stale: proof === 'stale',
            },
          );
        }
      });
      if (input.kyc === 'STRONG') {
        await setStrongKyc(accountId);
      }
      return { recoveryId, challengeId, accountId };
    }

    async function complete(fixture: {
      recoveryId: string;
      challengeId: string | null;
    }): Promise<{ code: string | undefined; message: string }> {
      return catchFailure(() =>
        transact('app_rw', async (client) => {
          await client.query('SELECT identity.complete_recovery($1, $2)', [
            fixture.recoveryId,
            fixture.challengeId,
          ]);
        }),
      );
    }

    const noKyc = await complete(await setup({ seqBase: 1, phone: PHONE }));
    expect(noKyc.code).toBe('P0001');
    expect(noKyc.message).toContain('IDENTITY_RECOVERY_FORBIDDEN');

    const noProof = await complete(
      await setup({
        seqBase: 10,
        phone: '+237611111111',
        kyc: 'STRONG',
        proof: 'none',
      }),
    );
    expect(noProof.code).toBe('P0001');
    expect(noProof.message).toContain('IDENTITY_RECOVERY_FORBIDDEN');

    const cases: readonly {
      readonly phone: string;
      readonly proof: Proof;
      readonly seqBase: number;
    }[] = [
      { seqBase: 30, phone: '+237633333331', proof: 'wrong-binding' },
      { seqBase: 40, phone: '+237633333332', proof: 'wrong-purpose' },
      { seqBase: 50, phone: '+237633333333', proof: 'wrong-phone' },
      { seqBase: 60, phone: '+237633333334', proof: 'stale' },
    ];
    for (const testCase of cases) {
      const failure = await complete(
        await setup({ ...testCase, kyc: 'STRONG' }),
      );
      expect(failure.code).toBe('P0001');
      expect(failure.message).toContain('IDENTITY_RECOVERY_FORBIDDEN');
    }

    const tooEarly = await complete(
      await setup({
        seqBase: 70,
        phone: '+237622222222',
        kyc: 'STRONG',
        hadBalance: true,
      }),
    );
    expect(tooEarly.code).toBe('P0001');
    expect(tooEarly.message).toContain('IDENTITY_RECOVERY_NOT_DUE');

    const swapped = await admin.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM identity.account WHERE phone = $1',
      [OTHER_PHONE],
    );
    expect(swapped.rows[0]?.count).toBe(0);
  });

  it('refuse une récupération vers un numéro déjà attribué', async () => {
    let accountId = '';
    let recoveryId = '';
    let challengeId = '';
    await transact('app_rw', async (client) => {
      accountId = await insertAccount(client, 1);
      await insertAccount(client, 2, { phone: OTHER_PHONE });
      recoveryId = await insertRecovery(client, 3, accountId, {
        oldPhone: PHONE,
        newPhone: OTHER_PHONE,
      });
      challengeId = await insertConsumedRecoveryOtp(
        client,
        4,
        accountId,
        OTHER_PHONE,
      );
    });
    await setStrongKyc(accountId);

    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query('SELECT identity.complete_recovery($1, $2)', [
          recoveryId,
          challengeId,
        ]);
      }),
    );
    expect(failure.code).toBe('P0001');
    expect(failure.message).toContain('numéro déjà attribué');

    const phones = await admin.query<{ phone: string }>(
      'SELECT phone FROM identity.account ORDER BY phone',
    );
    expect(phones.rows.map((row) => row.phone)).toEqual([PHONE, OTHER_PHONE]);
  });

  it('réserve la clôture des récupérations aux fonctions dédiées', async () => {
    let recoveryId = '';
    await transact('app_rw', async (client) => {
      const accountId = await insertAccount(client, 1);
      recoveryId = await insertRecovery(client, 2, accountId);
    });

    const direct = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          `UPDATE identity.recovery SET status = 'CANCELLED' WHERE id = $1`,
          [recoveryId],
        );
      }),
    );
    expect(direct.code).toBe('42501');

    await transact('app_rw', async (client) => {
      await client.query('SELECT identity.cancel_recovery($1)', [recoveryId]);
    });
    const cancelled = await admin.query<{ status: string }>(
      'SELECT status FROM identity.recovery',
    );
    expect(cancelled.rows[0]?.status).toBe('CANCELLED');
  });

  it('refuse un changement de numéro hors récupération, même au propriétaire', async () => {
    const accountId = await transact('app_rw', (client) =>
      insertAccount(client, 1),
    );
    const failure = await catchFailure(() =>
      admin.query('UPDATE identity.account SET phone = $1 WHERE id = $2', [
        OTHER_PHONE,
        accountId,
      ]),
    );
    expect(failure.code).toBe('P0001');
    expect(failure.message).toContain('IDENTITY_RECOVERY_FORBIDDEN');
  });

  it("accepte IDENTITY_ACTION dans le journal et refuse un type inconnu", async () => {
    const genesis = Buffer.alloc(32);
    await transact('app_rw', async (client) => {
      await client.query(
        `INSERT INTO audit.event
           (seq, id, recorded_at, event_type, actor_id, action,
            target_type, target_id, outcome, prev_hash, event_hash)
         VALUES (1, $1, $2, 'IDENTITY_ACTION', $3, 'OTP_ISSUED',
                 'ACCOUNT', $3, 'SUCCESS', $4, $5)`,
        [uuid(1), NOW, uuid(2), genesis, bytes(32)],
      );
    });
    const unknown = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          `INSERT INTO audit.event
             (seq, id, recorded_at, event_type, actor_id, action,
              target_type, target_id, outcome, prev_hash, event_hash)
           VALUES (2, $1, $2, 'UNKNOWN_TYPE', $3, 'OTP_ISSUED',
                   'ACCOUNT', $3, 'SUCCESS', $4, $5)`,
          [uuid(3), NOW, uuid(4), bytes(32), bytes(32)],
        );
      }),
    );
    expect(unknown.code).toBe('23514');
  });
});
