import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COMPLAINT_REFERENCE_PATTERN } from '../../src/modules/disputes/domain';
import {
  listDisputedAgreementsWithoutDispute,
  openDispute,
  recordComplaint,
  resolveDispute,
  type RecordedComplaint,
} from '../../src/modules/disputes/dispute.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { getAgreementHistory } from '../../src/workflows/agreement-history';
import { openDisputeAndNotify, resolveDisputeAndNotify } from '../../src/workflows/dispute-notifications';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import {
  AGREEMENT_STACK_MIGRATIONS,
  AGREEMENT_STACK_SCHEMAS,
  createAgreementC,
  PLAN_C,
  publishKycLimits,
  seedCustomerAccount,
  seedPaymentPlan,
  seedLedgerGenesis,
  validateLandlord,
} from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [...AGREEMENT_STACK_MIGRATIONS, 'db/migrations/0032_disputes.sql'].map((path) =>
  resolve(process.cwd(), path),
);
const CUSTOMER_ID = '019a9500-0000-7000-8000-0000000000c1';
const OTHER_CUSTOMER_ID = '019a9500-0000-7000-8000-0000000000c2';
const AGREEMENT_ID = '019a9500-0000-7000-8000-0000000000a1';
const OTHER_AGREEMENT_ID = '019a9500-0000-7000-8000-0000000000a2';

let container: TestDatabase;
let admin: Client;
let migrationSql: string[];

async function transact<T>(
  role: 'app_rw' | 'app_ro' | null,
  action: (client: Client) => Promise<T>,
): Promise<T> {
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

async function complaint(
  agreementId: string | null = AGREEMENT_ID,
  customerId = CUSTOMER_ID,
): Promise<RecordedComplaint> {
  return transact('app_rw', (client) =>
    recordComplaint(client, { id: uuidv7(), customerId, agreementId, channel: 'APP' }),
  );
}

async function open(complaintId: string, actorId = 'support-1'): Promise<Awaited<ReturnType<typeof openDispute>>> {
  return transact('app_rw', (client) =>
    openDispute(client, { id: uuidv7(), complaintId, actorId }),
  );
}

async function agreementStatus(id = AGREEMENT_ID): Promise<string | undefined> {
  const result = await admin.query<{ status: string }>(
    'SELECT status FROM agreements.agreement_state WHERE id = $1',
    [id],
  );
  return result.rows[0]?.status;
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
  for (const schema of ['disputes', ...AGREEMENT_STACK_SCHEMAS]) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
  await transact('app_rw', async (client) => {
    await validateLandlord(client, uuidv7());
    await seedPaymentPlan(client, PLAN_C);
    await createAgreementC(client, { id: AGREEMENT_ID, customerId: CUSTOMER_ID, active: true });
    await createAgreementC(client, { id: OTHER_AGREEMENT_ID, customerId: OTHER_CUSTOMER_ID, active: true });
  });
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER_ID, 'STRONG');
  await seedCustomerAccount(admin, OTHER_CUSTOMER_ID, 'STRONG');
  await publishKycLimits(admin);
});

