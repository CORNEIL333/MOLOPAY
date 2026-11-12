import 'reflect-metadata';
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
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import { prepareRefund } from '../../src/workflows/refund';
import { createAgreementC, PLAN_C, publishKycLimits, seedCustomerAccount, seedLedgerGenesis, seedPaymentPlan, validateLandlord } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { createStaffWithKey, loginBody, loginOverHttp, STAFF_ORIGIN, STAFF_RP_TEST, staffCookie, type StaffKey } from './staff-fixture';

/** D62 / SEC-AUTH-004/005 : connexion WebAuthn du personnel et première route du back-office, en HTTP réel. */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const CUSTOMER = '019aa500-0000-7000-8000-0000000000c1';
const GOAL = '019aa500-0000-7000-8000-0000000000a1';

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let closed: INestApplication;
let migrations: string[];
let finOne: StaffKey;
let finTwo: StaffKey;
let ops: StaffKey;

function server(target: INestApplication = app): Server {
  return target.getHttpServer() as Server;
}

async function prepareRefundAsFinOne(): Promise<string> {
  const attemptId = uuidv7();
  await withTransaction(database, async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId: GOAL, channel: 'MTN_MOMO', amountXaf: 50_000n, idemKey: uuidv7() });
    await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
  });
  await withTransaction(database, (client) =>
    confirmPaymentAndFundAgreement(client, {
      attemptId,
      customerId: CUSTOMER,
      providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: 50_000n, outcome: 'SUCCEEDED' },
      actorId: 'payments-worker',
    }),
  );
  await admin.query(
    `INSERT INTO agreements.status_event (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
     SELECT $1, max(seq) + 1, 'TRANSITION', 'ACTIVE', 'CANCELLED_BY_CUSTOMER', $2, $3, 'client-1', now() FROM agreements.status_event WHERE agreement_id = $1`,
    [GOAL, uuidv7(), Buffer.alloc(64, 9)],
  );
  const refund = await withTransaction(database, (client) =>
    prepareRefund(client, { id: uuidv7(), agreementId: GOAL, kind: 'CANCELLATION', principal: { actorId: 'fin.un', roles: ['FINANCE'] } }),
  );
  return refund.refundId;
}

function decide(refundId: string, cookie: string | null, key = `bo-decision-${uuidv7()}`): request.Test {
  const call = request(server()).post(`/v1/backoffice/refunds/${refundId}/decision`).set('Origin', STAFF_ORIGIN).set('Idempotency-Key', key);
  return (cookie === null ? call : call.set('Cookie', cookie)).send({ decision: 'APPROVED' });
}

beforeAll(async () => {
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const open = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set([STAFF_ORIGIN]), staffRp: STAFF_RP_TEST })] }).compile();
  app = open.createNestApplication({ logger: false });
  await app.init();
  const shut = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set([STAFF_ORIGIN]) })] }).compile();
  closed = shut.createNestApplication({ logger: false });
  await closed.init();
}, 300_000);

afterAll(async () => {
  await app.close();
  await closed.close();
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
  await admin.query('BEGIN');
  await validateLandlord(admin, uuidv7());
  await seedPaymentPlan(admin, PLAN_C);
  await createAgreementC(admin, { id: GOAL, customerId: CUSTOMER, active: true });
  await admin.query('COMMIT');
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER, 'STRONG');
  await publishKycLimits(admin);
  const uri = db.getConnectionUri();
  finOne = (await createStaffWithKey(uri, { login: 'fin.un', roles: ['FINANCE'], maxAmountXaf: 1_000_000n })).key;
  finTwo = (await createStaffWithKey(uri, { login: 'fin.deux', roles: ['FINANCE'], maxAmountXaf: 1_000_000n })).key;
  ops = (await createStaffWithKey(uri, { login: 'ops.un', roles: ['OPERATIONS'] })).key;
});

