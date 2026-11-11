import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import type { Refund, RefundKind } from '../../src/modules/settlement/refund.store';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import { decideRefund, instructRefund, prepareRefund, recordRefundExecution } from '../../src/workflows/refund';
import {
  AGREEMENT_STACK_MIGRATIONS,
  AGREEMENT_STACK_SCHEMAS,
  createAgreementC,
  PLAN_C,
  publishKycLimits,
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
  'db/migrations/0043_settlement_beneficiary.sql',
  'db/migrations/0044_agreements_beneficiary_payment.sql',
  'db/migrations/0045_settlement_refund.sql',
  'db/migrations/0046_agreements_refunded.sql',
  'db/migrations/0048_settlement_refund_surplus.sql',
].map((path) => resolve(process.cwd(), path));

const CUSTOMER_ID = '019a9f00-0000-7000-8000-0000000000c1';
const GOAL = '019a9f00-0000-7000-8000-0000000000a1';
const GOAL2 = '019a9f00-0000-7000-8000-0000000000a2';
const OPS: AdminPrincipal = { actorId: 'ops-1', roles: ['OPERATIONS'] };
const FIN: AdminPrincipal = { actorId: 'fin-1', roles: ['FINANCE'], maxAmountXaf: 1_000_000n };
const FIN2: AdminPrincipal = { actorId: 'fin-2', roles: ['FINANCE'], maxAmountXaf: 1_000_000n };
const KEYS = generateKeyPairSync('ed25519');

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

async function pending(amount: bigint, agreementId = GOAL): Promise<string> {
  const attemptId = uuidv7();
  await transact('app_rw', async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId, channel: 'MTN_MOMO', amountXaf: amount, idemKey: uuidv7() });
    await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
  });
  return attemptId;
}

async function confirm(attemptId: string, amount: bigint): Promise<void> {
  await transact('app_rw', (client) =>
    confirmPaymentAndFundAgreement(client, {
      attemptId,
      customerId: CUSTOMER_ID,
      providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: amount, outcome: 'SUCCEEDED' },
      actorId: 'payments-worker',
    }),
  );
}

/** D39 : deux tentatives concurrentes de 200 000, chacune sous le reste dû (300 000), toutes deux confirmées. */
async function overpay(): Promise<void> {
  const first = await pending(200_000n);
  const second = await pending(200_000n);
  await confirm(first, 200_000n);
  await confirm(second, 200_000n);
}

async function status(): Promise<string | undefined> {
  const result = await admin.query<{ status: string }>('SELECT status FROM agreements.agreement_state WHERE id = $1', [GOAL]);
  return result.rows[0]?.status;
}

async function clientBalance(): Promise<string | undefined> {
  const result = await admin.query<{ balance: string }>(
    `SELECT (credit_total_xaf - debit_total_xaf)::text AS balance FROM ledger.account_balance
      WHERE code = '2100' AND owner_type = 'CLIENT' AND owner_id = $1`,
    [CUSTOMER_ID],
  );
  return result.rows[0]?.balance;
}

async function transition(from: string, to: string, agreementId = GOAL): Promise<void> {
  await admin.query(
    `INSERT INTO agreements.status_event (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
     SELECT $1, max(seq) + 1, 'TRANSITION', $2, $3, NULL, NULL, 'ops-9', now() FROM agreements.status_event WHERE agreement_id = $1`,
    [agreementId, from, to],
  );
}

async function prepare(kind: RefundKind, principal: AdminPrincipal = OPS, agreementId = GOAL): Promise<Refund> {
  return transact('app_rw', (client) => prepareRefund(client, { id: uuidv7(), agreementId, kind, principal }));
}

/** Prépare, approuve, instruit puis enregistre l'issue rapportée par l'établissement. */
async function runRefund(kind: RefundKind, outcome: 'EXECUTED' | 'REJECTED'): Promise<Refund> {
  const refund = await prepare(kind);
  await transact('app_rw', (client) => decideRefund(client, { refundId: refund.refundId, principal: FIN, decision: 'APPROVED' }));
  await transact('app_rw', (client) => instructRefund(client, { refundId: refund.refundId, principal: FIN, signingKey: KEYS.privateKey, keyId: 'k1' }));
  await transact('app_rw', (client) =>
    recordRefundExecution(client, { refundId: refund.refundId, principal: FIN2, outcome, bankReference: `ETAB-${refund.refundId.slice(-8)}` }),
  );
  return refund;
}

async function rawRefund(kind: RefundKind): Promise<void> {
  await admin.query(
    `INSERT INTO settlement.refund (id, agreement_id, kind, customer_id, amount_xaf, prepared_by, prepared_at)
     VALUES ($1, $2, $3, $4, 1, 'ops-1', now())`,
    [uuidv7(), GOAL, kind, CUSTOMER_ID],
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
  for (const schema of ['settlement', ...AGREEMENT_STACK_SCHEMAS]) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
  await transact('app_rw', async (client) => {
    await validateLandlord(client, uuidv7());
    await seedPaymentPlan(client, PLAN_C);
    await createAgreementC(client, { id: GOAL, customerId: CUSTOMER_ID, active: true });
  });
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER_ID, 'STRONG');
  await publishKycLimits(admin);
});

