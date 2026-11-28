import 'reflect-metadata';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { createDatabase, type Database } from '../../src/http/database';
import { issueSessionTokens } from '../../src/modules/identity/domain';
import { sessionCookieValue } from '../../src/modules/identity/session.store';
import { challengeMessage } from '../../src/modules/identity/client-auth.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { seedCustomerAccount } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

/** C2 / SEC-AUTH-001 / SEC-AUTH-005 : renouvellement de la session client, lié à l'appareil (défi signé) et au jeton de rafraîchissement à usage unique, en HTTP réel. */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const ORIGIN = 'https://app.molopay.test';
const CUSTOMER = '019ab810-0000-7000-8000-0000000000c1';


/** Statut et code métier d'une réponse d'erreur (règle 8 : un refus vérifie le code exact). */
function problem(response: { readonly status: number; readonly body: unknown }): [number, string | undefined] {
  return [response.status, (response.body as { code?: string }).code];
}
let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];

function server(): Server {
  return app.getHttpServer() as Server;
}

type Seeded = { readonly access: string; readonly refresh: string; readonly sessionId: string; readonly deviceId: string; readonly privateKey: KeyObject };

/** Session réelle (appareil à clé connue, jetons) ; renvoie les deux cookies tels que l'API les émet. */
async function seedSession(accountId: string): Promise<Seeded> {
  const device = uuidv7();
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  await admin.query(
    `INSERT INTO identity.device(id, account_id, public_key_pem, fingerprint, name, status, registered_at) VALUES ($1, $2, $3, $4, 'Appareil test', 'ACTIVE', now())`,
    [device, accountId, publicKey.export({ type: 'spki', format: 'pem' }), createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest()],
  );
  const sessionId = uuidv7();
  const token = issueSessionTokens();
  await admin.query(
    `INSERT INTO identity.session(id, account_id, device_id, access_token_hash, refresh_token_hash, access_issued_at, access_expires_at, refresh_expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, now() - interval '1 minute', now() + interval '10 minutes', now() + interval '1 day', now() - interval '1 minute')`,
    [sessionId, accountId, device, token.accessTokenHash, token.refreshTokenHash],
  );
  return { sessionId, deviceId: device, privateKey, access: `client_session=${sessionCookieValue(sessionId, token.accessToken)}`, refresh: `client_refresh=${sessionId}.${token.refreshToken}` };
}

/** Défi demandé pour l'appareil et signé par sa clé (objet REFRESH par défaut). */
async function signed(deviceId: string, privateKey: KeyObject, purpose: 'LOGIN' | 'REFRESH' = 'REFRESH'): Promise<{ challengeId: string; signature: string }> {
  const issued = await request(server()).post('/v1/auth/device-challenges').set('Origin', ORIGIN).set('Idempotency-Key', `dc-${uuidv7()}`).send({ deviceId, purpose });
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  const { challengeId, challenge } = issued.body as { challengeId: string; challenge: string };
  return { challengeId, signature: sign(null, challengeMessage(purpose, challengeId, deviceId, Buffer.from(challenge, 'base64url')), privateKey).toString('base64') };
}

function refresh(cookie: string | null, body: object, key = `rf-${uuidv7()}`, origin: string | null = ORIGIN): request.Test {
  let call = request(server()).post('/v1/auth/session-refreshes').set('Idempotency-Key', key);
  if (origin !== null) call = call.set('Origin', origin);
  return (cookie === null ? call : call.set('Cookie', cookie)).send(body);
}

function cookiesOf(response: request.Response): Record<string, string> {
  const header = response.headers['set-cookie'] as unknown;
  const list = Array.isArray(header) ? (header as string[]) : [];
  return Object.fromEntries(list.map((line) => [line.split('=')[0] ?? '', line]));
}

function me(cookie: string): request.Test {
  return request(server()).get('/v1/me').set('Origin', ORIGIN).set('Cookie', cookie);
}

beforeAll(async () => {
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set([ORIGIN]) })] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
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
  await seedCustomerAccount(admin, CUSTOMER, 'NONE');
});

