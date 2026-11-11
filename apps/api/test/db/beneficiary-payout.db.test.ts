import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { xaf } from '@achat/money';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import { getPartnerLedgerOwner } from '../../src/modules/catalog/partner-ledger.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendLedgerEntry, ensurePartnerFundsAccount, systemAccountId } from '../../src/modules/ledger/entry.store';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { verifyBeneficiaryPayoutInstruction, type BeneficiaryPayout } from '../../src/modules/settlement/beneficiary-payout.store';
import { payBeneficiaryForCustomer } from '../../src/workflows/beneficiary-payment';
import {
  decideBeneficiaryPayout,
  instructBeneficiaryPayout,
  prepareBeneficiaryPayout,
  recordBeneficiaryPayoutExecution,
} from '../../src/workflows/beneficiary-payout';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import {
  AGREEMENT_STACK_MIGRATIONS,
  AGREEMENT_STACK_SCHEMAS,
  createAgreementC,
  PLAN_C,
  publishKycLimits,
  seedCustomerAccount,
  seedLedgerGenesis,
  seedPaymentPlan,
  validateBeneficiary,
} from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  ...AGREEMENT_STACK_MIGRATIONS,
  'db/migrations/0038_partner_ledger_identity.sql',
  'db/migrations/0039_agreements_handover.sql',
  'db/migrations/0040_settlement_handover.sql',
  'db/migrations/0041_settlement_payout.sql',
  'db/migrations/0042_settlement_execution.sql',
  'db/migrations/0043_settlement_beneficiary.sql',
  'db/migrations/0044_agreements_beneficiary_payment.sql',
  'db/migrations/0045_settlement_refund.sql',
  'db/migrations/0046_agreements_refunded.sql',
  'db/migrations/0047_settlement_beneficiary_payout.sql',
].map((path) => resolve(process.cwd(), path));

const CUSTOMER_ID = '019a9d00-0000-7000-8000-0000000000c1';
const GOAL = '019a9d00-0000-7000-8000-0000000000a1';
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

async function fundAndPay(): Promise<void> {
  const attemptId = uuidv7();
  await transact('app_rw', async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId: GOAL, channel: 'ORANGE_MONEY', amountXaf: 300_000n, idemKey: uuidv7() });
    await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
  });
  await transact('app_rw', (client) =>
    confirmPaymentAndFundAgreement(client, {
      attemptId,
      customerId: CUSTOMER_ID,
      providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: 300_000n, outcome: 'SUCCEEDED' },
      actorId: 'payments-worker',
    }),
  );
  await transact('app_rw', (client) => payBeneficiaryForCustomer(client, { agreementId: GOAL, customerId: CUSTOMER_ID }));
}

async function beneficiaryBalance(): Promise<string | undefined> {
  const result = await admin.query<{ balance: string }>(
    `SELECT (b.credit_total_xaf - b.debit_total_xaf)::text AS balance FROM ledger.account_balance b
       JOIN catalog.partner_ledger_identity i ON i.owner_id = b.owner_id
      WHERE b.code = '2200' AND b.owner_type = 'PARTNER' AND i.partner_id = 'school-1'`,
  );
  return result.rows[0]?.balance;
}

async function prepare(principal: AdminPrincipal = OPS): Promise<BeneficiaryPayout> {
  return transact('app_rw', (client) => prepareBeneficiaryPayout(client, { id: uuidv7(), agreementId: GOAL, principal }));
}

async function approved(): Promise<string> {
  const payout = await prepare();
  await transact('app_rw', (client) => decideBeneficiaryPayout(client, { payoutId: payout.payoutId, principal: FIN, decision: 'APPROVED' }));
  return payout.payoutId;
}

async function instructed(): Promise<string> {
  const payoutId = await approved();
  await transact('app_rw', (client) => instructBeneficiaryPayout(client, { payoutId, principal: FIN, signingKey: KEYS.privateKey, keyId: 'k1' }));
  return payoutId;
}

/** Instruction posée directement en base (contourne le store). */
async function rawInstruction(payoutId: string, amount: string, beneficiaryId = 'school-1'): Promise<void> {
  await transact('app_rw', (client) =>
    client.query(
      `INSERT INTO settlement.beneficiary_payout_instruction (payout_id, document, document_hash, signature, key_id, instructed_by, instructed_at)
       VALUES ($1, $2::jsonb, $3, $4, 'k1', 'fin-1', now())`,
      [
        payoutId,
        JSON.stringify({ domain: 'beneficiary-payout-instruction-v1', payout_id: payoutId, beneficiary_id: beneficiaryId, amount_xaf: amount }),
        Buffer.alloc(32, 1),
        Buffer.alloc(64, 2),
      ],
    ),
  );
}

