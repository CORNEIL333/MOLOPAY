import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { xaf } from '@achat/money';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { createDatabase, withTransaction, type Database } from '../../src/http/database';
import { recordComplaint } from '../../src/modules/disputes/dispute.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendLedgerEntry, systemAccountId } from '../../src/modules/ledger/entry.store';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { recordSegregationCheck } from '../../src/modules/reconciliation/segregation.store';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import { RISK_THRESHOLDS_KEY, runRiskDetection } from '../../src/workflows/risk-detection';
import {
  createAgreementC,
  PLAN_C,
  publishKycLimits,
  publishSetting,
  seedCustomerAccount,
  seedLedgerGenesis,
  seedPaymentPlan,
  validateLandlord,
} from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { createStaffWithKey, loginOverHttp, STAFF_ORIGIN, STAFF_RP_TEST, staffCookie } from './staff-fixture';

/** D53–D56 / D62 : routes de contrôle du back-office en HTTP réel, avec des agents de rôles distincts. */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const CUSTOMER = '019aa600-0000-7000-8000-0000000000c1';
const GOAL = '019aa600-0000-7000-8000-0000000000a1';

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];
let cookies: Record<'support' | 'supportN1' | 'ops' | 'risk' | 'finOne' | 'finTwo', string>;

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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set([STAFF_ORIGIN]), staffRp: STAFF_RP_TEST })] }).compile();
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
  await publishKycLimits(admin);
  const uri = db.getConnectionUri();
  const agents = [
    ['support', 'sup.deux', ['SUPPORT_N2']],
    ['supportN1', 'sup.un', ['SUPPORT_N1']],
    ['ops', 'ops.un', ['OPERATIONS']],
    ['risk', 'risk.un', ['RISK']],
    ['finOne', 'fin.un', ['FINANCE']],
    ['finTwo', 'fin.deux', ['FINANCE']],
  ] as const;
  const result: Partial<typeof cookies> = {};
  for (const [slot, login, roles] of agents) {
    const { key } = await createStaffWithKey(uri, { login, roles: [...roles] });
    result[slot] = staffCookie(await loginOverHttp(server(), login, key, 1));
  }
  cookies = result as typeof cookies;
});

describe('D41 / D56 litiges et réclamations au back-office', () => {
  it('le support N2 ouvre, les opérations lèvent, le support clôt ; le support N1 n’ouvre pas', async () => {
    const complaint = await withTransaction(database, (client) => recordComplaint(client, { id: uuidv7(), customerId: CUSTOMER, agreementId: GOAL, channel: 'APP' }));
    expect((await post(`/v1/backoffice/complaints/${complaint.id}/disputes`, cookies.supportN1, {})).status).toBe(403);
    const opened = await post(`/v1/backoffice/complaints/${complaint.id}/disputes`, cookies.support, {});
    expect(opened.status).toBe(201);
    const { disputeId } = opened.body as { disputeId: string };
    expect((await admin.query('SELECT status FROM agreements.agreement_state WHERE id = $1', [GOAL])).rows).toEqual([{ status: 'DISPUTED' }]);
    expect((await post(`/v1/backoffice/complaints/${complaint.id}/closure`, cookies.support, { outcome: 'ANSWERED' })).status).toBe(422);
    const resolved = await post(`/v1/backoffice/disputes/${disputeId}/resolution`, cookies.ops, {});
    expect(resolved.status).toBe(200);
    expect((resolved.body as { agreementStatus: string }).agreementStatus).toBe('ACTIVE');
    expect((await post(`/v1/backoffice/complaints/${complaint.id}/closure`, cookies.support, { outcome: 'ANSWERED' })).status).toBe(200);
  });
});

describe('D53 alertes de fraude au back-office', () => {
  it('Risque décide avec motif ; une seconde décision est refusée ; les opérations n’ont pas le droit', async () => {
    await publishSetting(admin, RISK_THRESHOLDS_KEY, {
      PAYMENT_VELOCITY: { maxCount: 3, windowMinutes: 60 },
      REPEATED_CANCELLATIONS: { maxCount: 2, windowMinutes: 43_200 },
      HANDOVER_SPIKE: { maxCount: 20, windowMinutes: 1440 },
    });
    for (let index = 0; index < 4; index += 1) {
      await pay(10_000n);
    }
    await withTransaction(database, (client) => runRiskDetection(client, { now: new Date(), actorId: 'risk-detector' }));
    const alertId = (await admin.query<{ id: string }>('SELECT id FROM risk.alert')).rows[0]!.id;
    expect((await post(`/v1/backoffice/risk/alerts/${alertId}/decision`, cookies.ops, { decision: 'DISMISSED', reason: 'x' })).status).toBe(403);
    expect((await post(`/v1/backoffice/risk/alerts/${alertId}/decision`, cookies.risk, { decision: 'CONFIRMED' })).status).toBe(400);
    expect((await post(`/v1/backoffice/risk/alerts/${alertId}/decision`, cookies.risk, { decision: 'DISMISSED', reason: 'salaire fractionné vérifié' })).status).toBe(200);
    expect((await post(`/v1/backoffice/risk/alerts/${alertId}/decision`, cookies.risk, { decision: 'CONFIRMED', reason: 'revue' })).status).toBe(422);
  });
});

