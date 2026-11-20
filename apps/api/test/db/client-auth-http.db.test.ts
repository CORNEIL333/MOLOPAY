import 'reflect-metadata';
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { createDatabase, withTransaction, type Database } from '../../src/http/database';
import { challengeMessage, issueSignupOtp } from '../../src/modules/identity/client-auth.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * C2 / SEC-AUTH-001, F-ACC-001/002/004, D71 : inscription par OTP et
 * connexion par appareil + PIN, en HTTP réel sur PostgreSQL réel. Aucun
 * prestataire SMS n'est simulé : le défi est créé par la fonction réelle du
 * store (seul l'acheminement du code jusqu'au téléphone manque) et la route
 * d'envoi est vérifiée fermée (503) sans prestataire configuré.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['crm', 'kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const ORIGIN = 'https://app.molopay.test';
const PHONE = '+237690000123';
const PIN = '284917';
const TERMS = '2026-10-26-v1';
const OTP_PEPPER = randomBytes(32);
const PIN_PEPPER = randomBytes(32);

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];

function server(): Server {
  return app.getHttpServer() as Server;
}

function problem(response: { readonly status: number; readonly body: unknown }): [number, string | undefined] {
  return [response.status, (response.body as { code?: string }).code];
}

function post(path: string, body: object, key = `ca-${uuidv7()}`): request.Test {
  return request(server()).post(path).set('Origin', ORIGIN).set('Idempotency-Key', key).send(body);
}

function cookiesOf(response: request.Response): Record<string, string> {
  const header = response.headers['set-cookie'] as unknown;
  const list = Array.isArray(header) ? (header as string[]) : [];
  return Object.fromEntries(list.map((line) => [line.split('=')[0] ?? '', (line.split(';')[0] ?? '')]));
}

async function otp(phone = PHONE): Promise<{ challengeId: string; code: string }> {
  return withTransaction({ ...database, role: 'app_rw' }, (client) => issueSignupOtp(client, { phone, pepper: OTP_PEPPER }));
}

function deviceKey(): { privateKey: KeyObject; spki: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { privateKey, spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
}

async function attempts(challengeId: string): Promise<{ attempts_remaining: number; consumed: boolean } | undefined> {
  return (await admin.query<{ attempts_remaining: number; consumed: boolean }>(
    'SELECT attempts_remaining, consumed_at IS NOT NULL AS consumed FROM identity.otp_challenge WHERE id = $1', [challengeId],
  )).rows[0];
}

type SignedUp = { accountId: string; deviceId: string; privateKey: KeyObject; cookies: Record<string, string> };

async function signup(phone = PHONE): Promise<SignedUp> {
  const challenge = await otp(phone);
  const key = deviceKey();
  const response = await post('/v1/auth/signups', { challengeId: challenge.challengeId, code: challenge.code, pin: PIN, devicePublicKey: key.spki, deviceName: 'Tecno Spark', acceptTermsVersion: TERMS });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const body = response.body as { accountId: string; deviceId: string };
  return { accountId: body.accountId, deviceId: body.deviceId, privateKey: key.privateKey, cookies: cookiesOf(response) };
}

async function loginBody(deviceId: string, privateKey: KeyObject, pin = PIN, purpose: 'LOGIN' | 'REFRESH' = 'LOGIN'): Promise<{ challengeId: string; deviceId: string; signature: string; pin: string }> {
  const issued = await post('/v1/auth/device-challenges', { deviceId, purpose });
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  const { challengeId, challenge } = issued.body as { challengeId: string; challenge: string };
  const signature = sign(null, challengeMessage(purpose, challengeId, deviceId, Buffer.from(challenge, 'base64url')), privateKey).toString('base64');
  return { challengeId, deviceId, signature, pin };
}

function me(cookie: string): request.Test {
  return request(server()).get('/v1/me').set('Origin', ORIGIN).set('Cookie', cookie);
}

async function start(deps: { otpPepper: Uint8Array | null; pinPepper: Uint8Array | null }): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set([ORIGIN]), ...deps })] }).compile();
  const started = moduleRef.createNestApplication({ logger: false });
  await started.init();
  return started;
}

beforeAll(async () => {
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  app = await start({ otpPepper: OTP_PEPPER, pinPepper: PIN_PEPPER });
}, 300_000);

afterAll(async () => {
  await app.close();
  await database.pool.end();
  await admin.end();
  await db.stop();
});

beforeEach(async () => {
  for (const schema of SCHEMAS) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrations) {
    await admin.query(sql);
  }
});

