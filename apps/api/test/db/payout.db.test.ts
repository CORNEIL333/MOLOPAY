import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import { mulDivRoundHalfUp, xaf } from '@achat/money';
import { getPartnerLedgerOwner } from '../../src/modules/catalog/partner-ledger.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendLedgerEntry, ensurePartnerFundsAccount, systemAccountId } from '../../src/modules/ledger/entry.store';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { issueHandoverCode } from '../../src/modules/settlement/handover.store';
import type { Payout } from '../../src/modules/settlement/payout.store';
import { confirmHandoverAtPartner } from '../../src/workflows/handover';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import {
  decidePayout,
  instructPayout,
  preparePayout,
  recordPayoutExecution,
} from '../../src/workflows/settlement-payout';
import {
  listOverdueInstructions,
  verifyPayoutInstruction,
  type PayoutInstructionDocument,
} from '../../src/modules/settlement/execution.store';
import {
  AGREEMENT_STACK_MIGRATIONS,
  AGREEMENT_STACK_SCHEMAS,
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

const MIGRATIONS = [
  ...AGREEMENT_STACK_MIGRATIONS,
  'db/migrations/0032_disputes.sql',
  'db/migrations/0038_partner_ledger_identity.sql',
  'db/migrations/0039_agreements_handover.sql',
  'db/migrations/0040_settlement_handover.sql',
  'db/migrations/0041_settlement_payout.sql',
  'db/migrations/0042_settlement_execution.sql',
  'db/migrations/0052_disputes_complaint_closure.sql',
].map((path) => resolve(process.cwd(), path));

const CUSTOMER_ID = '019a9900-0000-7000-8000-0000000000c1';
const AGREEMENT_ID = '019a9900-0000-7000-8000-0000000000a1';
const OFFER_ID = '019a9900-0000-7000-8000-0000000000f1';
const PRICE = 155_000n;
const PEPPER = randomBytes(32);

const OPS: AdminPrincipal = { actorId: 'ops-1', roles: ['OPERATIONS'], cityIds: ['douala'] };
const FIN: AdminPrincipal = { actorId: 'fin-1', roles: ['FINANCE'], cityIds: ['douala'], maxAmountXaf: 1_000_000n };
const FIN2: AdminPrincipal = { actorId: 'fin-2', roles: ['FINANCE'], cityIds: ['douala'], maxAmountXaf: 1_000_000n };

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

/** Accord A financé puis remis au marchand, par les flux réels. */
async function fundAndHandOver(): Promise<void> {
  const attemptId = uuidv7();
  await transact('app_rw', async (client) => {
    await createStoredPaymentAttempt(client, {
      id: attemptId,
      agreementId: AGREEMENT_ID,
      channel: 'MTN_MOMO',
      amountXaf: PRICE,
      idemKey: uuidv7(),
    });
    await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
  });
  await transact('app_rw', (client) =>
    confirmPaymentAndFundAgreement(client, {
      attemptId,
      customerId: CUSTOMER_ID,
      providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: PRICE, outcome: 'SUCCEEDED' },
      actorId: 'payments-worker',
    }),
  );
  const { code } = await transact('app_rw', (client) =>
    issueHandoverCode(client, { agreementId: AGREEMENT_ID, pepper: PEPPER, actorId: 'system-handover' }),
  );
  await transact('app_rw', (client) =>
    confirmHandoverAtPartner(client, {
      code,
      partnerId: 'merchant-1',
      partnerUserId: 'vendeur-1',
      latitude: '4.051056',
      longitude: '9.767869',
      pepper: PEPPER,
    }),
  );
}

async function settings(commissionBps = 250, contestationDays = 0): Promise<void> {
  await publishSetting(admin, 'merchant_commission_bps', commissionBps);
  await publishSetting(admin, 'settlement_contestation_days', contestationDays);
}

async function prepare(principal: AdminPrincipal = OPS): Promise<Payout> {
  return transact('app_rw', (client) =>
    preparePayout(client, { id: uuidv7(), agreementId: AGREEMENT_ID, cityId: 'douala', principal }),
  );
}

async function decide(
  payoutId: string,
  principal: AdminPrincipal,
  decision: 'APPROVED' | 'REJECTED',
  reason?: string,
): Promise<{ readonly status: 'APPROVED' | 'REJECTED'; readonly commissionEntryId: string | null }> {
  return transact('app_rw', (client) => decidePayout(client, { payoutId, principal, decision, reason, cityId: 'douala' }));
}

