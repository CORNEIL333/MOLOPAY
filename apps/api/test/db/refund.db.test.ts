import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { xaf } from '@achat/money';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendLedgerEntry, ensureClientFundsAccount, systemAccountId } from '../../src/modules/ledger/entry.store';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { verifyRefundInstruction, type Refund } from '../../src/modules/settlement/refund.store';
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
].map((path) => resolve(process.cwd(), path));

const CUSTOMER_ID = '019a9c00-0000-7000-8000-0000000000c1';
const GOAL = '019a9c00-0000-7000-8000-0000000000a1';
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

async function pay(amount: bigint): Promise<void> {
  const attemptId = uuidv7();
  await transact('app_rw', async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId: GOAL, channel: 'MTN_MOMO', amountXaf: amount, idemKey: uuidv7() });
    await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
  });
  await transact('app_rw', (client) =>
    confirmPaymentAndFundAgreement(client, {
      attemptId,
      customerId: CUSTOMER_ID,
      providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: amount, outcome: 'SUCCEEDED' },
      actorId: 'payments-worker',
    }),
  );
}

/** Annulation signée posée en base (la vérification Ed25519 relève du store, testée ailleurs). */
async function cancel(): Promise<void> {
  const seq = await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM agreements.status_event WHERE agreement_id = $1', [GOAL]);
  await admin.query(
    `INSERT INTO agreements.status_event
       (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
     VALUES ($1, $2, 'TRANSITION', 'ACTIVE', 'CANCELLED_BY_CUSTOMER', $3, $4, 'client-1', now())`,
    [GOAL, (seq.rows[0]?.n ?? 0) + 1, uuidv7(), Buffer.alloc(64, 9)],
  );
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

async function prepare(principal: AdminPrincipal = OPS): Promise<Refund> {
  return transact('app_rw', (client) => prepareRefund(client, { id: uuidv7(), agreementId: GOAL, principal }));
}

async function approved(): Promise<string> {
  const refund = await prepare();
  await transact('app_rw', (client) => decideRefund(client, { refundId: refund.refundId, principal: FIN, decision: 'APPROVED' }));
  return refund.refundId;
}

/** Instruction posée directement en base (contourne le store). */
async function rawInstruction(refundId: string, amount: string, by = 'fin-1'): Promise<void> {
  await transact('app_rw', (client) =>
    client.query(
      `INSERT INTO settlement.refund_instruction (refund_id, document, document_hash, signature, key_id, instructed_by, instructed_at)
       VALUES ($1, $2::jsonb, $3, $4, 'k1', $5, now())`,
      [
        refundId,
        JSON.stringify({ domain: 'refund-instruction-v1', refund_id: refundId, customer_id: CUSTOMER_ID, amount_xaf: amount }),
        Buffer.alloc(32, 1),
        Buffer.alloc(64, 2),
        by,
      ],
    ),
  );
}

/** Écriture REFUND_SENT puis exécution posées directement en base, dans une même transaction. */
async function rawExecution(refundId: string, operationType: string, amount: bigint, debitCustomer = CUSTOMER_ID): Promise<void> {
  await transact('app_rw', async (client) => {
    const entry = await appendLedgerEntry(client, {
      id: uuidv7(),
      operationType,
      businessRefs: { refund_id: refundId, agreement_id: GOAL },
      actorId: 'fin-2',
      approvers: [],
      idemScope: 'test.refund',
      idemKey: uuidv7(),
      postings: [
        { accountId: await ensureClientFundsAccount(client, debitCustomer), direction: 'DEBIT', amount: xaf(amount) },
        { accountId: await systemAccountId(client, '1100'), direction: 'CREDIT', amount: xaf(amount) },
      ],
    });
    await client.query(
      `INSERT INTO settlement.refund_execution (refund_id, outcome, bank_reference, entry_id, recorded_by, recorded_at)
       VALUES ($1, 'EXECUTED', 'ETAB-X', $2, 'fin-2', now())`,
      [refundId, entry.id],
    );
  });
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
  await pay(60_000n);
  await pay(40_000n);
});

