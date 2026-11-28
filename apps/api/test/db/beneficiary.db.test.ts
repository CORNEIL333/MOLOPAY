import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { xaf } from '@achat/money';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import { getPartnerLedgerOwner } from '../../src/modules/catalog/partner-ledger.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendLedgerEntry, ensureClientFundsAccount, ensurePartnerFundsAccount } from '../../src/modules/ledger/entry.store';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import {
  approveDocumentReview,
  payBeneficiaryForCustomer,
  proposeDocumentReview,
  submitBeneficiaryDocument,
} from '../../src/workflows/beneficiary-payment';
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
  'db/migrations/0043_settlement_beneficiary.sql',
  'db/migrations/0044_agreements_beneficiary_payment.sql',
].map((path) => resolve(process.cwd(), path));

const CUSTOMER_ID = '019a9b00-0000-7000-8000-0000000000c1';
const OTHER_CUSTOMER = '019a9b00-0000-7000-8000-0000000000c2';
const RENT = '019a9b00-0000-7000-8000-0000000000a1';
const SCHOOL = '019a9b00-0000-7000-8000-0000000000a2';
const LEASE_HASH = createHash('sha256').update('bail signé — fichier de test').digest('hex');
const COMP1: AdminPrincipal = { actorId: 'comp-1', roles: ['COMPLIANCE'] };
const COMP2: AdminPrincipal = { actorId: 'comp-2', roles: ['COMPLIANCE'] };

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

async function fund(agreementId: string): Promise<void> {
  const attemptId = uuidv7();
  await transact('app_rw', async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId, channel: 'ORANGE_MONEY', amountXaf: 300_000n, idemKey: uuidv7() });
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
}

async function status(agreementId: string): Promise<string | undefined> {
  const result = await admin.query<{ status: string }>('SELECT status FROM agreements.agreement_state WHERE id = $1', [agreementId]);
  return result.rows[0]?.status;
}

async function submit(kind: 'LEASE' | 'LAND_TITLE' = 'LEASE', customerId = CUSTOMER_ID, agreementId = RENT): Promise<string> {
  const id = uuidv7();
  await transact('app_rw', (client) =>
    submitBeneficiaryDocument(client, { id, agreementId, customerId, kind, sha256Hex: LEASE_HASH }),
  );
  return id;
}

async function validate(documentId: string): Promise<void> {
  await transact('app_rw', (client) => proposeDocumentReview(client, { documentId, principal: COMP1, decision: 'APPROVED' }));
  await transact('app_rw', (client) => approveDocumentReview(client, { documentId, principal: COMP2 }));
}

async function pay(agreementId = RENT): Promise<{ readonly entryId: string }> {
  return transact('app_rw', (client) => payBeneficiaryForCustomer(client, { agreementId, customerId: CUSTOMER_ID }));
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
    await validateBeneficiary(client, uuidv7(), 'landlord-1', 'LANDLORD');
    await validateBeneficiary(client, uuidv7(), 'school-1', 'SCHOOL');
    await seedPaymentPlan(client, PLAN_C);
    await createAgreementC(client, { id: RENT, customerId: CUSTOMER_ID, active: true });
    await createAgreementC(client, { id: SCHOOL, customerId: CUSTOMER_ID, active: true, beneficiaryId: 'school-1' });
  });
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER_ID, 'STRONG');
  await seedCustomerAccount(admin, OTHER_CUSTOMER, 'STRONG');
  await publishKycLimits(admin, {
    BASIC: { holdingXaf: 200_000n, monthlyXaf: 500_000n },
    STRONG: { holdingXaf: 2_000_000n, monthlyXaf: 2_000_000n },
  });
});