describe('F-ACC-001 envoi du code d’inscription', () => {
  it('sans prestataire SMS configuré : 503 SMS_UNCONFIGURED, aucun défi enregistré (zéro simulation)', async () => {
    expect(problem(await post('/v1/auth/otp-challenges', { phone: PHONE, purpose: 'SIGNUP' }))).toEqual([503, 'SMS_UNCONFIGURED']);
    expect((await admin.query('SELECT count(*)::int AS n FROM identity.otp_challenge')).rows[0]).toEqual({ n: 0 });
  });
});

describe('F-ACC-001/002/004 inscription (POST /v1/auth/signups)', () => {
  it('code juste : compte, appareil, PIN Argon2id, conditions acceptées et session ; cookies émis ; profil lisible', async () => {
    const created = await signup();
    expect(created.accountId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(created.cookies).sort()).toEqual(['client_refresh', 'client_session']);
    expect(((await me(created.cookies['client_session'] ?? '')).body as { accountId?: string }).accountId).toBe(created.accountId);
    const rows = (await admin.query<{ phone: string; pin: string; terms: string; device: string }>(
      `SELECT a.phone, p.pin_hash AS pin, t.version AS terms, d.name AS device FROM identity.account a
         JOIN identity.device d ON d.account_id = a.id JOIN identity.pin_credential p ON p.device_id = d.id
         JOIN identity.terms_acceptance t ON t.account_id = a.id WHERE a.id = $1`, [created.accountId],
    )).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ phone: PHONE, terms: TERMS, device: 'Tecno Spark' });
    expect(rows[0]?.pin).toMatch(/^\$argon2id\$/);
    expect(rows[0]?.pin).not.toContain(PIN);
  });

  it('même clé d’idempotence rejouée : même réponse, aucun cookie, un seul compte', async () => {
    const challenge = await otp();
    const key = deviceKey();
    const body = { challengeId: challenge.challengeId, code: challenge.code, pin: PIN, devicePublicKey: key.spki, deviceName: 'Itel', acceptTermsVersion: TERMS };
    const first = await post('/v1/auth/signups', body, 'signup-replay-cle-0001');
    const second = await post('/v1/auth/signups', body, 'signup-replay-cle-0001');
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(cookiesOf(second)).toEqual({});
    expect((await admin.query('SELECT count(*)::int AS n FROM identity.account')).rows[0]).toEqual({ n: 1 });
  });

  it('code faux : refus IDENTITY_OTP_INVALID et essai décompté malgré le refus (pas d’essais illimités)', async () => {
    const challenge = await otp();
    const wrong = challenge.code === '000000' ? '000001' : '000000';
    const response = await post('/v1/auth/signups', { challengeId: challenge.challengeId, code: wrong, pin: PIN, devicePublicKey: deviceKey().spki, deviceName: 'Itel', acceptTermsVersion: TERMS });
    expect(problem(response)).toEqual([422, 'IDENTITY_OTP_INVALID']);
    expect(await attempts(challenge.challengeId)).toEqual({ attempts_remaining: 4, consumed: false });
    expect((await admin.query('SELECT count(*)::int AS n FROM identity.account')).rows[0]).toEqual({ n: 0 });
  });

  it('PIN trivial, clé illisible, conditions périmées, champ en trop : refus sans consommer le code', async () => {
    const challenge = await otp();
    const base = { challengeId: challenge.challengeId, code: challenge.code, pin: PIN, devicePublicKey: deviceKey().spki, deviceName: 'Itel', acceptTermsVersion: TERMS };
    expect(problem(await post('/v1/auth/signups', { ...base, pin: '123456' }))).toEqual([422, 'IDENTITY_PIN_WEAK']);
    expect(problem(await post('/v1/auth/signups', { ...base, devicePublicKey: 'AAAA'.repeat(12) }))).toEqual([400, 'IDENTITY_INVALID_REQUEST']);
    expect(problem(await post('/v1/auth/signups', { ...base, acceptTermsVersion: '2025-01-01-v1' }))).toEqual([400, 'REQUEST_INVALID']);
    expect(problem(await post('/v1/auth/signups', { ...base, kycLevel: 'STRONG' }))).toEqual([400, 'REQUEST_INVALID']);
    expect(await attempts(challenge.challengeId)).toEqual({ attempts_remaining: 5, consumed: false });
  });

  it('revue 2 : deux inscriptions simultanées du même numéro : une 201, l’autre 409 IDENTITY_ACCOUNT_EXISTS ; un seul compte', async () => {
    const first = await otp();
    const second = await otp();
    const body = (challenge: { challengeId: string; code: string }): object => ({ challengeId: challenge.challengeId, code: challenge.code, pin: PIN, devicePublicKey: deviceKey().spki, deviceName: 'Itel', acceptTermsVersion: TERMS });
    const results = await Promise.all([post('/v1/auth/signups', body(first)), post('/v1/auth/signups', body(second))]);
    expect(results.map(problem).map(([status, code]) => `${status.toString()} ${code ?? ''}`).sort()).toEqual(['201 ', '409 IDENTITY_ACCOUNT_EXISTS']);
    expect((await admin.query('SELECT count(*)::int AS n FROM identity.account')).rows[0]).toEqual({ n: 1 });
  });

  it('numéro déjà inscrit : 409 IDENTITY_ACCOUNT_EXISTS (seul le détenteur du code l’apprend) ; aucun second compte', async () => {
    await signup();
    const challenge = await otp();
    const response = await post('/v1/auth/signups', { challengeId: challenge.challengeId, code: challenge.code, pin: PIN, devicePublicKey: deviceKey().spki, deviceName: 'Itel', acceptTermsVersion: TERMS });
    expect(problem(response)).toEqual([409, 'IDENTITY_ACCOUNT_EXISTS']);
    expect((await admin.query('SELECT count(*)::int AS n FROM identity.account')).rows[0]).toEqual({ n: 1 });
  });
});