/** Écriture puis exécution posées directement en base, dans une même transaction. */
async function rawExecution(
  payoutId: string,
  input: { type?: string; amount?: bigint; recordedBy?: string; partnerId?: string; entry?: boolean; ref?: string; credits?: readonly (readonly ['1100' | '7100', bigint])[]; extraLines?: boolean },
): Promise<void> {
  await transact('app_rw', async (client) => {
    let entryId: string | null = null;
    if (input.entry !== false) {
      const owner = await getPartnerLedgerOwner(client, input.partnerId ?? 'school-1');
      const amount = xaf(input.amount ?? 300_000n);
      const entry = await appendLedgerEntry(client, {
        id: uuidv7(),
        operationType: input.type ?? 'SETTLEMENT_SENT',
        businessRefs: { beneficiary_payout_id: input.ref ?? payoutId },
        actorId: 'fin-2',
        approvers: [],
        idemScope: 'test.beneficiary-payout',
        idemKey: uuidv7(),
        postings: [
          { accountId: await ensurePartnerFundsAccount(client, owner ?? ''), direction: 'DEBIT', amount },
          ...(await Promise.all(
            (input.credits ?? [['1100', input.amount ?? 300_000n]]).map(async ([code, value]) => ({
              accountId: await systemAccountId(client, code),
              direction: 'CREDIT' as const,
              amount: xaf(value),
            })),
          )),
          // Lignes supplémentaires équilibrées entre deux autres comptes système.
          ...(input.extraLines === true
            ? [
                { accountId: await systemAccountId(client, '7100'), direction: 'DEBIT' as const, amount: xaf(50_000n) },
                { accountId: await systemAccountId(client, '2900'), direction: 'CREDIT' as const, amount: xaf(50_000n) },
              ]
            : []),
        ],
      });
      entryId = entry.id;
    }
    await client.query(
      `INSERT INTO settlement.beneficiary_payout_execution (payout_id, outcome, bank_reference, entry_id, recorded_by, recorded_at)
       VALUES ($1, 'EXECUTED', 'ETAB-X', $2, $3, now())`,
      [payoutId, entryId, input.recordedBy ?? 'fin-2'],
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
    await validateBeneficiary(client, uuidv7(), 'school-1', 'SCHOOL');
    await validateBeneficiary(client, uuidv7(), 'school-2', 'SCHOOL');
    await seedPaymentPlan(client, PLAN_C);
    await createAgreementC(client, { id: GOAL, customerId: CUSTOMER_ID, active: true, beneficiaryId: 'school-1' });
  });
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER_ID, 'STRONG');
  await publishKycLimits(admin, {
    BASIC: { holdingXaf: 200_000n, monthlyXaf: 500_000n },
    STRONG: { holdingXaf: 2_000_000n, monthlyXaf: 2_000_000n },
  });
});