describe('C2 / SEC-AUTH-005 renouvellement de session lié à l’appareil (POST /v1/auth/session-refreshes)', () => {
  it('défi REFRESH signé par l’appareil + jeton : nouveaux cookies (HttpOnly, Secure, chemins restreints) ; ancien accès refusé, nouveau accepté', async () => {
    const seeded = await seedSession(CUSTOMER);
    const response = await refresh(seeded.refresh, await signed(seeded.deviceId, seeded.privateKey));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(Object.keys(response.body as object)).toEqual(['accessExpiresAt']);
    const cookies = cookiesOf(response);
    expect(cookies['client_session']).toMatch(/^client_session=[0-9a-f-]{36}\.[A-Za-z0-9_-]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=900$/);
    expect(cookies['client_refresh']).toMatch(/^client_refresh=[0-9a-f-]{36}\.[A-Za-z0-9_-]+; Path=\/v1\/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=\d+$/);
    expect(problem(await me(seeded.access))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
    expect((await me((cookies['client_session'] ?? '').split(';')[0] ?? '')).status).toBe(200);
  });

  it('cookie volé sans la clé de l’appareil : refus (IDENTITY_SESSION_INVALID) ; défi de connexion, défi d’un autre appareil ou corps absent : refus', async () => {
    const seeded = await seedSession(CUSTOMER);
    const { privateKey: other } = generateKeyPairSync('ed25519');
    expect(problem(await refresh(seeded.refresh, await signed(seeded.deviceId, other)))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
    expect(problem(await refresh(seeded.refresh, await signed(seeded.deviceId, seeded.privateKey, 'LOGIN')))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
    const second = await seedSession(CUSTOMER);
    expect(problem(await refresh(seeded.refresh, await signed(second.deviceId, second.privateKey)))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
    expect(problem(await refresh(seeded.refresh, {}))).toEqual([400, 'REQUEST_INVALID']);
    expect((await me(seeded.access)).status).toBe(200);
  });

  it('réutilisation d’un ancien jeton de rafraîchissement : refus et session révoquée (vol présumé)', async () => {
    const seeded = await seedSession(CUSTOMER);
    const first = await refresh(seeded.refresh, await signed(seeded.deviceId, seeded.privateKey));
    expect(first.status).toBe(201);
    const fresh = (cookiesOf(first)['client_session'] ?? '').split(';')[0] ?? '';
    expect(problem(await refresh(seeded.refresh, await signed(seeded.deviceId, seeded.privateKey)))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
    expect((await admin.query('SELECT revoked_at IS NOT NULL AS revoked FROM identity.session WHERE id = $1', [seeded.sessionId])).rows[0]).toEqual({ revoked: true });
    expect(problem(await me(fresh))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
  });

  it('même clé d’idempotence rejouée : même réponse, aucune nouvelle rotation ni nouveau cookie', async () => {
    const seeded = await seedSession(CUSTOMER);
    const body = await signed(seeded.deviceId, seeded.privateKey);
    const first = await refresh(seeded.refresh, body, 'rf-replay-0001-cle-unique');
    const second = await refresh(seeded.refresh, body, 'rf-replay-0001-cle-unique');
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(Object.keys(cookiesOf(first)).sort()).toEqual(['client_refresh', 'client_session']);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(cookiesOf(second)).toEqual({});
  });

  it('refus : cookie absent ou illisible (IDENTITY_SESSION_INVALID), origine absente (ORIGIN_FORBIDDEN), compte bloqué (IDENTITY_ACCOUNT_BLOCKED)', async () => {
    const seeded = await seedSession(CUSTOMER);
    const body = await signed(seeded.deviceId, seeded.privateKey);
    expect(problem(await refresh(null, body))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
    expect(problem(await refresh('client_refresh=pas-un-jeton', body))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
    expect(problem(await refresh(seeded.refresh, body, undefined, null))).toEqual([403, 'ORIGIN_FORBIDDEN']);
    await admin.query(`UPDATE identity.account SET status = 'BLOCKED', blocked_at = now(), block_channel = 'APP', block_reason = 'LOST_OR_STOLEN' WHERE id = $1`, [CUSTOMER]);
    const blocked = await refresh(seeded.refresh, body);
    expect(problem(blocked)).toEqual([403, 'IDENTITY_ACCOUNT_BLOCKED']);
    expect(cookiesOf(blocked)).toEqual({});
  });
});