async function partnerBalance(): Promise<string | undefined> {
  const result = await admin.query<{ balance: string }>(
    `SELECT (credit_total_xaf - debit_total_xaf)::text AS balance
       FROM ledger.account_balance WHERE code = '2200' AND owner_type = 'PARTNER'`,
  );
  return result.rows[0]?.balance;
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
  for (const schema of ['settlement', 'disputes', ...AGREEMENT_STACK_SCHEMAS]) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
  await transact('app_rw', async (client) => {
    await validateMerchant(client, uuidv7());
    await seedPaymentPlan(client, PLAN_A);
    await publishOfferA(client, { offerId: OFFER_ID, partnerId: 'merchant-1', priceXaf: PRICE });
    await createAgreementA(client, { id: AGREEMENT_ID, customerId: CUSTOMER_ID, offerId: OFFER_ID });
  });
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER_ID, 'STRONG');
  await publishKycLimits(admin);
  await publishSetting(admin, 'handover_code_validity_days', 30);
  await fundAndHandOver();
});

describe('F-SET-002 préparation du règlement', () => {
  it('la base calcule brut, commission (arrondi au plus proche) et net', async () => {
    await settings(250);
    const prepared = await prepare();
    expect(prepared).toMatchObject({ grossXaf: 155_000n, commissionXaf: 3_875n, netXaf: 151_125n });
  });

  it('arrondi de la commission identique à packages/money (demi-franc vers le haut)', async () => {
    await settings(1);
    const prepared = await prepare();
    // 155 000 × 1 / 10 000 = 15,5 : arrondi au plus proche, demi-franc vers le haut → 16
    // (une troncature donnerait 15). Même résultat que mulDivRoundHalfUp.
    expect(prepared.commissionXaf).toBe(16n);
    expect(mulDivRoundHalfUp(xaf(PRICE), 1n, 10_000n).amount).toBe(16n);
  });

  it('fermé par défaut : sans commission ni délai publiés (SETTLEMENT_SETTINGS_NOT_CONFIGURED)', async () => {
    const result = await failure(() => prepare());
    expect(result.message).toMatch(/SETTLEMENT_SETTINGS_NOT_CONFIGURED/);
  });

  it('refuse avant la fin du délai de contestation (SETTLEMENT_NOT_DUE)', async () => {
    await settings(250, 7);
    const result = await failure(() => prepare());
    expect(result.message).toMatch(/SETTLEMENT_NOT_DUE/);
  });

  it('F-SET-002 une réclamation reçue après la remise suspend le règlement (SETTLEMENT_BLOCKED)', async () => {
    await settings();
    await admin.query(
      `INSERT INTO disputes.complaint (id, reference, customer_id, agreement_id, channel, received_at)
       VALUES ($1, 'R-0000000001', $2, $3, 'APP', now())`,
      [uuidv7(), CUSTOMER_ID, AGREEMENT_ID],
    );
    const result = await failure(() => prepare());
    expect(result.message).toMatch(/SETTLEMENT_BLOCKED/);
  });

  it('D56 la réclamation close ne bloque plus le règlement', async () => {
    await settings();
    const complaintId = uuidv7();
    await admin.query(
      `INSERT INTO disputes.complaint (id, reference, customer_id, agreement_id, channel, received_at)
       VALUES ($1, 'R-0000000002', $2, $3, 'APP', now())`,
      [complaintId, CUSTOMER_ID, AGREEMENT_ID],
    );
    await admin.query(
      `INSERT INTO disputes.complaint_closure (complaint_id, outcome, closed_by, closed_at) VALUES ($1, 'ANSWERED', 'support-1', now())`,
      [complaintId],
    );
    const payout = await prepare();
    expect(payout.grossXaf).toBeGreaterThan(0n);
  });

  it('un seul règlement par remise (SETTLEMENT_ALREADY_PREPARED)', async () => {
    await settings();
    await prepare();
    const result = await failure(() => prepare());
    expect(result.code).toBe('SETTLEMENT_ALREADY_PREPARED');
  });

  it('les montants fournis par l’appelant sont recalculés par la base', async () => {
    await settings(250);
    await transact('app_rw', (client) =>
      client.query(
        `INSERT INTO settlement.payout
           (id, agreement_id, partner_id, gross_xaf, commission_bps, commission_xaf, net_xaf, prepared_by, prepared_at)
         VALUES ($1, $2, 'merchant-1', 1, 0, 0, 1, 'ops-1', now())`,
        [uuidv7(), AGREEMENT_ID],
      ),
    );
    const row = await admin.query('SELECT gross_xaf::text AS g, commission_xaf::text AS c, net_xaf::text AS n FROM settlement.payout');
    expect(row.rows[0]).toEqual({ g: '155000', c: '3875', n: '151125' });
  });

  it('SEC-AUTHZ-001 un rôle sans PREPARE_SETTLEMENT ne prépare pas (ADMIN_FORBIDDEN)', async () => {
    await settings();
    const result = await failure(() => prepare({ actorId: 'sup-1', roles: ['SUPPORT_N2'], cityIds: ['douala'] }));
    expect(result.code).toBe('ADMIN_FORBIDDEN');
  });

  it('un préparateur d’une autre ville ne prépare pas (ADMIN_SCOPE_DENIED)', async () => {
    await settings();
    const result = await failure(() => prepare({ ...OPS, cityIds: ['yaounde'] }));
    expect(result.code).toBe('ADMIN_SCOPE_DENIED');
  });
});

