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
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import { createSaveThenBuyAgreement } from '../../src/modules/agreements/agreement.store';
import { closeComplaint, openDispute, recordComplaint, resolveDispute } from '../../src/modules/disputes/dispute.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { issueHandoverCode } from '../../src/modules/settlement/handover.store';
import { confirmHandoverAtPartner } from '../../src/workflows/handover';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import { RISK_THRESHOLDS_KEY, runRiskDetection } from '../../src/workflows/risk-detection';
import { decidePayout, instructPayout, preparePayout, recordPayoutExecution } from '../../src/workflows/settlement-payout';
import {
  createAgreementA,
  createAgreementC,
  PLAN_A,
  PLAN_C,
  publishKycLimits,
  publishOfferA,
  publishSetting,
  seedCustomerAccount,
  seedLedgerGenesis,
  seedPaymentPlan,
  validateLandlord,
  validateMerchant,
} from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { createPartnerStaff } from './partner-fixture';
import { createStaffWithKey, loginOverHttp, STAFF_ORIGIN, STAFF_RP_TEST, staffCookie } from './staff-fixture';

/**
 * F-BO-003 / D65 : tableau de bord agrégé du back-office sur un scénario
 * réel complet (accord A remis et réglé, accord C en litige, brouillon,
 * réclamations et alertes ouvertes ou fermées), PostgreSQL réel.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['crm', 'kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const CUSTOMER = '019ab300-0000-7000-8000-0000000000c1';
const GOAL_A = '019ab300-0000-7000-8000-0000000000a1';
const GOAL_C = '019ab300-0000-7000-8000-0000000000a2';
const DRAFT = '019ab300-0000-7000-8000-0000000000a3';
const OFFER = '019ab300-0000-7000-8000-0000000000f1';
const PEPPER = randomBytes(32);
const PLATFORM = generateKeyPairSync('ed25519');
const OPS: AdminPrincipal = { actorId: 'ops-1', roles: ['OPERATIONS'], cityIds: ['douala'] };
const FIN: AdminPrincipal = { actorId: 'fin-1', roles: ['FINANCE'], cityIds: ['douala'], maxAmountXaf: 1_000_000n };
const FIN2: AdminPrincipal = { actorId: 'fin-2', roles: ['FINANCE'], cityIds: ['douala'], maxAmountXaf: 1_000_000n };

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];

function server(): Server {
  return app.getHttpServer() as Server;
}

async function pay(agreementId: string, amount: bigint): Promise<void> {
  const attemptId = uuidv7();
  await withTransaction(database, async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId, channel: 'MTN_MOMO', amountXaf: amount, idemKey: uuidv7() });
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
  await validateMerchant(admin, uuidv7(), 'merchant-1');
  await validateLandlord(admin, uuidv7());
  await seedPaymentPlan(admin, PLAN_A);
  await seedPaymentPlan(admin, PLAN_C);
  await publishOfferA(admin, { offerId: OFFER, partnerId: 'merchant-1', priceXaf: 150_000n });
  await createAgreementA(admin, { id: GOAL_A, customerId: CUSTOMER, offerId: OFFER });
  await createAgreementC(admin, { id: GOAL_C, customerId: CUSTOMER, active: true });
  await createSaveThenBuyAgreement(admin, { id: DRAFT, customerId: CUSTOMER, offerId: OFFER, planId: PLAN_A.planId, durationMonths: 3, createdAt: '2026-11-02T09:00:00.000Z' });
  await admin.query('COMMIT');
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER, 'STRONG');
  await publishKycLimits(admin);
  await publishSetting(admin, 'handover_code_validity_days', 30);
  await publishSetting(admin, 'merchant_commission_bps', 250);
  await publishSetting(admin, 'settlement_contestation_days', 0);
});

async function fullScenario(): Promise<void> {
  // Accord A : financé, remis au comptoir, règlement exécuté.
  await pay(GOAL_A, 150_000n);
  const { code } = await withTransaction(database, (client) => issueHandoverCode(client, { agreementId: GOAL_A, pepper: PEPPER, actorId: 'system-handover' }));
  const counter = await createPartnerStaff((action) => withTransaction(database, action), { partnerId: 'merchant-1', managerLogin: 'awa.gerant', sellerLogin: 'paul.vendeur' });
  await withTransaction(database, (client) => confirmHandoverAtPartner(client, { code, partnerId: 'merchant-1', partnerUserId: counter.seller.userId, latitude: '4.051056', longitude: '9.767869', pepper: PEPPER }));
  const { payoutId } = await withTransaction(database, (client) => preparePayout(client, { id: uuidv7(), agreementId: GOAL_A, cityId: 'douala', principal: OPS }));
  await withTransaction(database, (client) => decidePayout(client, { payoutId, principal: FIN, decision: 'APPROVED', cityId: 'douala' }));
  await withTransaction(database, (client) => instructPayout(client, { payoutId, principal: FIN, cityId: 'douala', signingKey: PLATFORM.privateKey, keyId: 'k1' }));
  await withTransaction(database, (client) => recordPayoutExecution(client, { payoutId, principal: FIN2, cityId: 'douala', outcome: 'EXECUTED', bankReference: 'ETAB-REG-1' }));
  // Accord C : 20 000 versés ; un litige levé (réclamation close), puis un litige ouvert ; une réclamation sans litige.
  for (let index = 0; index < 4; index += 1) {
    await pay(GOAL_C, 5_000n);
  }
  const first = await withTransaction(database, (client) => recordComplaint(client, { id: uuidv7(), customerId: CUSTOMER, agreementId: GOAL_C, channel: 'APP' }));
  const opened = await withTransaction(database, (client) => openDispute(client, { id: uuidv7(), complaintId: first.id, actorId: 'sup-1' }));
  await withTransaction(database, (client) => resolveDispute(client, { disputeId: opened.disputeId, actorId: 'ops-1' }));
  await withTransaction(database, (client) => closeComplaint(client, { complaintId: first.id, outcome: 'ANSWERED', actorId: 'sup-1' }));
  const second = await withTransaction(database, (client) => recordComplaint(client, { id: uuidv7(), customerId: CUSTOMER, agreementId: GOAL_C, channel: 'PHONE' }));
  await withTransaction(database, (client) => openDispute(client, { id: uuidv7(), complaintId: second.id, actorId: 'sup-1' }));
  await withTransaction(database, (client) => recordComplaint(client, { id: uuidv7(), customerId: CUSTOMER, agreementId: null, channel: 'APP' }));
  // Alertes réelles (règle de vélocité, 4 versements en moins d'une heure) : une décidée, puis une nouvelle ouverte.
  await publishSetting(admin, RISK_THRESHOLDS_KEY, {
    PAYMENT_VELOCITY: { maxCount: 3, windowMinutes: 60 },
    REPEATED_CANCELLATIONS: { maxCount: 2, windowMinutes: 43_200 },
    HANDOVER_SPIKE: { maxCount: 20, windowMinutes: 1440 },
  });
  await withTransaction(database, (client) => runRiskDetection(client, { now: new Date(), actorId: 'risk-detector' }));
  await admin.query(`INSERT INTO risk.alert_decision (alert_id, decision, reason, decided_by, decided_at) SELECT id, 'DISMISSED', 'faux positif', 'risk-1', now() FROM risk.alert`);
  await withTransaction(database, (client) => runRiskDetection(client, { now: new Date(), actorId: 'risk-detector' }));
}

describe('F-BO-003 tableau de bord agrégé (D65)', () => {
  it('scénario complet : accords par modèle, univers, villes et état ; règlements ; compteurs ouverts seulement ; brouillon exclu', async () => {
    await fullScenario();
    const { key } = await createStaffWithKey(db.getConnectionUri(), { login: 'fin.dash', roles: ['FINANCE'] });
    const cookie = staffCookie(await loginOverHttp(server(), 'fin.dash', key, 1));
    const response = await request(server()).get('/v1/backoffice/dashboard').query({ reason: 'pilotage hebdomadaire' }).set('Cookie', cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const board = response.body as Record<string, unknown>;
    expect(board['agreements']).toEqual([
      { model: 'PLANNED_EXPENSE', universe: null, cities: '', status: 'DISPUTED', count: 1, targetXaf: '300000', confirmedFundsXaf: '20000' },
      { model: 'SAVE_THEN_BUY', universe: 'TECHNOLOGY', cities: 'douala', status: 'HANDED_OVER', count: 1, targetXaf: '150000', confirmedFundsXaf: '150000' },
    ]);
    expect(board['settlements']).toEqual([{ state: 'EXECUTED', count: 1, netXaf: '146250' }]);
    expect({ handovers: board['handovers'], openDisputes: board['openDisputes'], openComplaints: board['openComplaints'], openRiskAlerts: board['openRiskAlerts'] })
      .toEqual({ handovers: 1, openDisputes: 1, openComplaints: 2, openRiskAlerts: 1 });
    expect(JSON.stringify(board)).not.toMatch(new RegExp(`${CUSTOMER}|paul\\.vendeur|ETAB-REG-1|ops-1|fin-1`));
  });
});
