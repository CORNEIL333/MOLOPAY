import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * C2 / SEC-AUTH-001 (migration 0066) : la base garantit que le rôle applicatif
 * ne crée ni compte sans OTP d'inscription consommé, ni appareil sans preuve,
 * ni session sans défi de connexion consommé (ou appareil tout juste
 * enregistré) ; envoi d'OTP limité par numéro ; acceptation des conditions et
 * défis de connexion en ajout seul. PostgreSQL réel, toutes les migrations.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['crm', 'kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const PHONE = '+237690000001';

let container: TestDatabase;
let admin: Client;
let migrations: string[];

async function asApp<T>(action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_rw');
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

/** Voyage dans le temps pour les tests : le déclencheur protecteur est suspendu par le superutilisateur, le temps d'une mise à jour. */
async function rewind(table: string, trigger: string, sql: string, params: unknown[]): Promise<void> {
  await admin.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  try {
    await admin.query(sql, params);
  } finally {
    await admin.query(`ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${trigger}`);
  }
}

async function failure(action: () => Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  try {
    await action();
  } catch (error: unknown) {
    if (error instanceof BusinessError) return { code: error.code, message: error.message };
    const pg = error as { code?: string; message?: string };
    return { code: pg.code, message: pg.message ?? '' };
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

/** Défi OTP inséré par l'application ; `consumed` simule la vérification réussie (colonne autorisée à app_rw). */
async function otp(phone: string, purpose: 'SIGNUP' | 'NEW_DEVICE', binding: string, consumed: boolean): Promise<string> {
  const id = uuidv7();
  await asApp(async (client) => {
    await client.query(
      `INSERT INTO identity.otp_challenge (id, phone, purpose, binding, code_hash, expires_at, attempts_remaining)
       VALUES ($1, $2, $3, $4, $5, now() + interval '5 minutes', 5)`,
      [id, phone, purpose, binding, randomBytes(32)],
    );
    if (consumed) {
      await client.query('UPDATE identity.otp_challenge SET consumed_at = clock_timestamp(), attempts_remaining = 4 WHERE id = $1', [id]);
    }
  });
  return id;
}

function insertAccount(client: Client, id: string, phone: string): Promise<unknown> {
  return client.query('INSERT INTO identity.account (id, phone, phone_verified_at) VALUES ($1, $2, now())', [id, phone]);
}

function insertDevice(client: Client, id: string, accountId: string): Promise<unknown> {
  const { publicKey } = generateKeyPairSync('ed25519');
  return client.query(
    `INSERT INTO identity.device (id, account_id, public_key_pem, fingerprint, name, status, registered_at) VALUES ($1, $2, $3, $4, 'Téléphone', 'ACTIVE', now())`,
    [id, accountId, publicKey.export({ type: 'spki', format: 'pem' }), createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest()],
  );
}

function insertSession(client: Client, accountId: string, deviceId: string): Promise<unknown> {
  return client.query(
    `INSERT INTO identity.session (id, account_id, device_id, access_token_hash, refresh_token_hash, access_issued_at, access_expires_at, refresh_expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, now(), now() + interval '15 minutes', now() + interval '30 days', now())`,
    [uuidv7(), accountId, deviceId, randomBytes(32), randomBytes(32)],
  );
}

beforeAll(async () => {
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
}, 120_000);

afterAll(async () => {
  await admin.end();
  await container.stop();
});

beforeEach(async () => {
  for (const schema of SCHEMAS) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrations) {
    await admin.query(sql);
  }
});

describe('C2 / SEC-AUTH-001 compte, appareil et session garantis par la base', () => {
  it('compte : refusé sans OTP d’inscription consommé pour ce numéro (IDENTITY_OTP_INVALID) ; accepté avec, date de vérification prise de l’OTP', async () => {
    expect((await failure(() => asApp((client) => insertAccount(client, uuidv7(), PHONE)))).message).toMatch(/^IDENTITY_OTP_INVALID: aucun OTP d'inscription vérifié/);
    await otp(PHONE, 'SIGNUP', PHONE, false);
    expect((await failure(() => asApp((client) => insertAccount(client, uuidv7(), PHONE)))).message).toMatch(/^IDENTITY_OTP_INVALID/);
    await otp('+237690000002', 'SIGNUP', '+237690000002', true);
    expect((await failure(() => asApp((client) => insertAccount(client, uuidv7(), PHONE)))).message).toMatch(/^IDENTITY_OTP_INVALID/);
    const challenge = await otp(PHONE, 'SIGNUP', PHONE, true);
    const id = uuidv7();
    await asApp((client) => insertAccount(client, id, PHONE));
    const row = (await admin.query<{ same: boolean }>(
      'SELECT a.phone_verified_at = c.consumed_at AS same FROM identity.account a, identity.otp_challenge c WHERE a.id = $1 AND c.id = $2', [id, challenge],
    )).rows[0];
    expect(row).toEqual({ same: true });
  });

  it('compte : un OTP vérifié depuis plus de 10 minutes ne vaut plus', async () => {
    const challenge = await otp(PHONE, 'SIGNUP', PHONE, true);
    await rewind('identity.otp_challenge', 'otp_challenge_protect', `UPDATE identity.otp_challenge SET consumed_at = clock_timestamp() - interval '11 minutes', expires_at = clock_timestamp() - interval '6 minutes' WHERE id = $1`, [challenge]);
    expect((await failure(() => asApp((client) => insertAccount(client, uuidv7(), PHONE)))).message).toMatch(/^IDENTITY_OTP_INVALID/);
  });

  it('premier appareil : preuve d’inscription récente exigée ; appareil suivant : OTP « nouvel appareil » lié à son identifiant (IDENTITY_OTP_INVALID)', async () => {
    await otp(PHONE, 'SIGNUP', PHONE, true);
    const account = uuidv7();
    const first = uuidv7();
    await asApp(async (client) => {
      await insertAccount(client, account, PHONE);
      await insertDevice(client, first, account);
    });
    const second = uuidv7();
    expect((await failure(() => asApp((client) => insertDevice(client, second, account)))).message).toMatch(/^IDENTITY_OTP_INVALID: aucun OTP « nouvel appareil »/);
    await otp(PHONE, 'NEW_DEVICE', uuidv7(), true);
    expect((await failure(() => asApp((client) => insertDevice(client, second, account)))).message).toMatch(/^IDENTITY_OTP_INVALID/);
    await otp(PHONE, 'NEW_DEVICE', second, true);
    await asApp((client) => insertDevice(client, second, account));
  });

  it('session : refusée sans défi de connexion consommé, sauf pour un appareil tout juste enregistré et encore sans session (IDENTITY_SESSION_INVALID)', async () => {
    await otp(PHONE, 'SIGNUP', PHONE, true);
    const account = uuidv7();
    const device = uuidv7();
    await asApp(async (client) => {
      await insertAccount(client, account, PHONE);
      await insertDevice(client, device, account);
      await insertSession(client, account, device);
    });
    expect((await failure(() => asApp((client) => insertSession(client, account, device)))).message).toMatch(/^IDENTITY_SESSION_INVALID: aucun défi de connexion consommé/);
    const challenge = uuidv7();
    await asApp(async (client) => {
      await client.query('INSERT INTO identity.device_login_challenge (id, device_id, challenge, issued_at, expires_at) VALUES ($1, $2, $3, now(), now())', [challenge, device, randomBytes(32)]);
    });
    expect((await failure(() => asApp((client) => insertSession(client, account, device)))).message).toMatch(/^IDENTITY_SESSION_INVALID/);
    await asApp((client) => client.query('UPDATE identity.device_login_challenge SET consumed_at = clock_timestamp() WHERE id = $1', [challenge]));
    await asApp((client) => insertSession(client, account, device));
    expect((await failure(() => asApp((client) => insertSession(client, account, device)))).message).toMatch(/^IDENTITY_SESSION_INVALID/);
  });

  it('défi de connexion : durée fixée par la base (2 min), consommé une seule fois, jamais modifié ni supprimé autrement', async () => {
    await otp(PHONE, 'SIGNUP', PHONE, true);
    const account = uuidv7();
    const device = uuidv7();
    await asApp(async (client) => {
      await insertAccount(client, account, PHONE);
      await insertDevice(client, device, account);
    });
    const challenge = uuidv7();
    await asApp((client) => client.query(`INSERT INTO identity.device_login_challenge (id, device_id, challenge, issued_at, expires_at) VALUES ($1, $2, $3, now() - interval '1 day', now() + interval '1 day')`, [challenge, device, randomBytes(32)]));
    expect((await admin.query<{ seconds: number }>('SELECT extract(epoch FROM expires_at - issued_at)::int AS seconds FROM identity.device_login_challenge WHERE id = $1', [challenge])).rows[0]).toEqual({ seconds: 120 });
    await asApp((client) => client.query('UPDATE identity.device_login_challenge SET consumed_at = clock_timestamp() WHERE id = $1', [challenge]));
    expect((await failure(() => asApp((client) => client.query('UPDATE identity.device_login_challenge SET consumed_at = clock_timestamp() WHERE id = $1', [challenge])))).message).toMatch(/^IDENTITY_APPEND_ONLY/);
    expect((await failure(() => asApp((client) => client.query('UPDATE identity.device_login_challenge SET challenge = $2 WHERE id = $1', [challenge, randomBytes(32)])))).code).toBe('42501');
    expect((await failure(() => asApp((client) => client.query('DELETE FROM identity.device_login_challenge WHERE id = $1', [challenge])))).code).toBe('42501');
  });

  it('défi expiré : sa consommation est refusée (IDENTITY_SESSION_INVALID)', async () => {
    await otp(PHONE, 'SIGNUP', PHONE, true);
    const account = uuidv7();
    const device = uuidv7();
    await asApp(async (client) => {
      await insertAccount(client, account, PHONE);
      await insertDevice(client, device, account);
    });
    const challenge = uuidv7();
    await asApp((client) => client.query('INSERT INTO identity.device_login_challenge (id, device_id, challenge, issued_at, expires_at) VALUES ($1, $2, $3, now(), now())', [challenge, device, randomBytes(32)]));
    await rewind('identity.device_login_challenge', 'device_login_challenge_consume', `UPDATE identity.device_login_challenge SET issued_at = issued_at - interval '121 seconds', expires_at = expires_at - interval '121 seconds' WHERE id = $1`, [challenge]);
    expect((await failure(() => asApp((client) => client.query('UPDATE identity.device_login_challenge SET consumed_at = clock_timestamp() WHERE id = $1', [challenge])))).message).toMatch(/^IDENTITY_SESSION_INVALID: défi expiré/);
  });

  it('envoi d’OTP : 5 défis au plus par numéro et par heure (REQUEST_RATE_LIMITED) ; un autre numéro n’est pas touché', async () => {
    for (let index = 0; index < 5; index += 1) await otp(PHONE, 'SIGNUP', PHONE, false);
    expect((await failure(() => otp(PHONE, 'SIGNUP', PHONE, false))).message).toMatch(/^REQUEST_RATE_LIMITED/);
    await otp('+237690000009', 'SIGNUP', '+237690000009', false);
  });

  it('acceptation des conditions : en ajout seul, horodatée par la base, une fois par version', async () => {
    await otp(PHONE, 'SIGNUP', PHONE, true);
    const account = uuidv7();
    await asApp(async (client) => {
      await insertAccount(client, account, PHONE);
      await client.query(`INSERT INTO identity.terms_acceptance (account_id, version, accepted_at) VALUES ($1, '2026-10-26-v1', now() - interval '1 year')`, [account]);
    });
    expect((await admin.query<{ recent: boolean }>(`SELECT accepted_at > now() - interval '1 minute' AS recent FROM identity.terms_acceptance WHERE account_id = $1`, [account])).rows[0]).toEqual({ recent: true });
    expect((await failure(() => asApp((client) => client.query(`INSERT INTO identity.terms_acceptance (account_id, version, accepted_at) VALUES ($1, '2026-10-26-v1', now())`, [account])))).code).toBe('23505');
    expect((await failure(() => asApp((client) => client.query('UPDATE identity.terms_acceptance SET version = $2 WHERE account_id = $1', [account, 'x'])))).code).toBe('42501');
  });

  it('revue 2 : session pour un compte qui ne possède pas l’appareil, ou antidatée pour réutiliser un défi : refusée (IDENTITY_SESSION_INVALID)', async () => {
    await otp(PHONE, 'SIGNUP', PHONE, true);
    const victim = uuidv7();
    const attacker = uuidv7();
    const device = uuidv7();
    await otp('+237690000002', 'SIGNUP', '+237690000002', true);
    await asApp(async (client) => {
      await insertAccount(client, victim, PHONE);
      await insertAccount(client, attacker, '+237690000002');
      await insertDevice(client, device, attacker);
      await insertSession(client, attacker, device);
    });
    const challenge = uuidv7();
    await asApp(async (client) => {
      await client.query(`INSERT INTO identity.device_login_challenge (id, device_id, challenge, issued_at, expires_at) VALUES ($1, $2, $3, now(), now())`, [challenge, device, randomBytes(32)]);
      await client.query('UPDATE identity.device_login_challenge SET consumed_at = clock_timestamp() WHERE id = $1', [challenge]);
    });
    expect((await failure(() => asApp((client) => insertSession(client, victim, device)))).message).toMatch(/^IDENTITY_SESSION_INVALID: appareil d'un autre compte/);
    const backdated = (client: Client): Promise<unknown> => client.query(
      `INSERT INTO identity.session (id, account_id, device_id, access_token_hash, refresh_token_hash, access_issued_at, access_expires_at, refresh_expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, now(), now() + interval '15 minutes', now() + interval '30 days', now() - interval '1 hour')`,
      [uuidv7(), attacker, device, randomBytes(32), randomBytes(32)],
    );
    await asApp(backdated);
    expect((await failure(() => asApp(backdated))).message).toMatch(/^IDENTITY_SESSION_INVALID/);
    expect((await admin.query<{ recent: boolean }>(`SELECT bool_and(created_at > now() - interval '5 minutes') AS recent FROM identity.session WHERE device_id = $1`, [device])).rows[0]).toEqual({ recent: true });
  });

  it('revue 2 : un défi de RENOUVELLEMENT consommé n’ouvre pas de session ; objet du défi immuable', async () => {
    await otp(PHONE, 'SIGNUP', PHONE, true);
    const account = uuidv7();
    const device = uuidv7();
    await asApp(async (client) => {
      await insertAccount(client, account, PHONE);
      await insertDevice(client, device, account);
      await insertSession(client, account, device);
    });
    const challenge = uuidv7();
    await asApp(async (client) => {
      await client.query(`INSERT INTO identity.device_login_challenge (id, device_id, challenge, issued_at, expires_at, purpose) VALUES ($1, $2, $3, now(), now(), 'REFRESH')`, [challenge, device, randomBytes(32)]);
      await client.query('UPDATE identity.device_login_challenge SET consumed_at = clock_timestamp() WHERE id = $1', [challenge]);
    });
    expect((await failure(() => asApp((client) => insertSession(client, account, device)))).message).toMatch(/^IDENTITY_SESSION_INVALID/);
    expect((await failure(() => asApp((client) => client.query(`UPDATE identity.device_login_challenge SET purpose = 'LOGIN' WHERE id = $1`, [challenge])))).code).toBe('42501');
    const pending = uuidv7();
    await asApp((client) => client.query(`INSERT INTO identity.device_login_challenge (id, device_id, challenge, issued_at, expires_at, purpose) VALUES ($1, $2, $3, now(), now(), 'REFRESH')`, [pending, device, randomBytes(32)]));
    expect((await failure(() => admin.query(`UPDATE identity.device_login_challenge SET purpose = 'LOGIN', consumed_at = clock_timestamp() WHERE id = $1`, [pending]))).message).toMatch(/^IDENTITY_APPEND_ONLY/);
  });

  it('revue 2 : 10 défis non consommés au plus par appareil en 10 minutes (REQUEST_RATE_LIMITED)', async () => {
    await otp(PHONE, 'SIGNUP', PHONE, true);
    const account = uuidv7();
    const device = uuidv7();
    await asApp(async (client) => {
      await insertAccount(client, account, PHONE);
      await insertDevice(client, device, account);
    });
    const issue = (): Promise<unknown> => asApp((client) => client.query(`INSERT INTO identity.device_login_challenge (id, device_id, challenge, issued_at, expires_at) VALUES ($1, $2, $3, now(), now())`, [uuidv7(), device, randomBytes(32)]));
    for (let index = 0; index < 10; index += 1) await issue();
    expect((await failure(issue)).message).toMatch(/^REQUEST_RATE_LIMITED/);
  });
});

