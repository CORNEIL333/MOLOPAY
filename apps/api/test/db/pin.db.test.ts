import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPin } from '../../src/modules/identity/domain';
import { verifyPinFromStore, type PinVerification } from '../../src/modules/identity/pin.store';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  'db/migrations/0002_audit.sql',
  'db/migrations/0004_identity.sql',
  'db/migrations/0005_audit_metadata.sql',
  'db/migrations/0007_identity_clock.sql',
  'db/migrations/0016_identity_pin_guard.sql',
].map((path) => resolve(process.cwd(), path));

const ACCOUNT_ID = '019a9300-0000-7000-8000-0000000000a1';
const DEVICE_ID = '019a9300-0000-7000-8000-0000000000d1';
const PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAdGVzdA==\n-----END PUBLIC KEY-----\n';
const GOOD_PIN = '482915';
const BAD_PIN = '173920';
// Poivre aléatoire propre à l'exécution : aucune valeur fixe dans le dépôt.
const PEPPER = randomBytes(32);

let container: TestDatabase;
let admin: Client;
let migrationSql: string[];
let pinHash = '';

/** Un essai par connexion, validé même en cas d'échec (comme l'API). */
async function attempt(pin: string): Promise<PinVerification> {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_rw');
    const result = await verifyPinFromStore(client, {
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
      pin,
      pepper: PEPPER,
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function counters(): Promise<{
  failed_attempts: number;
  lockouts: number;
  locked: boolean;
}> {
  const row = await admin.query<{ failed_attempts: number; lockouts: number; locked: boolean }>(
    `SELECT failed_attempts, lockouts,
            COALESCE(locked_until > clock_timestamp(), false) AS locked
     FROM identity.pin_credential WHERE device_id = $1`,
    [DEVICE_ID],
  );
  const value = row.rows[0];
  if (value === undefined) throw new Error('PIN absent');
  return value;
}

async function rawUpdate(sql: string): Promise<{ code?: string; message: string }> {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_rw');
    await client.query(sql, [DEVICE_ID]);
    await client.query('ROLLBACK');
    return { message: 'aucune erreur' };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const failure = error as { code?: string; message?: string };
    return { ...(failure.code === undefined ? {} : { code: failure.code }), message: failure.message ?? '' };
  } finally {
    await client.end();
  }
}

async function seed(
  options: { readonly lockedInPast?: boolean; readonly lockouts?: number } = {},
): Promise<void> {
  await admin.query(
    `INSERT INTO identity.account (id, phone, phone_verified_at)
     VALUES ($1, '+237612345678', now())`,
    [ACCOUNT_ID],
  );
  await admin.query(
    `INSERT INTO identity.device
       (id, account_id, public_key_pem, fingerprint, name, status, registered_at)
     VALUES ($1, $2, $3, $4, 'Appareil', 'ACTIVE', now())`,
    [DEVICE_ID, ACCOUNT_ID, PUBLIC_KEY, Buffer.alloc(32, 7)],
  );
  await admin.query(
    `INSERT INTO identity.pin_credential
       (device_id, account_id, pin_hash, lockouts, locked_until, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [
      DEVICE_ID,
      ACCOUNT_ID,
      pinHash,
      options.lockouts ?? (options.lockedInPast === true ? 1 : 0),
      options.lockedInPast === true ? new Date(Date.now() - 60_000) : null,
    ],
  );
}

beforeAll(async () => {
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  migrationSql = await Promise.all(MIGRATIONS.map((path) => readFile(path, 'utf8')));
  pinHash = await hashPin(GOOD_PIN, PEPPER);
}, 120_000);

afterAll(async () => {
  await admin.end();
  await container.stop();
});

beforeEach(async () => {
  await admin.query('DROP SCHEMA IF EXISTS identity CASCADE');
  await admin.query('DROP SCHEMA IF EXISTS audit CASCADE');
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
});

describe('SEC-AUTH-002 · vérification du PIN (PostgreSQL réel)', () => {
  it('SEC-AUTH-002 accepte le bon PIN sans toucher aux compteurs', async () => {
    await seed();
    expect(await attempt(GOOD_PIN)).toEqual({ ok: true });
    expect(await counters()).toEqual({ failed_attempts: 0, lockouts: 0, locked: false });
  });

  it('SEC-AUTH-002 enregistre un échec et le remet à zéro après un succès', async () => {
    await seed();
    expect(await attempt(BAD_PIN)).toEqual({ ok: false, code: 'IDENTITY_PIN_INVALID' });
    expect((await counters()).failed_attempts).toBe(1);
    expect(await attempt(GOOD_PIN)).toEqual({ ok: true });
    expect((await counters()).failed_attempts).toBe(0);
  });

  it('SEC-AUTH-002 verrouille au cinquième échec et refuse ensuite même le bon PIN', async () => {
    await seed();
    for (let index = 0; index < 4; index += 1) {
      expect(await attempt(BAD_PIN)).toEqual({ ok: false, code: 'IDENTITY_PIN_INVALID' });
    }
    expect(await attempt(BAD_PIN)).toEqual({ ok: false, code: 'IDENTITY_PIN_LOCKED' });
    expect(await counters()).toEqual({ failed_attempts: 0, lockouts: 1, locked: true });
    expect(await attempt(GOOD_PIN)).toEqual({ ok: false, code: 'IDENTITY_PIN_LOCKED' });
  });

  it('SEC-AUTH-002 dix essais simultanés : aucun n’échappe au décompte', async () => {
    await seed();
    const results = await Promise.all(Array.from({ length: 10 }, () => attempt(BAD_PIN)));
    const invalid = results.filter((result) => !result.ok && result.code === 'IDENTITY_PIN_INVALID');
    const locked = results.filter((result) => !result.ok && result.code === 'IDENTITY_PIN_LOCKED');
    expect(invalid).toHaveLength(4);
    expect(locked).toHaveLength(6);
    expect(await counters()).toEqual({ failed_attempts: 0, lockouts: 1, locked: true });
  });

  it('SEC-AUTH-002 un verrou expiré laisse un nouvel essai, décompté depuis zéro', async () => {
    await seed({ lockedInPast: true });
    expect(await attempt(BAD_PIN)).toEqual({ ok: false, code: 'IDENTITY_PIN_INVALID' });
    expect(await counters()).toEqual({ failed_attempts: 1, lockouts: 1, locked: false });
  });

  it('SEC-AUTH-002 un appareil sans PIN est refusé', async () => {
    await seed();
    await admin.query('DELETE FROM identity.pin_credential');
    await expect(attempt(GOOD_PIN)).rejects.toMatchObject({ code: 'IDENTITY_DEVICE_UNKNOWN' });
  });
});

describe('SEC-AUTH-002 · compteurs PIN protégés par la base (PostgreSQL réel)', () => {
  it('refuse d’effacer un verrouillage actif', async () => {
    await seed();
    for (let index = 0; index < 5; index += 1) {
      await attempt(BAD_PIN);
    }
    const failure = await rawUpdate(
      `UPDATE identity.pin_credential SET locked_until = NULL WHERE device_id = $1`,
    );
    expect(failure.message).toContain('IDENTITY_PIN_LOCKED');
  });

  it.each([
    ['sauter des essais', 'SET failed_attempts = 3'],
    ['faire régresser les verrous', 'SET lockouts = 0'],
    ['verrouiller sans incrément', `SET locked_until = clock_timestamp() + interval '1 hour'`],
    ['verrouiller avant le cinquième échec', `SET lockouts = 2, failed_attempts = 0, locked_until = clock_timestamp() + interval '1 hour'`],
  ])('refuse de %s', async (_label, assignment) => {
    await seed({ lockouts: 1 });
    const failure = await rawUpdate(
      `UPDATE identity.pin_credential ${assignment} WHERE device_id = $1`,
    );
    expect(failure.message).toContain('IDENTITY_INVALID_REQUEST');
  });

  it('refuse de déplacer le PIN vers un autre compte', async () => {
    await seed();
    const failure = await rawUpdate(
      `UPDATE identity.pin_credential SET failed_attempts = 1, account_id = gen_random_uuid() WHERE device_id = $1`,
    );
    // Colonne hors des droits UPDATE accordés à app_rw (0004).
    expect(failure.code).toBe('42501');
  });
});
