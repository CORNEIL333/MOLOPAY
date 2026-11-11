import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import { listCustomerCancellationsSince } from '../../src/modules/agreements/risk-facts.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import { decideRiskAlert, RISK_THRESHOLDS_KEY, runRiskDetection } from '../../src/workflows/risk-detection';
import {
  AGREEMENT_STACK_MIGRATIONS,
  AGREEMENT_STACK_SCHEMAS,
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

const MIGRATIONS = [
  ...AGREEMENT_STACK_MIGRATIONS,
  'db/migrations/0038_partner_ledger_identity.sql',
  'db/migrations/0039_agreements_handover.sql',
  'db/migrations/0040_settlement_handover.sql',
  'db/migrations/0049_risk_alerts.sql',
].map((path) => resolve(process.cwd(), path));

const CUSTOMER = '019aa000-0000-7000-8000-0000000000c1';
const QUIET = '019aa000-0000-7000-8000-0000000000c2';
const GOALS = ['019aa000-0000-7000-8000-0000000000a1', '019aa000-0000-7000-8000-0000000000a2', '019aa000-0000-7000-8000-0000000000a3'];
const QUIET_GOAL = '019aa000-0000-7000-8000-0000000000b1';
const RISK1: AdminPrincipal = { actorId: 'risk-1', roles: ['RISK'] };
const COMP1: AdminPrincipal = { actorId: 'comp-1', roles: ['COMPLIANCE'] };
const OPS: AdminPrincipal = { actorId: 'ops-1', roles: ['OPERATIONS'] };
const THRESHOLDS = {
  PAYMENT_VELOCITY: { maxCount: 3, windowMinutes: 60 },
  REPEATED_CANCELLATIONS: { maxCount: 2, windowMinutes: 43_200 },
  HANDOVER_SPIKE: { maxCount: 20, windowMinutes: 1440 },
};

let container: TestDatabase;
let admin: Client;
let migrationSql: string[];

async function transact<T>(role: 'app_rw' | 'app_ro' | null, action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (role !== null) {
      await client.query(`SET LOCAL ROLE ${role}`);
    }
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

async function failure(action: () => Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  try {
    await action();
  } catch (error: unknown) {
    if (error instanceof BusinessError) {
      return { code: error.code, message: error.message };
    }
    const pg = error as { code?: string; message?: string };
    return { code: pg.code, message: pg.message ?? '' };
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

async function pay(agreementId: string, customerId: string, amount: bigint): Promise<void> {
  const attemptId = uuidv7();
  await transact('app_rw', async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId, channel: 'MTN_MOMO', amountXaf: amount, idemKey: uuidv7() });
    await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
  });
  await transact('app_rw', (client) =>
    confirmPaymentAndFundAgreement(client, {
      attemptId,
      customerId,
      providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: amount, outcome: 'SUCCEEDED' },
      actorId: 'payments-worker',
    }),
  );
}

async function cancel(agreementId: string): Promise<void> {
  await admin.query(
    `INSERT INTO agreements.status_event (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
     SELECT $1, max(seq) + 1, 'TRANSITION', 'ACTIVE', 'CANCELLED_BY_CUSTOMER', $2, $3, 'client-1', now()
       FROM agreements.status_event WHERE agreement_id = $1`,
    [agreementId, uuidv7(), Buffer.alloc(64, 9)],
  );
}

async function detect(now = new Date()): Promise<{ readonly created: number; readonly alreadyOpen: number }> {
  return transact('app_rw', (client) => runRiskDetection(client, { now, actorId: 'risk-detector' }));
}

async function alerts(): Promise<{ rule: string; subject_type: string; subject_id: string; count: number }[]> {
  const result = await admin.query<{ rule: string; subject_type: string; subject_id: string; count: number }>(
    `SELECT rule, subject_type, subject_id, (evidence ->> 'count')::int AS count FROM risk.alert ORDER BY rule, subject_id`,
  );
  return result.rows;
}

const VALID_EVIDENCE = {
  count: 4,
  maxCount: 3,
  windowMinutes: 60,
  windowStart: '2026-11-11T11:00:00.000Z',
  windowEnd: '2026-11-11T12:00:00.000Z',
  eventIds: ['019aa000-0000-7000-8000-000000000001', '019aa000-0000-7000-8000-000000000002', '019aa000-0000-7000-8000-000000000003', '019aa000-0000-7000-8000-000000000004'],
};