describe('D62 / SEC-AUTH-004/005 connexion WebAuthn du personnel', () => {
  it('fermé par défaut : sans partie de confiance configurée, 503 STAFF_AUTH_UNCONFIGURED', async () => {
    const response = await request(server(closed)).post('/v1/staff/login-challenges').set('Origin', STAFF_ORIGIN).send({ login: 'fin.un' });
    expect(response.status).toBe(503);
    expect((response.body as { code: string }).code).toBe('STAFF_AUTH_UNCONFIGURED');
    const backoffice = await request(server(closed))
      .post(`/v1/backoffice/refunds/${uuidv7()}/decision`)
      .set('Origin', STAFF_ORIGIN)
      .set('Idempotency-Key', 'bo-closed-0000001')
      .set('Cookie', `staff_session=${'a'.repeat(43)}`)
      .send({ decision: 'APPROVED' });
    expect(backoffice.status).toBe(503);
  });

  it('connexion : cookie HttpOnly, Secure, SameSite=Strict, 15 min au plus ; aucun jeton dans le corps', async () => {
    const response = await loginOverHttp(server(), 'fin.deux', finTwo, 1);
    expect(response.status).toBe(201);
    const cookie = (response.headers['set-cookie'] as unknown as string[]).find((value) => value.startsWith('staff_session=')) ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Max-Age=900/);
    expect(JSON.stringify(response.body)).not.toContain(staffCookie(response).split('=')[1]);
  });

  it('INT-IDEM-001 rejeu d’une connexion : même corps, aucun cookie redonné, aucune seconde session', async () => {
    const challenge = await request(server())
      .post('/v1/staff/login-challenges')
      .set('Origin', STAFF_ORIGIN)
      .set('Idempotency-Key', 'staff-replay-challenge')
      .send({ login: 'fin.deux' });
    const again = await request(server())
      .post('/v1/staff/login-challenges')
      .set('Origin', STAFF_ORIGIN)
      .set('Idempotency-Key', 'staff-replay-challenge')
      .send({ login: 'fin.deux' });
    expect(again.body).toEqual(challenge.body);
    const body = await loginBody(server(), 'fin.deux', finTwo, 1);
    const send = (): request.Test =>
      request(server()).post('/v1/staff/sessions').set('Origin', STAFF_ORIGIN).set('Idempotency-Key', 'staff-replay-session').send(body);
    const first = await send();
    expect(first.status).toBe(201);
    expect(first.headers['set-cookie']).toBeDefined();
    const replayed = await send();
    expect(replayed.status).toBe(201);
    expect(replayed.body).toEqual(first.body);
    expect(replayed.headers['set-cookie']).toBeUndefined();
    const sessions = await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM admin.staff_session');
    expect(sessions.rows[0]?.n).toBe(1);
    const stored = await admin.query<{ body: string }>("SELECT response_body::text AS body FROM api.idempotency_record WHERE scope LIKE 'staff-session:%'");
    expect(stored.rows[0]?.body).not.toContain(staffCookie(first).split('=')[1]);
  });

  it('mauvaise clé : 401 STAFF_AUTH_INVALID, sans cookie', async () => {
    const response = await loginOverHttp(server(), 'fin.deux', finOne, 1);
    expect(response.status).toBe(401);
    expect((response.body as { code: string }).code).toBe('STAFF_AUTH_INVALID');
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});

describe('D49 / D62 back-office : décision de remboursement', () => {
  it('une autre personne de la finance décide : 200 ; rejeu idempotent', async () => {
    const refundId = await prepareRefundAsFinOne();
    const cookie = staffCookie(await loginOverHttp(server(), 'fin.deux', finTwo, 1));
    const first = await decide(refundId, cookie, 'bo-decision-replay-1');
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ refundId, decision: 'APPROVED' });
    expect((await decide(refundId, cookie, 'bo-decision-replay-1')).status).toBe(200);
    const rows = await admin.query('SELECT decided_by FROM settlement.refund_decision');
    expect(rows.rows).toEqual([{ decided_by: 'fin.deux' }]);
  });

  it('I-7 le préparateur ne décide pas (403 MAKER_CANNOT_APPROVE)', async () => {
    const refundId = await prepareRefundAsFinOne();
    const cookie = staffCookie(await loginOverHttp(server(), 'fin.un', finOne, 1));
    const response = await decide(refundId, cookie);
    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe('MAKER_CANNOT_APPROVE');
  });

  it('SEC-AUTHZ-001 rôle sans droit (403 ADMIN_FORBIDDEN) ; sans session ou après déconnexion (401)', async () => {
    const refundId = await prepareRefundAsFinOne();
    const opsCookie = staffCookie(await loginOverHttp(server(), 'ops.un', ops, 1));
    expect((await decide(refundId, opsCookie)).status).toBe(403);
    expect((await decide(refundId, null)).status).toBe(401);
    const cookie = staffCookie(await loginOverHttp(server(), 'fin.deux', finTwo, 1));
    const logout = await request(server()).delete('/v1/staff/sessions/current').set('Origin', STAFF_ORIGIN).set('Idempotency-Key', 'staff-logout-0001').set('Cookie', cookie);
    expect(logout.status).toBe(204);
    expect((await decide(refundId, cookie)).status).toBe(401);
    expect((await admin.query('SELECT 1 FROM settlement.refund_decision')).rowCount).toBe(0);
  });

  it('un cookie client ne donne aucun accès au back-office', async () => {
    const refundId = await prepareRefundAsFinOne();
    expect((await decide(refundId, 'client_session=abc.def')).status).toBe(401);
  });
});