describe('F-PLN-003 / F-SET-003 préparation et décision du virement au bénéficiaire', () => {
  it('bénéficiaire et montant calculés par la base (cible, sans commission)', async () => {
    await fundAndPay();
    const payout = await prepare();
    expect(payout).toMatchObject({ agreementId: GOAL, beneficiaryId: 'school-1', amountXaf: 300_000n });
  });

  it('refuse un virement sans règlement au bénéficiaire (SETTLEMENT_NOT_FUNDED)', async () => {
    expect((await failure(() => prepare())).code).toBe('SETTLEMENT_NOT_FUNDED');
    const base = await failure(() =>
      admin.query(
        `INSERT INTO settlement.beneficiary_payout (id, agreement_id, beneficiary_id, amount_xaf, prepared_by, prepared_at)
         VALUES ($1, $2, 'school-1', 300000, 'ops-1', now())`,
        [uuidv7(), GOAL],
      ),
    );
    expect(base.message).toMatch(/^SETTLEMENT_NOT_FUNDED/);
  });

  it('montant et bénéficiaire fournis par l’appelant recalculés par la base', async () => {
    await fundAndPay();
    await admin.query(
      `INSERT INTO settlement.beneficiary_payout (id, agreement_id, beneficiary_id, amount_xaf, prepared_by, prepared_at)
       VALUES ($1, $2, 'school-2', 1, 'ops-1', now())`,
      [uuidv7(), GOAL],
    );
    const row = await admin.query('SELECT beneficiary_id, amount_xaf::text AS amount FROM settlement.beneficiary_payout');
    expect(row.rows[0]).toEqual({ beneficiary_id: 'school-1', amount: '300000' });
  });

  it('un seul virement par objectif (SETTLEMENT_ALREADY_PREPARED)', async () => {
    await fundAndPay();
    await prepare();
    expect((await failure(() => prepare())).code).toBe('SETTLEMENT_ALREADY_PREPARED');
  });

  it('I-7 le préparateur ne décide pas (store et base)', async () => {
    await fundAndPay();
    const payout = await prepare(FIN);
    const store = await failure(() =>
      transact('app_rw', (client) => decideBeneficiaryPayout(client, { payoutId: payout.payoutId, principal: FIN, decision: 'APPROVED' })),
    );
    expect(store.code).toBe('MAKER_CANNOT_APPROVE');
    const base = await failure(() =>
      admin.query(
        `INSERT INTO settlement.beneficiary_payout_decision (payout_id, decision, decided_by, reason, decided_at) VALUES ($1, 'APPROVED', 'fin-1', NULL, now())`,
        [payout.payoutId],
      ),
    );
    expect(base.message).toMatch(/^MAKER_CANNOT_APPROVE/);
  });

  it('SEC-AUTHZ-001 OPERATIONS n’approuve pas ; plafond de l’approbateur', async () => {
    await fundAndPay();
    const payout = await prepare(FIN);
    const ops = await failure(() =>
      transact('app_rw', (client) =>
        decideBeneficiaryPayout(client, { payoutId: payout.payoutId, principal: { ...OPS, actorId: 'ops-2' }, decision: 'APPROVED' }),
      ),
    );
    expect(ops.code).toBe('ADMIN_FORBIDDEN');
    const capped = await failure(() =>
      transact('app_rw', (client) =>
        decideBeneficiaryPayout(client, { payoutId: payout.payoutId, principal: { ...FIN2, maxAmountXaf: 299_999n }, decision: 'APPROVED' }),
      ),
    );
    expect(capped.code).toBe('ADMIN_AMOUNT_LIMIT');
  });
});