async function rawAlert(evidence: unknown, rule = 'PAYMENT_VELOCITY', subjectType = 'CUSTOMER'): Promise<void> {
  await admin.query(
    `INSERT INTO risk.alert (id, rule, subject_type, subject_id, evidence, detected_by, detected_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'risk-detector', now())`,
    [uuidv7(), rule, subjectType, CUSTOMER, JSON.stringify(evidence)],
  );
}

beforeAll(async () => {
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  migrationSql = await Promise.all(MIGRATIONS.map((path) => readFile(path, 'utf8')));
}, 120_000);

afterAll(async () => {
  await admin.end();
  await container.stop();
});

beforeEach(async () => {
  for (const schema of ['risk', 'settlement', ...AGREEMENT_STACK_SCHEMAS]) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
  await transact('app_rw', async (client) => {
    await validateLandlord(client, uuidv7());
    await seedPaymentPlan(client, PLAN_C);
    for (const id of GOALS) {
      await createAgreementC(client, { id, customerId: CUSTOMER, active: true });
    }
    await createAgreementC(client, { id: QUIET_GOAL, customerId: QUIET, active: true });
  });
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER, 'STRONG');
  await seedCustomerAccount(admin, QUIET, 'STRONG');
  await publishKycLimits(admin);
});

describe('SEC-FRD-001 / D53 détection fermée par défaut', () => {
  it('sans seuils publiés, aucune détection (RISK_SETTINGS_NOT_CONFIGURED)', async () => {
    const result = await failure(() => detect());
    expect(result.code).toBe('RISK_SETTINGS_NOT_CONFIGURED');
  });
});

describe('SEC-FRD-001 / D53 détection sur faits réels', () => {
  beforeEach(async () => {
    await publishSetting(admin, RISK_THRESHOLDS_KEY, THRESHOLDS);
  });

  it('vélocité : 4 versements confirmés en 60 min → une alerte avec ses preuves ; le client calme n’est pas signalé', async () => {
    for (let index = 0; index < 4; index += 1) {
      await pay(GOALS[0]!, CUSTOMER, 10_000n);
    }
    await pay(QUIET_GOAL, QUIET, 10_000n);
    expect(await detect()).toEqual({ created: 1, alreadyOpen: 0 });
    expect(await alerts()).toEqual([{ rule: 'PAYMENT_VELOCITY', subject_type: 'CUSTOMER', subject_id: CUSTOMER, count: 4 }]);
  });

  it('au seuil exact (3 versements) : aucune alerte', async () => {
    for (let index = 0; index < 3; index += 1) {
      await pay(GOALS[0]!, CUSTOMER, 10_000n);
    }
    expect(await detect()).toEqual({ created: 0, alreadyOpen: 0 });
  });

  it('annulations répétées : 3 objectifs annulés → alerte ; faits lus par objectif', async () => {
    for (const goal of GOALS) {
      await cancel(goal);
    }
    const facts = await transact('app_ro', (client) => listCustomerCancellationsSince(client, new Date(Date.now() - 3_600_000)));
    expect(facts.map((fact) => fact.agreementId).sort()).toEqual([...GOALS].sort());
    await detect();
    expect(await alerts()).toEqual([{ rule: 'REPEATED_CANCELLATIONS', subject_type: 'CUSTOMER', subject_id: CUSTOMER, count: 3 }]);
  });

  it('une seule alerte ouverte par règle et sujet ; après décision, une nouvelle peut être ouverte', async () => {
    for (let index = 0; index < 4; index += 1) {
      await pay(GOALS[0]!, CUSTOMER, 10_000n);
    }
    await detect();
    expect(await detect()).toEqual({ created: 0, alreadyOpen: 1 });
    const id = (await admin.query<{ id: string }>('SELECT id FROM risk.alert')).rows[0]!.id;
    await transact('app_rw', (client) => decideRiskAlert(client, { alertId: id, principal: RISK1, decision: 'DISMISSED', reason: 'versements d’un salaire fractionné, vérifié par appel' }));
    expect(await detect()).toEqual({ created: 1, alreadyOpen: 0 });
  });

  it('hors fenêtre : les faits anciens ne comptent pas', async () => {
    for (let index = 0; index < 4; index += 1) {
      await pay(GOALS[0]!, CUSTOMER, 10_000n);
    }
    expect(await detect(new Date(Date.now() + 61 * 60_000))).toEqual({ created: 0, alreadyOpen: 0 });
  });
});