describe('D71 / SEC-AUTH-001 connexion par appareil enregistré et PIN', () => {
  it('défi signé par la clé de l’appareil et PIN juste : session ouverte, cookies émis, profil lisible', async () => {
    const created = await signup();
    const response = await post('/v1/auth/sessions', await loginBody(created.deviceId, created.privateKey));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((response.body as { accountId?: string }).accountId).toBe(created.accountId);
    const cookies = cookiesOf(response);
    expect(Object.keys(cookies).sort()).toEqual(['client_refresh', 'client_session']);
    expect((await me(cookies['client_session'] ?? '')).status).toBe(200);
  });

  it('défi rejoué avec une autre clé d’idempotence, signature d’une autre clé, défi d’un autre appareil : 401 IDENTITY_SESSION_INVALID', async () => {
    const created = await signup();
    const body = await loginBody(created.deviceId, created.privateKey);
    expect((await post('/v1/auth/sessions', body)).status).toBe(201);
    expect(problem(await post('/v1/auth/sessions', body))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
    const forged = await loginBody(created.deviceId, deviceKey().privateKey);
    expect(problem(await post('/v1/auth/sessions', forged))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
    const other = await signup('+237690000124');
    const theirs = await loginBody(other.deviceId, other.privateKey);
    expect(problem(await post('/v1/auth/sessions', { ...theirs, deviceId: created.deviceId }))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
  });

  it('PIN faux : refus IDENTITY_PIN_INVALID, essai décompté malgré le refus, aucune session', async () => {
    const created = await signup();
    const sessions = (await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM identity.session')).rows[0]?.n;
    const response = await post('/v1/auth/sessions', await loginBody(created.deviceId, created.privateKey, '927364'));
    expect(problem(response)).toEqual([422, 'IDENTITY_PIN_INVALID']);
    expect((await admin.query('SELECT failed_attempts FROM identity.pin_credential WHERE device_id = $1', [created.deviceId])).rows[0]).toEqual({ failed_attempts: 1 });
    expect((await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM identity.session')).rows[0]?.n).toBe(sessions);
  });

  it('appareil inconnu : défi de même forme, aléatoire, jamais enregistré', async () => {
    const created = await signup();
    const known = (await post('/v1/auth/device-challenges', { deviceId: created.deviceId, purpose: 'LOGIN' })).body as Record<string, string>;
    const unknown = await post('/v1/auth/device-challenges', { deviceId: uuidv7(), purpose: 'LOGIN' });
    expect(unknown.status).toBe(201);
    const body = unknown.body as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(Object.keys(known).sort());
    expect(body['challenge']?.length).toBe(known['challenge']?.length);
    expect((await admin.query('SELECT count(*)::int AS n FROM identity.device_login_challenge WHERE id = $1', [body['challengeId']])).rows[0]).toEqual({ n: 0 });
  });

  it('revue 2 : signature fausse — défi NON consommé ; la bonne signature du même défi ouvre ensuite la session', async () => {
    const created = await signup();
    const body = await loginBody(created.deviceId, created.privateKey);
    const forged = sign(null, Buffer.from('autre message'), created.privateKey).toString('base64');
    expect(problem(await post('/v1/auth/sessions', { ...body, signature: forged }))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
    expect((await admin.query('SELECT consumed_at IS NULL AS open FROM identity.device_login_challenge WHERE id = $1', [body.challengeId])).rows[0]).toEqual({ open: true });
    expect((await post('/v1/auth/sessions', body)).status).toBe(201);
  });

  it('revue 2 : compte bloqué après l’émission d’un vrai défi : 403 IDENTITY_ACCOUNT_BLOCKED, aucune session', async () => {
    const created = await signup();
    const body = await loginBody(created.deviceId, created.privateKey);
    await admin.query(`UPDATE identity.account SET status = 'BLOCKED', blocked_at = now(), block_channel = 'APP', block_reason = 'LOST_OR_STOLEN' WHERE id = $1`, [created.accountId]);
    expect(problem(await post('/v1/auth/sessions', body))).toEqual([403, 'IDENTITY_ACCOUNT_BLOCKED']);
    expect((await admin.query('SELECT count(*)::int AS n FROM identity.session WHERE device_id = $1', [created.deviceId])).rows[0]).toEqual({ n: 1 });
  });

  it('revue 2 : défi de renouvellement présenté à la connexion : 401 IDENTITY_SESSION_INVALID ; objet inconnu : 400', async () => {
    const created = await signup();
    expect(problem(await post('/v1/auth/sessions', await loginBody(created.deviceId, created.privateKey, PIN, 'REFRESH')))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
    expect(problem(await post('/v1/auth/device-challenges', { deviceId: created.deviceId, purpose: 'ADMIN' }))).toEqual([400, 'REQUEST_INVALID']);
    expect(problem(await post('/v1/auth/device-challenges', { deviceId: uuidv7(), purpose: 'ADMIN' }))).toEqual([400, 'REQUEST_INVALID']);
    // Défi REFRESH signé dans le contexte de connexion : refusé par l'objet du défi lui-même (pas seulement par le contexte).
    const issued = await post('/v1/auth/device-challenges', { deviceId: created.deviceId, purpose: 'REFRESH' });
    const { challengeId, challenge } = issued.body as { challengeId: string; challenge: string };
    const crossSigned = sign(null, challengeMessage('LOGIN', challengeId, created.deviceId, Buffer.from(challenge, 'base64url')), created.privateKey).toString('base64');
    expect(problem(await post('/v1/auth/sessions', { challengeId, deviceId: created.deviceId, signature: crossSigned, pin: PIN }))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
  });

  it('compte bloqué : défi indiscernable non enregistré, connexion refusée', async () => {
    const created = await signup();
    await admin.query(`UPDATE identity.account SET status = 'BLOCKED', blocked_at = now(), block_channel = 'APP', block_reason = 'LOST_OR_STOLEN' WHERE id = $1`, [created.accountId]);
    const response = await post('/v1/auth/sessions', await loginBody(created.deviceId, created.privateKey));
    expect(problem(response)).toEqual([401, 'IDENTITY_SESSION_INVALID']);
  });
});

describe('fermé par défaut', () => {
  it('sans poivre PIN : inscription et connexion 503 PIN_UNCONFIGURED ; sans poivre OTP : inscription 503 SMS_UNCONFIGURED', async () => {
    const closed = await start({ otpPepper: OTP_PEPPER, pinPepper: null });
    const noOtp = await start({ otpPepper: null, pinPepper: PIN_PEPPER });
    try {
      const body = { challengeId: uuidv7(), code: '123456', pin: PIN, devicePublicKey: deviceKey().spki, deviceName: 'Itel', acceptTermsVersion: TERMS };
      const call = (target: INestApplication, path: string, payload: object): request.Test =>
        request(target.getHttpServer() as Server).post(path).set('Origin', ORIGIN).set('Idempotency-Key', `ca-${uuidv7()}`).send(payload);
      expect(problem(await call(closed, '/v1/auth/signups', body))).toEqual([503, 'PIN_UNCONFIGURED']);
      expect(problem(await call(closed, '/v1/auth/sessions', { challengeId: uuidv7(), deviceId: uuidv7(), signature: Buffer.alloc(64).toString('base64'), pin: PIN }))).toEqual([503, 'PIN_UNCONFIGURED']);
      expect(problem(await call(noOtp, '/v1/auth/signups', body))).toEqual([503, 'SMS_UNCONFIGURED']);
    } finally {
      await closed.close();
      await noOtp.close();
    }
  });
});