describe('F-PLN-002 pièce du bénéficiaire, vérifiée par la conformité en maker-checker', () => {
  it('loyer sans bail validé : règlement bloqué (SETTLEMENT_DOCUMENT_REQUIRED)', async () => {
    await fund(RENT);
    const result = await failure(() => pay());
    expect(result.code).toBe('SETTLEMENT_DOCUMENT_REQUIRED');
    expect(await status(RENT)).toBe('FUNDED');
  });

  it('bail proposé mais pas encore confirmé par une seconde personne : toujours bloqué', async () => {
    await fund(RENT);
    const doc = await submit();
    await transact('app_rw', (client) => proposeDocumentReview(client, { documentId: doc, principal: COMP1, decision: 'APPROVED' }));
    expect((await failure(() => pay())).code).toBe('SETTLEMENT_DOCUMENT_REQUIRED');
  });

  it('I-7 la même personne ne peut pas proposer et confirmer (MAKER_CANNOT_APPROVE)', async () => {
    const doc = await submit();
    await transact('app_rw', (client) => proposeDocumentReview(client, { documentId: doc, principal: COMP1, decision: 'APPROVED' }));
    const result = await failure(() => transact('app_rw', (client) => approveDocumentReview(client, { documentId: doc, principal: COMP1 })));
    expect(result.code).toBe('MAKER_CANNOT_APPROVE');
  });

  it('I-7 la base refuse aussi une confirmation par l’auteur de la proposition', async () => {
    const doc = await submit();
    await transact('app_rw', (client) => proposeDocumentReview(client, { documentId: doc, principal: COMP1, decision: 'APPROVED' }));
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO settlement.document_review_approval (document_id, approved_by, approved_at) VALUES ($1, 'comp-1', now())`,
          [doc],
        ),
      ),
    );
    expect(result.message).toMatch(/^MAKER_CANNOT_APPROVE/);
  });

  it('un refus confirmé laisse le règlement bloqué ; un refus exige un motif', async () => {
    await fund(RENT);
    const doc = await submit();
    const noReason = await failure(() =>
      transact('app_rw', (client) => proposeDocumentReview(client, { documentId: doc, principal: COMP1, decision: 'REJECTED' })),
    );
    expect(noReason.code).toBe('SETTLEMENT_INVALID_REQUEST');
    await transact('app_rw', (client) =>
      proposeDocumentReview(client, { documentId: doc, principal: COMP1, decision: 'REJECTED', reason: 'Bail illisible' }),
    );
    await transact('app_rw', (client) => approveDocumentReview(client, { documentId: doc, principal: COMP2 }));
    expect((await failure(() => pay())).code).toBe('SETTLEMENT_DOCUMENT_REQUIRED');
  });

  it('SEC-AUTHZ-001 seule la conformité examine une pièce (ADMIN_FORBIDDEN)', async () => {
    const doc = await submit();
    const result = await failure(() =>
      transact('app_rw', (client) =>
        proposeDocumentReview(client, { documentId: doc, principal: { actorId: 'sup-1', roles: ['SUPPORT_N2'] }, decision: 'APPROVED' }),
      ),
    );
    expect(result.code).toBe('ADMIN_FORBIDDEN');
  });

  it('refuse une pièce d’un autre type que celui exigé (titre foncier pour un loyer)', async () => {
    const result = await failure(() => submit('LAND_TITLE'));
    expect(result.message).toMatch(/SETTLEMENT_INVALID_REQUEST/);
  });

  it('refuse une pièce déposée pour l’accord d’un autre client', async () => {
    const result = await failure(() => submit('LEASE', OTHER_CUSTOMER));
    expect(result.message).toMatch(/SETTLEMENT_INVALID_REQUEST/);
  });
});

describe('F-PLN-003 règlement au bénéficiaire demandé par le client', () => {
  it('avec bail validé : écriture 2100 → 2200 du bénéficiaire et accord PAID_TO_BENEFICIARY', async () => {
    await fund(RENT);
    await validate(await submit());
    const paid = await pay();
    expect(await status(RENT)).toBe('PAID_TO_BENEFICIARY');
    const postings = await admin.query(
      `SELECT a.code, a.owner_type, p.direction, p.amount_xaf::text AS amount
         FROM ledger.posting p JOIN ledger.account a ON a.id = p.account_id
        WHERE p.entry_id = $1 ORDER BY p.ordinal`,
      [paid.entryId],
    );
    expect(postings.rows).toEqual([
      { code: '2100', owner_type: 'CLIENT', direction: 'D', amount: '300000' },
      { code: '2200', owner_type: 'PARTNER', direction: 'C', amount: '300000' },
    ]);
  });

  it('école : aucune pièce exigée par F-PLN-002, règlement possible', async () => {
    await fund(SCHOOL);
    await pay(SCHOOL);
    expect(await status(SCHOOL)).toBe('PAID_TO_BENEFICIARY');
  });

  it('refuse avant 100 % (SETTLEMENT_NOT_FUNDED)', async () => {
    const result = await failure(() => pay(SCHOOL));
    expect(result.code).toBe('SETTLEMENT_NOT_FUNDED');
  });

  it('un second règlement est impossible', async () => {
    await fund(SCHOOL);
    await pay(SCHOOL);
    const result = await failure(() => pay(SCHOOL));
    expect(result.code).toBe('SETTLEMENT_NOT_FUNDED');
  });

  it('un autre client ne peut pas déclencher le règlement (AGREEMENT_NOT_FOUND)', async () => {
    await fund(SCHOOL);
    const result = await failure(() =>
      transact('app_rw', (client) => payBeneficiaryForCustomer(client, { agreementId: SCHOOL, customerId: OTHER_CUSTOMER })),
    );
    expect(result.code).toBe('AGREEMENT_NOT_FOUND');
  });
});

describe('I-6 / F-PLN-002 imposés par la base', () => {
  it('la base refuse PAID_TO_BENEFICIARY sans écriture (AGREEMENT_LEDGER_LINK_REQUIRED)', async () => {
    await fund(SCHOOL);
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO agreements.status_event
             (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
           VALUES ($1, 3, 'TRANSITION', 'FUNDED', 'PAID_TO_BENEFICIARY', NULL, NULL, 'client-1', now())`,
          [SCHOOL],
        ),
      ),
    );
    expect(result.message).toMatch(/^AGREEMENT_LEDGER_LINK_REQUIRED/);
  });

  async function rawPayment(agreementId: string, transition: boolean): Promise<void> {
    await transact('app_rw', async (client) => {
      const beneficiary = agreementId === RENT ? 'landlord-1' : 'school-1';
      const owner = await getPartnerLedgerOwner(client, beneficiary);
      if (owner === null) {
        throw new Error('identifiant comptable attendu');
      }
      const entry = await appendLedgerEntry(client, {
        id: uuidv7(),
        operationType: 'BENEFICIARY_PAYMENT',
        businessRefs: { agreement_id: agreementId },
        actorId: CUSTOMER_ID,
        approvers: [],
        idemScope: 'tests-raw',
        idemKey: uuidv7(),
        postings: [
          { accountId: await ensureClientFundsAccount(client, CUSTOMER_ID), direction: 'DEBIT', amount: xaf(300_000n) },
          { accountId: await ensurePartnerFundsAccount(client, owner), direction: 'CREDIT', amount: xaf(300_000n) },
        ],
      });
      await client.query(
        `INSERT INTO settlement.beneficiary_payment (agreement_id, beneficiary_id, requested_by, entry_id, paid_at)
         VALUES ($1, $2, $3, $4, now())`,
        [agreementId, beneficiary, CUSTOMER_ID, entry.id],
      );
      if (transition) {
        await client.query(
          `INSERT INTO agreements.status_event
             (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
           VALUES ($1, 3, 'TRANSITION', 'FUNDED', 'PAID_TO_BENEFICIARY', NULL, NULL, $2, now())`,
          [agreementId, CUSTOMER_ID],
        );
      }
    });
  }

  it('la base refuse un règlement sans bail validé, même sans le store (SETTLEMENT_DOCUMENT_REQUIRED)', async () => {
    await fund(RENT);
    const result = await failure(() => rawPayment(RENT, true));
    expect(result.message).toMatch(/^SETTLEMENT_DOCUMENT_REQUIRED/);
  });

  it('la base refuse un règlement sans passage à PAID_TO_BENEFICIARY (SETTLEMENT_INCOMPLETE)', async () => {
    await fund(SCHOOL);
    const result = await failure(() => rawPayment(SCHOOL, false));
    expect(result.message).toMatch(/^SETTLEMENT_INCOMPLETE/);
  });

  it('le chemin direct conforme est accepté (contrôle positif)', async () => {
    await fund(SCHOOL);
    await rawPayment(SCHOOL, true);
    expect(await status(SCHOOL)).toBe('PAID_TO_BENEFICIARY');
  });

  it('pièces, examens et règlements sont en ajout seul (SETTLEMENT_APPEND_ONLY)', async () => {
    await fund(RENT);
    const doc = await submit();
    await validate(doc);
    await pay();
    for (const sql of [
      'DELETE FROM settlement.beneficiary_document',
      "UPDATE settlement.document_review SET decision = 'REJECTED'",
      'DELETE FROM settlement.document_review_approval',
      'DELETE FROM settlement.beneficiary_payment',
    ]) {
      const result = await failure(() => admin.query(sql));
      expect(result.message, sql).toMatch(/^SETTLEMENT_APPEND_ONLY/);
    }
  });
});