describe('SEC-FRD-002 / D53 décision tracée', () => {
  beforeEach(async () => {
    await publishSetting(admin, RISK_THRESHOLDS_KEY, THRESHOLDS);
    for (let index = 0; index < 4; index += 1) {
      await pay(GOALS[0]!, CUSTOMER, 10_000n);
    }
    await detect();
  });

  async function alertId(): Promise<string> {
    return (await admin.query<{ id: string }>('SELECT id FROM risk.alert')).rows[0]!.id;
  }

  it('Conformité confirme avec motif ; aucune sanction automatique (compte toujours actif)', async () => {
    const id = await alertId();
    await transact('app_rw', (client) => decideRiskAlert(client, { alertId: id, principal: COMP1, decision: 'CONFIRMED', reason: 'fractionnement confirmé, dossier ouvert' }));
    const decision = await admin.query('SELECT decision, decided_by FROM risk.alert_decision');
    expect(decision.rows).toEqual([{ decision: 'CONFIRMED', decided_by: 'comp-1' }]);
    const account = await admin.query('SELECT status FROM identity.account WHERE id = $1', [CUSTOMER]);
    expect(account.rows).toEqual([{ status: 'ACTIVE' }]);
  });

  it('refuse un rôle non autorisé (ADMIN_FORBIDDEN), un motif vide, une seconde décision', async () => {
    const id = await alertId();
    expect((await failure(() => transact('app_rw', (client) => decideRiskAlert(client, { alertId: id, principal: OPS, decision: 'DISMISSED', reason: 'ok' })))).code).toBe('ADMIN_FORBIDDEN');
    expect((await failure(() => transact('app_rw', (client) => decideRiskAlert(client, { alertId: id, principal: RISK1, decision: 'DISMISSED', reason: '  ' })))).code).toBe('RISK_INVALID_REQUEST');
    await transact('app_rw', (client) => decideRiskAlert(client, { alertId: id, principal: RISK1, decision: 'DISMISSED', reason: 'faux positif' }));
    expect((await failure(() => transact('app_rw', (client) => decideRiskAlert(client, { alertId: id, principal: COMP1, decision: 'CONFIRMED', reason: 'revue' })))).code).toBe('RISK_ALERT_ALREADY_DECIDED');
    expect((await failure(() => transact('app_rw', (client) => decideRiskAlert(client, { alertId: uuidv7(), principal: RISK1, decision: 'DISMISSED', reason: 'x' })))).code).toBe('RISK_ALERT_NOT_FOUND');
  });

  it('alertes et décisions en ajout seul', async () => {
    const id = await alertId();
    await transact('app_rw', (client) => decideRiskAlert(client, { alertId: id, principal: RISK1, decision: 'DISMISSED', reason: 'faux positif' }));
    for (const sql of ['UPDATE risk.alert SET rule = rule', 'DELETE FROM risk.alert_decision', 'TRUNCATE risk.alert_decision']) {
      expect((await failure(() => admin.query(sql))).message, sql).toMatch(/^RISK_APPEND_ONLY/);
    }
  });
});

describe('D53 règles imposées par la base', () => {
  it('preuves de forme fixe et cohérentes (RISK_INVALID_REQUEST)', async () => {
    for (const evidence of [
      { ...VALID_EVIDENCE, score: 0.9 },
      { ...VALID_EVIDENCE, count: 5 },
      { ...VALID_EVIDENCE, count: 3, eventIds: VALID_EVIDENCE.eventIds.slice(0, 3) },
      { ...VALID_EVIDENCE, eventIds: 'tous' },
    ]) {
      const result = await failure(() => rawAlert(evidence, 'REPEATED_CANCELLATIONS'));
      expect(result.message, JSON.stringify(evidence)).toMatch(/^RISK_INVALID_REQUEST/);
    }
  });

  it('une alerte ouverte par règle et sujet (RISK_ALERT_OPEN)', async () => {
    await rawAlert(VALID_EVIDENCE);
    expect((await failure(() => rawAlert(VALID_EVIDENCE))).message).toMatch(/^RISK_ALERT_OPEN/);
  });

  it('règle et nature du sujet cohérentes (contrainte)', async () => {
    expect((await failure(() => rawAlert(VALID_EVIDENCE, 'HANDOVER_SPIKE', 'CUSTOMER'))).code).toBe('23514');
    expect((await failure(() => rawAlert(VALID_EVIDENCE, 'PAYMENT_VELOCITY', 'PARTNER'))).code).toBe('23514');
  });
});