describe('D51 trop-perçu : restitution du surplus au-delà de la cible', () => {
  it('surplus calculé par la base (400 000 versés − 300 000), restitué ; l’objectif reste FUNDED', async () => {
    await overpay();
    expect(await status()).toBe('FUNDED');
    const refund = await runRefund('SURPLUS', 'EXECUTED');
    expect(refund.amountXaf).toBe(100_000n);
    expect(await status()).toBe('FUNDED');
    expect(await clientBalance()).toBe('300000');
  });

  it('plus rien à restituer après exécution (REFUND_NOT_ALLOWED)', async () => {
    await overpay();
    await runRefund('SURPLUS', 'EXECUTED');
    expect((await failure(() => prepare('SURPLUS'))).message).toMatch(/^REFUND_NOT_ALLOWED: aucun montant/);
  });

  it('versement exact : aucun trop-perçu (REFUND_NOT_ALLOWED)', async () => {
    await confirm(await pending(300_000n), 300_000n);
    expect((await failure(() => prepare('SURPLUS'))).message).toMatch(/^REFUND_NOT_ALLOWED: aucun montant/);
  });

  it('cible non atteinte : pas de trop-perçu sur un objectif actif (REFUND_NOT_ALLOWED)', async () => {
    await confirm(await pending(100_000n), 100_000n);
    expect((await failure(() => prepare('SURPLUS'))).message).toMatch(/^REFUND_NOT_ALLOWED: trop-perçu/);
  });

  it('le montant fourni par l’appelant est recalculé par la base', async () => {
    await overpay();
    await rawRefund('SURPLUS');
    const row = await admin.query('SELECT amount_xaf::text AS amount FROM settlement.refund');
    expect(row.rows[0]).toEqual({ amount: '100000' });
  });

  it('surplus rendu puis litige : l’annulation ne rembourse que le reste (300 000), REFUNDED atteint', async () => {
    await overpay();
    await runRefund('SURPLUS', 'EXECUTED');
    await transition('FUNDED', 'DISPUTED');
    const refund = await runRefund('CANCELLATION', 'EXECUTED');
    expect(refund.amountXaf).toBe(300_000n);
    expect(await status()).toBe('REFUNDED');
    expect(await clientBalance()).toBe('0');
  });
});

describe('D51 montant déjà remboursé compté par objectif', () => {
  it('le surplus rendu sur un objectif ne réduit pas le remboursement d’un autre objectif du même client', async () => {
    await transact('app_rw', (client) => createAgreementC(client, { id: GOAL2, customerId: CUSTOMER_ID, active: true }));
    await overpay();
    await runRefund('SURPLUS', 'EXECUTED');
    await confirm(await pending(100_000n, GOAL2), 100_000n);
    await transition('ACTIVE', 'FROZEN', GOAL2);
    const other = await prepare('CANCELLATION', OPS, GOAL2);
    expect(other.amountXaf).toBe(100_000n);
  });
});

describe('D51 un seul remboursement en cours ; nouvelle tentative après refus', () => {
  it('un remboursement en cours bloque le suivant (store et base)', async () => {
    await overpay();
    await prepare('SURPLUS');
    expect((await failure(() => prepare('SURPLUS'))).code).toBe('REFUND_ALREADY_PREPARED');
    expect((await failure(() => rawRefund('SURPLUS'))).message).toMatch(/^REFUND_ALREADY_PREPARED/);
  });

  it('refus de l’établissement : un nouveau remboursement du même montant peut être préparé', async () => {
    await confirm(await pending(100_000n), 100_000n);
    await transition('ACTIVE', 'FROZEN');
    await runRefund('CANCELLATION', 'REJECTED');
    expect(await status()).toBe('FROZEN');
    const retry = await runRefund('CANCELLATION', 'EXECUTED');
    expect(retry.amountXaf).toBe(100_000n);
    expect(await status()).toBe('REFUNDED');
  });

  it('refus de l’approbateur : un nouveau remboursement peut être préparé', async () => {
    await confirm(await pending(100_000n), 100_000n);
    await transition('ACTIVE', 'FROZEN');
    const first = await prepare('CANCELLATION');
    await transact('app_rw', (client) =>
      decideRefund(client, { refundId: first.refundId, principal: FIN, decision: 'REJECTED', reason: 'pièce justificative manquante' }),
    );
    const second = await prepare('CANCELLATION');
    expect(second.amountXaf).toBe(100_000n);
  });

  it('la nature est obligatoire et en liste blanche (base)', async () => {
    await overpay();
    const missing = await failure(() =>
      admin.query(
        `INSERT INTO settlement.refund (id, agreement_id, customer_id, amount_xaf, prepared_by, prepared_at)
         VALUES ($1, $2, $3, 1, 'ops-1', now())`,
        [uuidv7(), GOAL, CUSTOMER_ID],
      ),
    );
    expect(missing.code).toBe('23502');
    expect((await failure(() => rawRefund('BONUS' as RefundKind))).code).toBe('23514');
  });
});