describe('INT-NR-002 / F-SET-004 instruction signée et exécution', () => {
  it('instruction canonique signée, vérifiable ; altération détectée', async () => {
    await fundAndPay();
    const payoutId = await approved();
    const instruction = await transact('app_rw', (client) =>
      instructBeneficiaryPayout(client, { payoutId, principal: FIN, signingKey: KEYS.privateKey, keyId: 'plateforme-test-1' }),
    );
    expect(instruction.document).toEqual({
      domain: 'beneficiary-payout-instruction-v1',
      payout_id: payoutId,
      beneficiary_id: 'school-1',
      amount_xaf: '300000',
    });
    expect(verifyBeneficiaryPayoutInstruction(KEYS.publicKey, instruction.document, instruction.signature)).toBe(true);
    expect(verifyBeneficiaryPayoutInstruction(KEYS.publicKey, { ...instruction.document, beneficiary_id: 'school-2' }, instruction.signature)).toBe(false);
  });

  it('pas d’instruction avant approbation (SETTLEMENT_NOT_APPROVED, store et base)', async () => {
    await fundAndPay();
    const payout = await prepare();
    const store = await failure(() =>
      transact('app_rw', (client) =>
        instructBeneficiaryPayout(client, { payoutId: payout.payoutId, principal: FIN, signingKey: KEYS.privateKey, keyId: 'k1' }),
      ),
    );
    expect(store.code).toBe('SETTLEMENT_NOT_APPROVED');
    expect((await failure(() => rawInstruction(payout.payoutId, '300000'))).message).toMatch(/^SETTLEMENT_NOT_APPROVED/);
  });

  it('la base refuse une instruction d’un autre montant (SETTLEMENT_INSTRUCTION_MISMATCH)', async () => {
    await fundAndPay();
    const payoutId = await approved();
    expect((await failure(() => rawInstruction(payoutId, '300001'))).message).toMatch(/^SETTLEMENT_INSTRUCTION_MISMATCH/);
    expect((await failure(() => rawInstruction(payoutId, '300000', 'school-2'))).message).toMatch(/^SETTLEMENT_INSTRUCTION_MISMATCH/);
  });

  it('exécution confirmée : SETTLEMENT_SENT 2200 du bénéficiaire → 1100, plus rien dû', async () => {
    await fundAndPay();
    const payoutId = await instructed();
    expect(await beneficiaryBalance()).toBe('300000');
    const done = await transact('app_rw', (client) =>
      recordBeneficiaryPayoutExecution(client, { payoutId, principal: FIN2, outcome: 'EXECUTED', bankReference: 'ETAB-VIR-1' }),
    );
    expect(done.entryId).not.toBeNull();
    expect(await beneficiaryBalance()).toBe('0');
  });

  it('exécution refusée : rien n’est écrit, le montant reste dû', async () => {
    await fundAndPay();
    const payoutId = await instructed();
    const done = await transact('app_rw', (client) =>
      recordBeneficiaryPayoutExecution(client, { payoutId, principal: FIN2, outcome: 'REJECTED', bankReference: 'ETAB-VIR-2' }),
    );
    expect(done.entryId).toBeNull();
    expect(await beneficiaryBalance()).toBe('300000');
  });

  it('I-7 l’émetteur ne confirme pas l’exécution (store et base)', async () => {
    await fundAndPay();
    const payoutId = await instructed();
    const store = await failure(() =>
      transact('app_rw', (client) =>
        recordBeneficiaryPayoutExecution(client, { payoutId, principal: FIN, outcome: 'EXECUTED', bankReference: 'ETAB-VIR-3' }),
      ),
    );
    expect(store.code).toBe('MAKER_CANNOT_APPROVE');
    expect((await failure(() => rawExecution(payoutId, { recordedBy: 'fin-1' }))).message).toMatch(/^MAKER_CANNOT_APPROVE/);
  });

  it('la base refuse une exécution sans écriture conforme (SETTLEMENT_INCOMPLETE)', async () => {
    await fundAndPay();
    const payoutId = await instructed();
    for (const input of [
      { entry: false },
      { amount: 299_999n },
      { partnerId: 'school-2' },
      { type: 'REFUND_SENT' },
      { ref: '019a9d00-0000-7000-8000-0000000000ff' },
      { extraLines: true },
      { credits: [['7100', 300_000n]] },
    ] satisfies Parameters<typeof rawExecution>[1][]) {
      const result = await failure(() => rawExecution(payoutId, input));
      expect(result.message, JSON.stringify(input, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).toMatch(/^SETTLEMENT_INCOMPLETE/);
    }
  });

  it('F-SET-004 instruction sans exécution listée après 24 h, pas avant', async () => {
    await fundAndPay();
    const payoutId = await instructed();
    const soon = await admin.query("SELECT kind, instruction_id FROM settlement.overdue_outgoing_instructions(now() + interval '23 hours')");
    expect(soon.rows).toEqual([]);
    const late = await admin.query("SELECT kind, instruction_id FROM settlement.overdue_outgoing_instructions(now() + interval '25 hours')");
    expect(late.rows).toEqual([{ kind: 'BENEFICIARY_PAYOUT', instruction_id: payoutId }]);
    await transact('app_rw', (client) =>
      recordBeneficiaryPayoutExecution(client, { payoutId, principal: FIN2, outcome: 'REJECTED', bankReference: 'ETAB-VIR-4' }),
    );
    const after = await admin.query("SELECT 1 FROM settlement.overdue_outgoing_instructions(now() + interval '25 hours')");
    expect(after.rows).toEqual([]);
  });

  it('virements, décisions, instructions et exécutions sont en ajout seul', async () => {
    await fundAndPay();
    const payoutId = await instructed();
    await transact('app_rw', (client) =>
      recordBeneficiaryPayoutExecution(client, { payoutId, principal: FIN2, outcome: 'EXECUTED', bankReference: 'ETAB-VIR-5' }),
    );
    for (const sql of [
      'UPDATE settlement.beneficiary_payout SET amount_xaf = 1',
      'DELETE FROM settlement.beneficiary_payout_decision',
      'DELETE FROM settlement.beneficiary_payout_instruction',
      'TRUNCATE settlement.beneficiary_payout_execution',
    ]) {
      expect((await failure(() => admin.query(sql))).message, sql).toMatch(/^SETTLEMENT_APPEND_ONLY/);
    }
  });
});