describe('F-SET-003 décision maker-checker', () => {
  it('approbation par une autre personne : écriture de commission 2200 → 7100', async () => {
    await settings(250);
    const prepared = await prepare();
    const decided = await decide(prepared.payoutId, FIN, 'APPROVED');
    expect(decided.status).toBe('APPROVED');
    const postings = await admin.query(
      `SELECT a.code, p.direction, p.amount_xaf::text AS amount
         FROM ledger.posting p JOIN ledger.account a ON a.id = p.account_id
        WHERE p.entry_id = $1 ORDER BY p.ordinal`,
      [decided.commissionEntryId],
    );
    expect(postings.rows).toEqual([
      { code: '2200', direction: 'D', amount: '3875' },
      { code: '7100', direction: 'C', amount: '3875' },
    ]);
    expect(await partnerBalance()).toBe('151125');
  });

  it('I-7 le préparateur ne peut pas approuver (MAKER_CANNOT_APPROVE)', async () => {
    await settings();
    const prepared = await prepare({ actorId: 'fin-1', roles: ['FINANCE'], cityIds: ['douala'] });
    const result = await failure(() => decide(prepared.payoutId, FIN, 'APPROVED'));
    expect(result.code).toBe('MAKER_CANNOT_APPROVE');
  });

  it('I-7 la base refuse aussi une décision par le préparateur (MAKER_CANNOT_APPROVE)', async () => {
    await settings();
    const prepared = await prepare();
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO settlement.payout_decision (payout_id, decision, decided_by, reason, commission_entry_id, decided_at)
           VALUES ($1, 'REJECTED', 'ops-1', 'refus', NULL, now())`,
          [prepared.payoutId],
        ),
      ),
    );
    expect(result.message).toMatch(/^MAKER_CANNOT_APPROVE/);
  });

  it('OPERATIONS ne peut pas approuver (ADMIN_FORBIDDEN)', async () => {
    await settings();
    const prepared = await prepare(FIN);
    const result = await failure(() => decide(prepared.payoutId, { ...OPS, actorId: 'ops-2' }, 'APPROVED'));
    expect(result.code).toBe('ADMIN_FORBIDDEN');
  });

  it('au-delà du plafond de l’approbateur (ADMIN_AMOUNT_LIMIT)', async () => {
    await settings();
    const prepared = await prepare();
    const result = await failure(() => decide(prepared.payoutId, { ...FIN2, maxAmountXaf: 100_000n }, 'APPROVED'));
    expect(result.code).toBe('ADMIN_AMOUNT_LIMIT');
  });

  it('un refus exige un motif et ne passe aucune écriture', async () => {
    await settings();
    const prepared = await prepare();
    const noReason = await failure(() => decide(prepared.payoutId, FIN, 'REJECTED'));
    expect(noReason.code).toBe('SETTLEMENT_INVALID_REQUEST');
    const rejected = await decide(prepared.payoutId, FIN, 'REJECTED', 'Pièce de remise illisible');
    expect(rejected).toMatchObject({ status: 'REJECTED', commissionEntryId: null });
    expect(await partnerBalance()).toBe('155000');
  });

  it('une seule décision par règlement (SETTLEMENT_ALREADY_DECIDED)', async () => {
    await settings();
    const prepared = await prepare();
    await decide(prepared.payoutId, FIN, 'APPROVED');
    const result = await failure(() => decide(prepared.payoutId, FIN2, 'APPROVED'));
    expect(result.code).toBe('SETTLEMENT_ALREADY_DECIDED');
  });

  it('I-6 la base refuse une approbation sans écriture de commission (SETTLEMENT_INCOMPLETE)', async () => {
    await settings(250);
    const prepared = await prepare();
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO settlement.payout_decision (payout_id, decision, decided_by, reason, commission_entry_id, decided_at)
           VALUES ($1, 'APPROVED', 'fin-1', NULL, NULL, now())`,
          [prepared.payoutId],
        ),
      ),
    );
    expect(result.message).toMatch(/^SETTLEMENT_INCOMPLETE/);
  });

  it('I-8 la base refuse une commission versée ailleurs qu’en produits 7100 (SETTLEMENT_INCOMPLETE)', async () => {
    await settings(250);
    const prepared = await prepare();
    const result = await failure(() =>
      transact('app_rw', async (client) => {
        const owner = await getPartnerLedgerOwner(client, 'merchant-1');
        if (owner === null) {
          throw new Error('identifiant comptable attendu');
        }
        const partnerAccount = await ensurePartnerFundsAccount(client, owner);
        const suspense = await systemAccountId(client, '2900');
        const entry = await appendLedgerEntry(client, {
          id: uuidv7(),
          operationType: 'FEE_CHARGED',
          businessRefs: { payout_id: prepared.payoutId },
          actorId: 'fin-1',
          approvers: [],
          idemScope: 'tests-raw',
          idemKey: uuidv7(),
          postings: [
            { accountId: partnerAccount, direction: 'DEBIT', amount: xaf(prepared.commissionXaf) },
            { accountId: suspense, direction: 'CREDIT', amount: xaf(prepared.commissionXaf) },
          ],
        });
        await client.query(
          `INSERT INTO settlement.payout_decision (payout_id, decision, decided_by, reason, commission_entry_id, decided_at)
           VALUES ($1, 'APPROVED', 'fin-1', NULL, $2, now())`,
          [prepared.payoutId, entry.id],
        );
      }),
    );
    expect(result.message).toMatch(/^SETTLEMENT_INCOMPLETE/);
  });

  it('règlements et décisions sont en ajout seul (SETTLEMENT_APPEND_ONLY)', async () => {
    await settings();
    const prepared = await prepare();
    await decide(prepared.payoutId, FIN, 'APPROVED');
    for (const sql of ['UPDATE settlement.payout SET net_xaf = 1', 'DELETE FROM settlement.payout_decision']) {
      const result = await failure(() => admin.query(sql));
      expect(result.message, sql).toMatch(/^SETTLEMENT_APPEND_ONLY/);
    }
  });
});

