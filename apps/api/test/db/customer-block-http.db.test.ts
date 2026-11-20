import 'reflect-metadata';
import { createHash, generateKeyPairSync } from 'node:crypto';
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
import { uuidv7 } from '../../src/modules/ledger/domain';
import { seedCustomerAccount } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { createStaffWithKey, loginOverHttp, STAFF_ORIGIN, STAFF_RP_TEST, staffCookie } from './staff-fixture';

/**
 * C4 / F-ACC-006 : perte ou vol du téléphone — blocage immédiat du compte
 * client par le support (canal SUPPORT), motif obligatoire, appareils et
 * sessions révoqués dans la même transaction, inscrit à l'audit chaîné.
 * HTTP réel, PostgreSQL réel, toutes les migrations.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['crm', 'kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const ORIGIN = 'https://app.molopay.test';
const CUSTOMER = '019ab820-0000-7000-8000-0000000000c1';

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];
let cookies: Record<'support' | 'risk' | 'ops', string>;

function server(): Server {
  return app.getHttpServer() as Server;
}

function problem(response: { readonly status: number; readonly body: unknown }): [number, string | undefined] {
  return [response.status, (response.body as { code?: string }).code];
}

function block(cookie: string, accountId: string, body: object): request.Test {
  return request(server()).post(`/v1/backoffice/customers/${accountId}/block`).set('Origin', STAFF_ORIGIN).set('Cookie', cookie).set('Idempotency-Key', `blk-${uuidv7()}`).send(body);
}

async function session(accountId: string): Promise<string> {
  const device = uuidv7();
  const { publicKey } = generateKeyPairSync('ed25519');
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
  return `client_session=${sessionCookieValue(sessionId, token.accessToken)}`;
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set([ORIGIN, STAFF_ORIGIN]), staffRp: STAFF_RP_TEST })] }).compile();
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
  const result: Partial<typeof cookies> = {};
  for (const [slot, login, roles] of [['support', 'sup.un', ['SUPPORT_N1']], ['risk', 'risk.un', ['RISK']], ['ops', 'ops.un', ['OPERATIONS']]] as const) {
    const { key } = await createStaffWithKey(db.getConnectionUri(), { login, roles: [...roles] });
    result[slot] = staffCookie(await loginOverHttp(server(), login, key, 1));
  }
  cookies = result as typeof cookies;
});

describe('C4 / F-ACC-006 blocage du compte client par le support', () => {
  it('support : blocage immédiat, canal SUPPORT, appareils et sessions révoqués ; le client ne peut plus rien ; audit chaîné avec motif', async () => {
    const customer = await session(CUSTOMER);
    expect((await me(customer)).status).toBe(200);
    const response = await block(cookies.support, CUSTOMER, { reason: 'Téléphone volé, appel du client vérifié' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual({ accountId: CUSTOMER, status: 'BLOCKED', blockedAt: expect.any(String) as unknown });
    const account = (await admin.query<{ status: string }>('SELECT status, block_channel, block_reason FROM identity.account WHERE id = $1', [CUSTOMER])).rows[0];
    expect(account).toEqual({ status: 'BLOCKED', block_channel: 'SUPPORT', block_reason: 'Téléphone volé, appel du client vérifié' });
    expect((await admin.query(`SELECT count(*)::int AS n FROM identity.device WHERE account_id = $1 AND status = 'ACTIVE'`, [CUSTOMER])).rows[0]).toEqual({ n: 0 });
    expect((await admin.query('SELECT count(*)::int AS n FROM identity.session WHERE account_id = $1 AND revoked_at IS NULL', [CUSTOMER])).rows[0]).toEqual({ n: 0 });
    expect((await me(customer)).status).toBe(401);
    const audit = await admin.query(`SELECT event_type, actor_id, action, reason, refs ->> 'account_id' AS account FROM audit.event WHERE action = 'ACCOUNT_BLOCKED'`);
    expect(audit.rows).toEqual([{ event_type: 'BACKOFFICE_ACTION', actor_id: 'sup.un', action: 'ACCOUNT_BLOCKED', reason: 'Téléphone volé, appel du client vérifié', account: CUSTOMER }]);
  });

  it('motif absent ou trop court : ADMIN_REASON_REQUIRED / REQUEST_INVALID ; rien n’est bloqué', async () => {
    expect(problem(await block(cookies.support, CUSTOMER, {}))).toEqual([400, 'REQUEST_INVALID']);
    expect(problem(await block(cookies.support, CUSTOMER, { reason: 'x' }))).toEqual([400, 'REQUEST_INVALID']);
    expect(problem(await block(cookies.support, CUSTOMER, { reason: 'Téléphone volé', channel: 'APP' }))).toEqual([400, 'REQUEST_INVALID']);
    expect((await admin.query('SELECT status FROM identity.account WHERE id = $1', [CUSTOMER])).rows[0]).toEqual({ status: 'ACTIVE' });
  });

  it('droits : les opérations ne bloquent pas (ADMIN_FORBIDDEN) ; le risque le peut', async () => {
    expect(problem(await block(cookies.ops, CUSTOMER, { reason: 'Téléphone volé' }))).toEqual([403, 'ADMIN_FORBIDDEN']);
    expect((await block(cookies.risk, CUSTOMER, { reason: 'Fraude présumée, alerte du risque' })).status).toBe(200);
  });

  it('compte inconnu : 404 IDENTITY_ACCOUNT_NOT_FOUND ; déjà bloqué : 403 IDENTITY_ACCOUNT_BLOCKED, motif d’origine conservé', async () => {
    expect(problem(await block(cookies.support, uuidv7(), { reason: 'Téléphone volé' }))).toEqual([404, 'IDENTITY_ACCOUNT_NOT_FOUND']);
    expect(problem(await block(cookies.support, 'pas-un-uuid', { reason: 'Téléphone volé' }))).toEqual([400, 'REQUEST_INVALID']);
    await block(cookies.support, CUSTOMER, { reason: 'Téléphone volé' });
    expect(problem(await block(cookies.risk, CUSTOMER, { reason: 'Autre motif' }))).toEqual([403, 'IDENTITY_ACCOUNT_BLOCKED']);
    expect((await admin.query('SELECT block_reason FROM identity.account WHERE id = $1', [CUSTOMER])).rows[0]).toEqual({ block_reason: 'Téléphone volé' });
  });

  it('sans session du personnel : 401 STAFF_AUTH_INVALID ; session client refusée', async () => {
    const customer = await session(CUSTOMER);
    expect(problem(await request(server()).post(`/v1/backoffice/customers/${CUSTOMER}/block`).set('Origin', STAFF_ORIGIN).set('Idempotency-Key', `blk-${uuidv7()}`).send({ reason: 'Téléphone volé' }))).toEqual([401, 'STAFF_AUTH_INVALID']);
    expect(problem(await block(customer, CUSTOMER, { reason: 'Téléphone volé' }))).toEqual([401, 'STAFF_AUTH_INVALID']);
  });
});
