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
import { createDatabase, withTransaction, type Database } from '../../src/http/database';
import { issueSessionTokens } from '../../src/modules/identity/domain';
import { sessionCookieValue } from '../../src/modules/identity/session.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import { createAgreementC, PLAN_C, publishKycLimits, seedCustomerAccount, seedLedgerGenesis, seedPaymentPlan, validateLandlord } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

/** F-PAY-006 / D39 : historique des versements confirmés d'un objectif, au seul client de l'objectif. */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const ORIGIN = 'https://app.molopay.test';
const CUSTOMER = '019ab700-0000-7000-8000-0000000000c1';
const OTHER = '019ab700-0000-7000-8000-0000000000c2';
const GOAL = '019ab700-0000-7000-8000-0000000000a1';

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];

function server(): Server {
  return app.getHttpServer() as Server;
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

async function pay(amount: bigint, agreementId = GOAL): Promise<void> {
  const attemptId = uuidv7();
  await withTransaction(database, async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId, channel: 'ORANGE_MONEY', amountXaf: amount, idemKey: uuidv7() });
    await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
  });
  await withTransaction(database, (client) =>
    confirmPaymentAndFundAgreement(client, {
      attemptId,
      customerId: CUSTOMER,
      providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: amount, outcome: 'SUCCEEDED' },
      actorId: 'payments-worker',
    }),
  );
}

function contributions(cookie: string | null, goalId = GOAL): request.Test {
  const call = request(server()).get(`/v1/goals/${goalId}/contributions`).set('Origin', ORIGIN);
  return cookie === null ? call : call.set('Cookie', cookie);
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
  await admin.query('BEGIN');
  await validateLandlord(admin, uuidv7());
  await seedPaymentPlan(admin, PLAN_C);
  await createAgreementC(admin, { id: GOAL, customerId: CUSTOMER, active: true });
  await admin.query('COMMIT');
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER, 'STRONG');
  await seedCustomerAccount(admin, OTHER, 'STRONG');
  await publishKycLimits(admin);
});

describe('F-PAY-006 historique des versements d’un objectif', () => {
  it('versements confirmés dans l’ordre, montants entiers en texte, numéro de reçu du client', async () => {
    await pay(10_000n);
    await pay(25_000n);
    const response = await contributions(await session(CUSTOMER));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const body = response.body as { contributions: { amountXaf: string; status: string; receiptNumber: string; confirmedAt: string; contributionId: string }[]; asOf: string };
    expect(body.contributions.map((item) => [item.amountXaf, item.status, item.receiptNumber])).toEqual([
      ['10000', 'CONFIRMED', '1'],
      ['25000', 'CONFIRMED', '2'],
    ]);
    expect(body.contributions.every((item) => /^[0-9a-f-]{36}$/.test(item.contributionId) && !Number.isNaN(Date.parse(item.confirmedAt)))).toBe(true);
    expect(Number.isNaN(Date.parse(body.asOf))).toBe(false);
  });

  it('objectif d’un autre client ou inconnu : même 404 ; sans session : 401', async () => {
    await pay(10_000n);
    const other = await contributions(await session(OTHER));
    expect(other.status).toBe(404);
    expect((other.body as { code: string }).code).toBe('AGREEMENT_NOT_FOUND');
    expect((await contributions(await session(CUSTOMER), uuidv7())).status).toBe(404);
    expect((await contributions(await session(CUSTOMER), 'pas-un-uuid')).status).toBe(404);
    expect((await contributions(null)).status).toBe(401);
  });

  it('seuls les versements de cet objectif (un autre objectif du même client est exclu)', async () => {
    const second = '019ab700-0000-7000-8000-0000000000a2';
    await createAgreementC(admin, { id: second, customerId: CUSTOMER, active: true });
    await pay(10_000n);
    await pay(7_000n, second);
    const cookie = await session(CUSTOMER);
    const first = (await contributions(cookie)).body as { contributions: { amountXaf: string }[] };
    const other = (await contributions(cookie, second)).body as { contributions: { amountXaf: string }[] };
    expect(first.contributions.map((item) => item.amountXaf)).toEqual(['10000']);
    expect(other.contributions.map((item) => item.amountXaf)).toEqual(['7000']);
  });

  it('aucun versement : liste vide', async () => {
    const response = await contributions(await session(CUSTOMER));
    expect((response.body as { contributions: unknown[] }).contributions).toEqual([]);
  });
});