describe('D54 / D55 rapprochement au back-office', () => {
  it('classement d’un écart : proposé par une personne, validé par une autre (le proposant est refusé)', async () => {
    const check = await withTransaction(database, (client) => recordSegregationCheck(client, { statementDate: '2026-11-11', statementBalanceXaf: 1n, outgoingInTransitXaf: 0n, actorId: 'fin.un' }));
    const incidentId = check.incidentId!;
    const proposed = await post(`/v1/backoffice/reconciliation/incidents/${incidentId}/classifications`, cookies.finOne, { classification: 'FEES', explanation: 'frais de tenue de compte du 11' });
    expect(proposed.status).toBe(201);
    const { proposalId } = proposed.body as { proposalId: string };
    expect((await post(`/v1/backoffice/reconciliation/classifications/${proposalId}/decision`, cookies.finOne, { decision: 'APPROVED' })).status).toBe(403);
    expect((await post(`/v1/backoffice/reconciliation/classifications/${proposalId}/decision`, cookies.finTwo, { decision: 'APPROVED' })).status).toBe(200);
  });

  it('suspens 2900 : justification proposée puis validée par une autre personne', async () => {
    const entry = await withTransaction(database, async (client) =>
      appendLedgerEntry(client, {
        id: uuidv7(),
        operationType: 'SUSPENSE_IN',
        businessRefs: { test_ref: 'suspens' },
        actorId: 'fin.un',
        approvers: [],
        idemScope: 'test',
        idemKey: uuidv7(),
        postings: [
          { accountId: await systemAccountId(client, '1200'), direction: 'DEBIT', amount: xaf(7_000n) },
          { accountId: await systemAccountId(client, '2900'), direction: 'CREDIT', amount: xaf(7_000n) },
        ],
      }),
    );
    expect((await post(`/v1/backoffice/reconciliation/suspense/${entry.id}/justification`, cookies.finOne, { explanation: 'versement non identifié' })).status).toBe(201);
    expect((await post(`/v1/backoffice/reconciliation/suspense/${entry.id}/approval`, cookies.finOne, {})).status).toBe(403);
    expect((await post(`/v1/backoffice/reconciliation/suspense/${entry.id}/approval`, cookies.finTwo, {})).status).toBe(200);
  });
});

describe('F-BO-003 / D62 file de travail du back-office', () => {
  it('liste l’alerte ouverte et l’écart à traiter, sans donnée personnelle ; refusée sans droit de lecture financière', async () => {
    await publishSetting(admin, RISK_THRESHOLDS_KEY, {
      PAYMENT_VELOCITY: { maxCount: 3, windowMinutes: 60 },
      REPEATED_CANCELLATIONS: { maxCount: 2, windowMinutes: 43_200 },
      HANDOVER_SPIKE: { maxCount: 20, windowMinutes: 1440 },
    });
    for (let index = 0; index < 4; index += 1) {
      await pay(10_000n);
    }
    await withTransaction(database, (client) => runRiskDetection(client, { now: new Date(), actorId: 'risk-detector' }));
    const read = (cookie: string, reason = 'revue quotidienne des files'): request.Test =>
      request(server()).get('/v1/backoffice/queue').query({ reason }).set('Cookie', cookie);
    expect((await request(server()).get('/v1/backoffice/queue').set('Cookie', cookies.finOne)).status).toBe(400);
    expect((await read(cookies.supportN1)).status).toBe(403);
    const response = await read(cookies.finOne);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const queue = response.body as { openRiskAlerts: { rule: string }[]; refunds: unknown[]; overdueComplaints: unknown[] };
    expect(queue.openRiskAlerts.map((alert) => alert.rule)).toEqual(['PAYMENT_VELOCITY']);
    expect(queue.refunds).toEqual([]);
    expect(JSON.stringify(response.body)).not.toMatch(/\+237|phone|login/i);
  });
});