describe('F-SUP-001 réclamations', () => {
  it('enregistre une réclamation avec un numéro non séquentiel et un horodatage serveur', async () => {
    const recorded = await complaint();
    expect(recorded.reference).toMatch(COMPLAINT_REFERENCE_PATTERN);
    expect(Math.abs(Date.parse(recorded.receivedAt) - Date.now())).toBeLessThan(60_000);
  });

  it('accepte une réclamation sans accord', async () => {
    expect((await complaint(null)).reference).toMatch(COMPLAINT_REFERENCE_PATTERN);
  });

  it('refuse une réclamation sur l’accord d’un autre client (DISPUTE_INVALID_REQUEST)', async () => {
    const result = await failure(() => complaint(OTHER_AGREEMENT_ID, CUSTOMER_ID));
    expect(result.message).toMatch(/DISPUTE_INVALID_REQUEST/);
  });

  it('la base refuse un numéro de forme invalide (23514)', async () => {
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO disputes.complaint (id, reference, customer_id, agreement_id, channel, received_at)
           VALUES ($1, 'R-0000000001X', $2, NULL, 'APP', now())`,
          [uuidv7(), CUSTOMER_ID],
        ),
      ),
    );
    expect(result.code).toBe('23514');
  });
});

describe('F-SUP-002 un litige suspend l’accord', () => {
  it('ouvre le litige et passe l’accord à DISPUTED dans la même transaction', async () => {
    const opened = await open((await complaint()).id);
    expect(opened).toMatchObject({ agreementId: AGREEMENT_ID, fromStatus: 'ACTIVE' });
    expect(await agreementStatus()).toBe('DISPUTED');
  });

  it('suspension effective : aucun versement ni annulation sur un accord en litige', async () => {
    await open((await complaint()).id);
    const payment = await failure(() =>
      transact('app_rw', (client) =>
        createStoredPaymentAttempt(client, {
          id: uuidv7(),
          agreementId: AGREEMENT_ID,
          channel: 'MTN_MOMO',
          amountXaf: 10_000n,
          idemKey: uuidv7(),
        }),
      ),
    );
    expect(payment.message).toMatch(/^PAYMENT_AGREEMENT_NOT_ACTIVE/);
  });

  it('refuse un litige sur une réclamation sans accord (DISPUTE_INVALID_REQUEST)', async () => {
    const result = await failure(async () => open((await complaint(null)).id));
    expect(result.code).toBe('DISPUTE_INVALID_REQUEST');
  });

  it('refuse un second litige ouvert sur le même accord (DISPUTE_ALREADY_OPEN)', async () => {
    await open((await complaint()).id);
    const result = await failure(async () => open((await complaint()).id));
    expect(result.code).toBe('DISPUTE_ALREADY_OPEN');
  });

  it('I-7 la levée par la personne qui a ouvert le litige est refusée (MAKER_CANNOT_APPROVE)', async () => {
    const opened = await open((await complaint()).id, 'support-1');
    const result = await failure(() =>
      transact('app_rw', (client) => resolveDispute(client, { disputeId: opened.disputeId, actorId: 'support-1' })),
    );
    expect(result.code).toBe('MAKER_CANNOT_APPROVE');
    expect(await agreementStatus()).toBe('DISPUTED');
  });

  it('I-7 la base refuse aussi une levée par la même personne (MAKER_CANNOT_APPROVE)', async () => {
    const opened = await open((await complaint()).id, 'support-1');
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO disputes.dispute_resolution (dispute_id, outcome, resolved_by, resolved_at)
           VALUES ($1, 'RESUMED', 'support-1', now())`,
          [opened.disputeId],
        ),
      ),
    );
    expect(result.message).toMatch(/^MAKER_CANNOT_APPROVE/);
  });

  it('la base refuse une levée sans retour de l’accord à son état d’origine (DISPUTE_SUSPENSION_INCOMPLETE)', async () => {
    const opened = await open((await complaint()).id, 'support-1');
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO disputes.dispute_resolution (dispute_id, outcome, resolved_by, resolved_at)
           VALUES ($1, 'RESUMED', 'support-2', now())`,
          [opened.disputeId],
        ),
      ),
    );
    expect(result.message).toMatch(/^DISPUTE_SUSPENSION_INCOMPLETE/);
    expect(await agreementStatus()).toBe('DISPUTED');
  });

  it('levée tracée : l’accord revient à son état d’origine', async () => {
    const opened = await open((await complaint()).id, 'support-1');
    const resolved = await transact('app_rw', (client) =>
      resolveDispute(client, { disputeId: opened.disputeId, actorId: 'support-2' }),
    );
    expect(resolved).toMatchObject({ agreementStatus: 'ACTIVE', outcome: 'RESUMED' });
    expect(await agreementStatus()).toBe('ACTIVE');
    const trace = await admin.query(
      `SELECT d.opened_by, r.resolved_by, r.resolved_at >= d.opened_at AS ordered
         FROM disputes.dispute d JOIN disputes.dispute_resolution r ON r.dispute_id = d.id`,
    );
    expect(trace.rows).toEqual([{ opened_by: 'support-1', resolved_by: 'support-2', ordered: true }]);
  });

  it('refuse de lever deux fois le même litige (DISPUTE_NOT_OPEN)', async () => {
    const opened = await open((await complaint()).id, 'support-1');
    await transact('app_rw', (client) => resolveDispute(client, { disputeId: opened.disputeId, actorId: 'support-2' }));
    const result = await failure(() =>
      transact('app_rw', (client) => resolveDispute(client, { disputeId: opened.disputeId, actorId: 'support-3' })),
    );
    expect(result.code).toBe('DISPUTE_NOT_OPEN');
  });

  it('la base refuse un litige sans passage de l’accord à DISPUTED (DISPUTE_SUSPENSION_INCOMPLETE)', async () => {
    const recorded = await complaint();
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO disputes.dispute (id, complaint_id, agreement_id, from_status, opened_by, opened_at)
           VALUES ($1, $2, $3, 'ACTIVE', 'support-1', now())`,
          [uuidv7(), recorded.id, AGREEMENT_ID],
        ),
      ),
    );
    expect(result.message).toMatch(/^DISPUTE_SUSPENSION_INCOMPLETE/);
  });

  it('détecte un accord DISPUTED sans litige enregistré', async () => {
    await transact('app_rw', (client) =>
      client.query(
        `INSERT INTO agreements.status_event
           (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
         VALUES ($1, 2, 'TRANSITION', 'ACTIVE', 'DISPUTED', NULL, NULL, 'support-1', now())`,
        [AGREEMENT_ID],
      ),
    );
    const found = await transact('app_ro', (client) => listDisputedAgreementsWithoutDispute(client));
    expect(found).toEqual([AGREEMENT_ID]);
  });

  it('réclamations, litiges et levées sont en ajout seul (DISPUTE_APPEND_ONLY)', async () => {
    const opened = await open((await complaint()).id, 'support-1');
    await transact('app_rw', (client) => resolveDispute(client, { disputeId: opened.disputeId, actorId: 'support-2' }));
    for (const sql of [
      "UPDATE disputes.complaint SET channel = 'PHONE'",
      'DELETE FROM disputes.complaint',
      "UPDATE disputes.dispute SET opened_by = 'x'",
      'DELETE FROM disputes.dispute_resolution',
    ]) {
      const result = await failure(() => admin.query(sql));
      expect(result.message, sql).toMatch(/^DISPUTE_APPEND_ONLY/);
    }
  });
});

