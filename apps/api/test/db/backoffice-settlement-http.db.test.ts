import 'reflect-metadata';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
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
import { issueHandoverCode } from '../../src/modules/settlement/handover.store';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import { confirmHandoverAtPartner } from '../../src/workflows/handover';
import {
  createAgreementA,
  PLAN_A,
  publishKycLimits,
  publishOfferA,
  publishSetting,
  seedCustomerAccount,
  seedLedgerGenesis,
  seedPaymentPlan,
  validateMerchant,
} from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { createStaffWithKey, loginOverHttp, STAFF_ORIGIN, STAFF_RP_TEST, staffCookie } from './staff-fixture';

/** D46 / D62 : règlements des marchands au back-office, ville du périmètre de l'agent comprise. */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const CUSTOMER = '019aa700-0000-7000-8000-0000000000c1';
const GOAL = '019aa700-0000-7000-8000-0000000000a1';
const OFFER = '019aa700-0000-7000-8000-0000000000f1';
const PEPPER = randomBytes(32);
const PLATFORM = generateKeyPairSync('ed25519');

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];
let cookies: Record<'ops' | 'finOne' | 'finTwo' | 'finYaounde', string>;

function server(): Server {
  return app.getHttpServer() as Server;
}

function post(path: string, cookie: string, body: object): request.Test {
  return request(server()).post(path).set('Origin', STAFF_ORIGIN).set('Cookie', cookie).set('Idempotency-Key', `bo-${uuidv7()}`).send(body);
}

async function pay(amount: bigint): Promise<void> {
  const attemptId = uuidv7();
  await withTransaction(database, async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId: GOAL, channel: 'MTN_MOMO', amountXaf: amount, idemKey: uuidv7() });
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

beforeAll(async () => {
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set([STAFF_ORIGIN]), staffRp: STAFF_RP_TEST, platformSigningKey: { key: PLATFORM.privateKey, keyId: 'k1' } })] }).compile();
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
  await validateMerchant(admin, uuidv7());
  await seedPaymentPlan(admin, PLAN_A);
  await publishOfferA(admin, { offerId: OFFER, partnerId: 'merchant-1', priceXaf: 150_000n });
  await createAgreementA(admin, { id: GOAL, customerId: CUSTOMER, offerId: OFFER });
  await admin.query('COMMIT');
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER, 'STRONG');
  await publishKycLimits(admin);
  const uri = db.getConnectionUri();
  await publishSetting(admin, 'handover_code_validity_days', 30);
  await publishSetting(admin, 'merchant_commission_bps', 250);
  await publishSetting(admin, 'settlement_contestation_days', 0);
  const agents = [
    ['ops', 'ops.dla', ['OPERATIONS'], ['douala']],
    ['finOne', 'fin.dla1', ['FINANCE'], ['douala']],
    ['finTwo', 'fin.dla2', ['FINANCE'], ['douala']],
    ['finYaounde', 'fin.yde', ['FINANCE'], ['yaounde']],
  ] as const;
  const result: Partial<typeof cookies> = {};
  for (const [slot, login, roles, cityIds] of agents) {
    const { key } = await createStaffWithKey(uri, { login, roles: [...roles], cityIds: [...cityIds], maxAmountXaf: 1_000_000n });
    result[slot] = staffCookie(await loginOverHttp(server(), login, key, 1));
  }
  cookies = result as typeof cookies;
});

async function handedOver(): Promise<void> {
  await pay(150_000n);
  const { code } = await withTransaction(database, (client) => issueHandoverCode(client, { agreementId: GOAL, pepper: PEPPER, actorId: 'system-handover' }));
  await withTransaction(database, (client) =>
    confirmHandoverAtPartner(client, { code, partnerId: 'merchant-1', partnerUserId: 'vendeur-1', latitude: '4.051056', longitude: '9.767869', pepper: PEPPER }),
  );
}

describe('D46 / D62 règlement marchand au back-office', () => {
  it('circuit complet à Douala : net calculé par la base, commission, instruction signée, exécution par une autre personne', async () => {
    await handedOver();
    const prepared = await post('/v1/backoffice/settlements', cookies.ops, { agreementId: GOAL, cityId: 'douala' });
    expect(prepared.status).toBe(201);
    const { payoutId, netXaf, commissionXaf } = prepared.body as { payoutId: string; netXaf: string; commissionXaf: string };
    expect({ netXaf, commissionXaf }).toEqual({ netXaf: '146250', commissionXaf: '3750' });
    expect((await post(`/v1/backoffice/settlements/${payoutId}/decision`, cookies.finOne, { decision: 'APPROVED', cityId: 'douala' })).status).toBe(200);
    expect((await post(`/v1/backoffice/settlements/${payoutId}/instruction`, cookies.finOne, { cityId: 'douala' })).status).toBe(201);
    expect((await post(`/v1/backoffice/settlements/${payoutId}/execution`, cookies.finOne, { outcome: 'EXECUTED', bankReference: 'ETAB-REG-1', cityId: 'douala' })).status).toBe(403);
    expect((await post(`/v1/backoffice/settlements/${payoutId}/execution`, cookies.finTwo, { outcome: 'EXECUTED', bankReference: 'ETAB-REG-1', cityId: 'douala' })).status).toBe(200);
    const types = await admin.query<{ operation_type: string }>(`SELECT operation_type FROM ledger.journal_entry WHERE operation_type IN ('FEE_CHARGED', 'SETTLEMENT_SENT') ORDER BY seq`);
    expect(types.rows.map((row) => row.operation_type)).toEqual(['FEE_CHARGED', 'SETTLEMENT_SENT']);
  });

  it('SEC-AUTHZ-001 (ABAC) : un agent de Yaoundé ne décide pas un règlement de Douala, ni en se déclarant à Douala', async () => {
    await handedOver();
    const prepared = await post('/v1/backoffice/settlements', cookies.ops, { agreementId: GOAL, cityId: 'douala' });
    const { payoutId } = prepared.body as { payoutId: string };
    const asYaounde = await post(`/v1/backoffice/settlements/${payoutId}/decision`, cookies.finYaounde, { decision: 'APPROVED', cityId: 'yaounde' });
    expect(asYaounde.status).toBe(403);
    const pretending = await post(`/v1/backoffice/settlements/${payoutId}/decision`, cookies.finYaounde, { decision: 'APPROVED', cityId: 'douala' });
    expect(pretending.status).toBe(403);
    expect((await admin.query('SELECT 1 FROM settlement.payout_decision')).rowCount).toBe(0);
  });
});