describe('F-PLN-004 / F-SAV-005 préparation et décision du remboursement', () => {
  it('montant calculé par la base : 100 % des versements confirmés, sans frais', async () => {
    await cancel();
    const refund = await prepare();
    expect(refund).toMatchObject({ agreementId: GOAL, customerId: CUSTOMER_ID, amountXaf: 100_000n });
  });

  it('refuse un remboursement d’un objectif encore actif (REFUND_NOT_ALLOWED)', async () => {
    const result = await failure(() => prepare());
    expect(result.message).toMatch(/REFUND_NOT_ALLOWED/);
  });

  it('un seul remboursement par objectif (REFUND_ALREADY_PREPARED)', async () => {
    await cancel();
    await prepare();
    const result = await failure(() => prepare());
    expect(result.code).toBe('REFUND_ALREADY_PREPARED');
  });

  it('le montant fourni par l’appelant est recalculé par la base', async () => {
    await cancel();
    await transact('app_rw', (client) =>
      client.query(
        `INSERT INTO settlement.refund (id, agreement_id, customer_id, amount_xaf, prepared_by, prepared_at)
         VALUES ($1, $2, $3, 1, 'ops-1', now())`,
        [uuidv7(), GOAL, CUSTOMER_ID],
      ),
    );
    const row = await admin.query('SELECT amount_xaf::text AS amount FROM settlement.refund');
    expect(row.rows[0]).toEqual({ amount: '100000' });
  });

  it('I-7 le préparateur ne décide pas (store et base)', async () => {
    await cancel();
    const refund = await prepare(FIN);
    const store = await failure(() => transact('app_rw', (client) => decideRefund(client, { refundId: refund.refundId, principal: FIN, decision: 'APPROVED' })));
    expect(store.code).toBe('MAKER_CANNOT_APPROVE');
    const base = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO settlement.refund_decision (refund_id, decision, decided_by, reason, decided_at) VALUES ($1, 'REJECTED', 'fin-1', 'x', now())`,
          [refund.refundId],
        ),
      ),
    );
    expect(base.message).toMatch(/^MAKER_CANNOT_APPROVE/);
  });

  it('SEC-AUTHZ-001 OPERATIONS prépare mais n’approuve pas ; plafond de l’approbateur', async () => {
    await cancel();
    const refund = await prepare(FIN);
    const ops = await failure(() =>
      transact('app_rw', (client) => decideRefund(client, { refundId: refund.refundId, principal: { ...OPS, actorId: 'ops-2' }, decision: 'APPROVED' })),
    );
    expect(ops.code).toBe('ADMIN_FORBIDDEN');
    const capped = await failure(() =>
      transact('app_rw', (client) =>
        decideRefund(client, { refundId: refund.refundId, principal: { ...FIN2, maxAmountXaf: 99_999n }, decision: 'APPROVED' }),
      ),
    );
    expect(capped.code).toBe('ADMIN_AMOUNT_LIMIT');
  });
});

describe('INT-NR-002 / I-6 instruction signée et exécution', () => {
  it('instruction canonique signée, vérifiable ; altération détectée', async () => {
    await cancel();
    const refundId = await approved();
    const instruction = await transact('app_rw', (client) =>
      instructRefund(client, { refundId, principal: FIN, signingKey: KEYS.privateKey, keyId: 'plateforme-test-1' }),
    );
    expect(instruction.document).toEqual({ domain: 'refund-instruction-v1', refund_id: refundId, customer_id: CUSTOMER_ID, amount_xaf: '100000' });
    expect(verifyRefundInstruction(KEYS.publicKey, instruction.document, instruction.signature)).toBe(true);
    expect(verifyRefundInstruction(KEYS.publicKey, { ...instruction.document, amount_xaf: '100001' }, instruction.signature)).toBe(false);
  });

  it('exécution confirmée : REFUND_SENT 2100 → 1100, objectif REFUNDED, plus rien dû au client', async () => {
    await cancel();
    const refundId = await approved();
    await transact('app_rw', (client) => instructRefund(client, { refundId, principal: FIN, signingKey: KEYS.privateKey, keyId: 'k1' }));
    const done = await transact('app_rw', (client) =>
      recordRefundExecution(client, { refundId, principal: FIN2, outcome: 'EXECUTED', bankReference: 'ETAB-REMB-1' }),
    );
    expect(await status()).toBe('REFUNDED');
    expect(await clientBalance()).toBe('0');
    const postings = await admin.query(
      `SELECT a.code, p.direction, p.amount_xaf::text AS amount FROM ledger.posting p JOIN ledger.account a ON a.id = p.account_id
        WHERE p.entry_id = $1 ORDER BY p.ordinal`,
      [done.entryId],
    );
    expect(postings.rows).toEqual([
      { code: '2100', direction: 'D', amount: '100000' },
      { code: '1100', direction: 'C', amount: '100000' },
    ]);
  });

  it('exécution refusée par l’établissement : rien n’est écrit, l’objectif reste annulé', async () => {
    await cancel();
    const refundId = await approved();
    await transact('app_rw', (client) => instructRefund(client, { refundId, principal: FIN, signingKey: KEYS.privateKey, keyId: 'k1' }));
    const done = await transact('app_rw', (client) =>
      recordRefundExecution(client, { refundId, principal: FIN2, outcome: 'REJECTED', bankReference: 'ETAB-REMB-2' }),
    );
    expect(done.entryId).toBeNull();
    expect(await status()).toBe('CANCELLED_BY_CUSTOMER');
    expect(await clientBalance()).toBe('100000');
  });

  it('I-7 l’émetteur ne confirme pas l’exécution (MAKER_CANNOT_APPROVE)', async () => {
    await cancel();
    const refundId = await approved();
    await transact('app_rw', (client) => instructRefund(client, { refundId, principal: FIN, signingKey: KEYS.privateKey, keyId: 'k1' }));
    const result = await failure(() =>
      transact('app_rw', (client) => recordRefundExecution(client, { refundId, principal: FIN, outcome: 'EXECUTED', bankReference: 'ETAB-REMB-3' })),
    );
    expect(result.code).toBe('MAKER_CANNOT_APPROVE');
  });

  it('la base refuse REFUNDED sans écriture de remboursement (AGREEMENT_LEDGER_LINK_REQUIRED)', async () => {
    await cancel();
    const result = await failure(() =>
      admin.query(
        `INSERT INTO agreements.status_event
           (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
         SELECT $1, max(seq) + 1, 'TRANSITION', 'CANCELLED_BY_CUSTOMER', 'REFUNDED', NULL, NULL, 'fin-2', now()
           FROM agreements.status_event WHERE agreement_id = $1`,
        [GOAL],
      ),
    );
    expect(result.message).toMatch(/^AGREEMENT_LEDGER_LINK_REQUIRED/);
  });

  it('la base refuse une exécution confirmée sans écriture (REFUND_INCOMPLETE)', async () => {
    await cancel();
    const refundId = await approved();
    await transact('app_rw', (client) => instructRefund(client, { refundId, principal: FIN, signingKey: KEYS.privateKey, keyId: 'k1' }));
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO settlement.refund_execution (refund_id, outcome, bank_reference, entry_id, recorded_by, recorded_at)
           VALUES ($1, 'EXECUTED', 'ETAB-1', NULL, 'fin-2', now())`,
          [refundId],
        ),
      ),
    );
    expect(result.message).toMatch(/^REFUND_INCOMPLETE: écriture de remboursement absente ou non conforme/);
  });

  it('la base refuse une instruction sans approbation (REFUND_NOT_APPROVED)', async () => {
    await cancel();
    const refund = await prepare();
    const result = await failure(() => rawInstruction(refund.refundId, '100000'));
    expect(result.message).toMatch(/^REFUND_NOT_APPROVED/);
  });

  it('la base refuse une instruction dont le montant diffère (REFUND_INSTRUCTION_MISMATCH)', async () => {
    await cancel();
    const refundId = await approved();
    const result = await failure(() => rawInstruction(refundId, '100001'));
    expect(result.message).toMatch(/^REFUND_INSTRUCTION_MISMATCH/);
  });

  it('I-7 la base refuse que l’émetteur enregistre l’exécution (MAKER_CANNOT_APPROVE)', async () => {
    await cancel();
    const refundId = await approved();
    await rawInstruction(refundId, '100000', 'fin-2');
    const result = await failure(() => rawExecution(refundId, 'REFUND_SENT', 100_000n));
    expect(result.message).toMatch(/^MAKER_CANNOT_APPROVE/);
  });

  it('la base refuse une écriture d’un autre type ou d’un autre montant (REFUND_INCOMPLETE)', async () => {
    await cancel();
    const refundId = await approved();
    await rawInstruction(refundId, '100000');
    // Message de la vérification immédiate (et non de la vérification différée de l'état).
    const immediate = /^REFUND_INCOMPLETE: écriture de remboursement absente ou non conforme/;
    const partial = await failure(() => rawExecution(refundId, 'REFUND_SENT', 60_000n));
    expect(partial.message).toMatch(immediate);
    const otherClient = await failure(() => rawExecution(refundId, 'REFUND_SENT', 100_000n, '019a9c00-0000-7000-8000-0000000000c2'));
    expect(otherClient.message).toMatch(immediate);
    const otherType = await failure(() => rawExecution(refundId, 'SETTLEMENT_SENT', 100_000n));
    expect(otherType.message).toMatch(immediate);
  });

  it('remboursements, décisions, instructions et exécutions sont en ajout seul', async () => {
    await cancel();
    const refundId = await approved();
    await transact('app_rw', (client) => instructRefund(client, { refundId, principal: FIN, signingKey: KEYS.privateKey, keyId: 'k1' }));
    await transact('app_rw', (client) => recordRefundExecution(client, { refundId, principal: FIN2, outcome: 'EXECUTED', bankReference: 'ETAB-REMB-4' }));
    for (const sql of [
      'UPDATE settlement.refund SET amount_xaf = 1',
      'DELETE FROM settlement.refund_decision',
      'DELETE FROM settlement.refund_instruction',
      'DELETE FROM settlement.refund_execution',
    ]) {
      const result = await failure(() => admin.query(sql));
      expect(result.message, sql).toMatch(/^SETTLEMENT_APPEND_ONLY/);
    }
  });
});