describe('F-SET-004 instruction signée et exécution', () => {
  const keys = generateKeyPairSync('ed25519');

  async function approved(): Promise<Payout> {
    await settings(250);
    const prepared = await prepare();
    await decide(prepared.payoutId, FIN, 'APPROVED');
    return prepared;
  }

  async function instruct(
    payoutId: string,
    principal: AdminPrincipal = FIN,
  ): Promise<{ readonly document: PayoutInstructionDocument; readonly signature: Buffer }> {
    return transact('app_rw', (client) =>
      instructPayout(client, { payoutId, principal, cityId: 'douala', signingKey: keys.privateKey, keyId: 'plateforme-test-1' }),
    );
  }

  async function execute(
    payoutId: string,
    outcome: 'EXECUTED' | 'REJECTED',
    principal: AdminPrincipal = FIN2,
  ): Promise<{ readonly entryId: string | null }> {
    return transact('app_rw', (client) =>
      recordPayoutExecution(client, { payoutId, principal, cityId: 'douala', outcome, bankReference: 'ETAB-2026-000123' }),
    );
  }

  it('émet une instruction canonique signée en Ed25519, vérifiable et infalsifiable', async () => {
    const payout = await approved();
    const instruction = await instruct(payout.payoutId);
    expect(instruction.document).toEqual({
      domain: 'payout-instruction-v1',
      payout_id: payout.payoutId,
      partner_id: 'merchant-1',
      net_xaf: '151125',
    });
    expect(verifyPayoutInstruction(keys.publicKey, instruction.document, instruction.signature)).toBe(true);
    expect(
      verifyPayoutInstruction(keys.publicKey, { ...instruction.document, net_xaf: '151126' }, instruction.signature),
    ).toBe(false);
  });

  it('refuse d’instruire un règlement non approuvé (SETTLEMENT_NOT_APPROVED)', async () => {
    await settings();
    const prepared = await prepare();
    const pending = await failure(() => instruct(prepared.payoutId));
    expect(pending.code).toBe('SETTLEMENT_NOT_APPROVED');
    await decide(prepared.payoutId, FIN, 'REJECTED', 'Refus');
    const rejected = await failure(() => instruct(prepared.payoutId));
    expect(rejected.code).toBe('SETTLEMENT_NOT_APPROVED');
  });

  it('une seule instruction par règlement (SETTLEMENT_ALREADY_INSTRUCTED)', async () => {
    const payout = await approved();
    await instruct(payout.payoutId);
    const result = await failure(() => instruct(payout.payoutId));
    expect(result.code).toBe('SETTLEMENT_ALREADY_INSTRUCTED');
  });

  it('la base refuse une instruction dont le montant diffère du net (SETTLEMENT_INSTRUCTION_MISMATCH)', async () => {
    const payout = await approved();
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO settlement.payout_instruction
             (payout_id, document, document_hash, signature, key_id, instructed_by, instructed_at)
           VALUES ($1, $2::jsonb, $3, $4, 'k', 'fin-1', now())`,
          [
            payout.payoutId,
            JSON.stringify({ domain: 'payout-instruction-v1', payout_id: payout.payoutId, partner_id: 'merchant-1', net_xaf: '1' }),
            Buffer.alloc(32, 1),
            Buffer.alloc(64, 2),
          ],
        ),
      ),
    );
    expect(result.message).toMatch(/^SETTLEMENT_INSTRUCTION_MISMATCH/);
  });

  it('exécution confirmée : écriture SETTLEMENT_SENT 2200 → 1100, plus rien n’est dû au marchand', async () => {
    const payout = await approved();
    await instruct(payout.payoutId);
    const done = await execute(payout.payoutId, 'EXECUTED');
    const postings = await admin.query(
      `SELECT a.code, p.direction, p.amount_xaf::text AS amount
         FROM ledger.posting p JOIN ledger.account a ON a.id = p.account_id
        WHERE p.entry_id = $1 ORDER BY p.ordinal`,
      [done.entryId],
    );
    expect(postings.rows).toEqual([
      { code: '2200', direction: 'D', amount: '151125' },
      { code: '1100', direction: 'C', amount: '151125' },
    ]);
    expect(await partnerBalance()).toBe('0');
  });

  it('I-7 l’émetteur de l’instruction ne confirme pas son exécution (MAKER_CANNOT_APPROVE)', async () => {
    const payout = await approved();
    await instruct(payout.payoutId, FIN);
    const result = await failure(() => execute(payout.payoutId, 'EXECUTED', FIN));
    expect(result.code).toBe('MAKER_CANNOT_APPROVE');
  });

  it('exécution refusée par l’établissement : aucune écriture, le net reste dû', async () => {
    const payout = await approved();
    await instruct(payout.payoutId);
    const done = await execute(payout.payoutId, 'REJECTED');
    expect(done.entryId).toBeNull();
    expect(await partnerBalance()).toBe('151125');
  });

  it('une seule exécution par instruction (SETTLEMENT_ALREADY_EXECUTED)', async () => {
    const payout = await approved();
    await instruct(payout.payoutId);
    await execute(payout.payoutId, 'EXECUTED');
    const result = await failure(() => execute(payout.payoutId, 'EXECUTED', { ...FIN2, actorId: 'fin-3' }));
    expect(result.code).toBe('SETTLEMENT_ALREADY_EXECUTED');
  });

  it('I-6 la base refuse une exécution confirmée sans écriture (SETTLEMENT_INCOMPLETE)', async () => {
    const payout = await approved();
    await instruct(payout.payoutId);
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO settlement.payout_execution
             (payout_id, outcome, bank_reference, entry_id, recorded_by, recorded_at)
           VALUES ($1, 'EXECUTED', 'ETAB-1', NULL, 'fin-2', now())`,
          [payout.payoutId],
        ),
      ),
    );
    expect(result.message).toMatch(/^SETTLEMENT_INCOMPLETE/);
  });

  it('F-SET-004 une instruction non confirmée sous 24 h est signalée', async () => {
    const payout = await approved();
    await instruct(payout.payoutId);
    const now = await transact('app_ro', (client) => listOverdueInstructions(client, new Date().toISOString()));
    expect(now).toEqual([]);
    const later = await transact('app_ro', (client) =>
      listOverdueInstructions(client, new Date(Date.now() + 24 * 3_600_000 + 60_000).toISOString()),
    );
    expect(later.map((item) => item.payoutId)).toEqual([payout.payoutId]);
  });

  function rawInstruction(payoutId: string, net: string): Promise<unknown> {
    return transact('app_rw', (client) =>
      client.query(
        `INSERT INTO settlement.payout_instruction
           (payout_id, document, document_hash, signature, key_id, instructed_by, instructed_at)
         VALUES ($1, $2::jsonb, $3, $4, 'k', 'fin-1', now())`,
        [
          payoutId,
          JSON.stringify({ domain: 'payout-instruction-v1', payout_id: payoutId, partner_id: 'merchant-1', net_xaf: net }),
          Buffer.alloc(32, 1),
          Buffer.alloc(64, 2),
        ],
      ),
    );
  }

  it('la base refuse une instruction sur un règlement non approuvé (SETTLEMENT_NOT_APPROVED)', async () => {
    await settings(250);
    const prepared = await prepare();
    const result = await failure(() => rawInstruction(prepared.payoutId, prepared.netXaf.toString()));
    expect(result.message).toMatch(/^SETTLEMENT_NOT_APPROVED/);
  });

  async function rawExecution(payoutId: string, recordedBy: string, credit: '1100' | '2900', net: bigint): Promise<void> {
    await transact('app_rw', async (client) => {
      const owner = await getPartnerLedgerOwner(client, 'merchant-1');
      if (owner === null) {
        throw new Error('identifiant comptable attendu');
      }
      const partnerAccount = await ensurePartnerFundsAccount(client, owner);
      const target = await systemAccountId(client, credit);
      const entry = await appendLedgerEntry(client, {
        id: uuidv7(),
        operationType: 'SETTLEMENT_SENT',
        businessRefs: { payout_id: payoutId },
        actorId: recordedBy,
        approvers: [],
        idemScope: 'tests-raw',
        idemKey: uuidv7(),
        postings: [
          { accountId: partnerAccount, direction: 'DEBIT', amount: xaf(net) },
          { accountId: target, direction: 'CREDIT', amount: xaf(net) },
        ],
      });
      await client.query(
        `INSERT INTO settlement.payout_execution (payout_id, outcome, bank_reference, entry_id, recorded_by, recorded_at)
         VALUES ($1, 'EXECUTED', 'ETAB-1', $2, $3, now())`,
        [payoutId, entry.id, recordedBy],
      );
    });
  }

  it('I-7 la base refuse une exécution confirmée par l’émetteur (MAKER_CANNOT_APPROVE)', async () => {
    const payout = await approved();
    await instruct(payout.payoutId, FIN);
    const result = await failure(() => rawExecution(payout.payoutId, 'fin-1', '1100', payout.netXaf));
    expect(result.message).toMatch(/^MAKER_CANNOT_APPROVE/);
  });

  it('I-8 la base refuse une sortie qui ne débite pas le compte cantonné 1100 (SETTLEMENT_INCOMPLETE)', async () => {
    const payout = await approved();
    await instruct(payout.payoutId, FIN);
    const result = await failure(() => rawExecution(payout.payoutId, 'fin-2', '2900', payout.netXaf));
    expect(result.message).toMatch(/^SETTLEMENT_INCOMPLETE/);
  });

  it('le chemin direct conforme est accepté par la base (contrôle positif)', async () => {
    const payout = await approved();
    await instruct(payout.payoutId, FIN);
    await rawExecution(payout.payoutId, 'fin-2', '1100', payout.netXaf);
    expect(await partnerBalance()).toBe('0');
  });

  it('instructions et exécutions sont en ajout seul (SETTLEMENT_APPEND_ONLY)', async () => {
    const payout = await approved();
    await instruct(payout.payoutId);
    await execute(payout.payoutId, 'EXECUTED');
    for (const sql of ['UPDATE settlement.payout_instruction SET key_id = \'x\'', 'DELETE FROM settlement.payout_execution']) {
      const result = await failure(() => admin.query(sql));
      expect(result.message, sql).toMatch(/^SETTLEMENT_APPEND_ONLY/);
    }
  });
});