describe('F-SUP-003 historique chronologique d’un accord', () => {
  it('assemble accord, versements et litiges dans l’ordre des journaux', async () => {
    const attemptId = uuidv7();
    await transact('app_rw', async (client) => {
      await createStoredPaymentAttempt(client, {
        id: attemptId,
        agreementId: AGREEMENT_ID,
        channel: 'ORANGE_MONEY',
        amountXaf: 50_000n,
        idemKey: uuidv7(),
      });
      await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
    });
    await transact('app_rw', (client) =>
      confirmPaymentAndFundAgreement(client, {
        attemptId,
        customerId: CUSTOMER_ID,
        providerTransaction: { providerTxId: 'tx-histoire-1', attemptId, amountXaf: 50_000n, outcome: 'SUCCEEDED' },
        actorId: 'payments-worker',
      }),
    );
    const opened = await open((await complaint()).id, 'support-1');
    await transact('app_rw', (client) => resolveDispute(client, { disputeId: opened.disputeId, actorId: 'support-2' }));

    const history = await transact('app_ro', (client) =>
      getAgreementHistory(client, { agreementId: AGREEMENT_ID, customerId: CUSTOMER_ID }),
    );
    expect(history.map((item) => item.kind)).toEqual([
      'AGREEMENT_STATUS',
      'PAYMENT_ATTEMPT',
      'PAYMENT_STATUS',
      'PAYMENT_CONFIRMED',
      'PAYMENT_STATUS',
      'COMPLAINT',
      'DISPUTE_OPENED',
      'AGREEMENT_STATUS',
      'DISPUTE_RESOLVED',
      'AGREEMENT_STATUS',
    ]);
    const times = history.map((item) => Date.parse(item.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const confirmed = history.find((item) => item.kind === 'PAYMENT_CONFIRMED');
    expect(confirmed?.amountXaf).toBe(50_000n);
  });

  it('un autre client ne voit pas l’historique (AGREEMENT_NOT_FOUND)', async () => {
    const result = await failure(() =>
      transact('app_ro', (client) => getAgreementHistory(client, { agreementId: AGREEMENT_ID, customerId: OTHER_CUSTOMER_ID })),
    );
    expect(result.code).toBe('AGREEMENT_NOT_FOUND');
  });
});

describe('F-NOT-001 litige : DISPUTE_UPDATED dans la même transaction', () => {
  it('ouverture puis levée : deux événements distincts par canal, aucun doublon au rejeu de lecture', async () => {
    const recorded = await complaint();
    const opened = await transact('app_rw', (client) =>
      openDisputeAndNotify(client, { id: uuidv7(), complaintId: recorded.id, actorId: 'support-1' }),
    );
    await transact('app_rw', (client) => resolveDisputeAndNotify(client, { disputeId: opened.disputeId, actorId: 'support-2' }));
    const rows = await admin.query<{ event_type: string; n: number }>(
      `SELECT event_type, count(*)::int AS n FROM notifications.outbox WHERE recipient_id = $1 GROUP BY event_type`,
      [CUSTOMER_ID],
    );
    expect(rows.rows).toEqual([{ event_type: 'DISPUTE_UPDATED', n: 4 }]);
  });
});
