import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { xaf } from '@achat/money';
import { getPartnerLedgerOwner } from '../../src/modules/catalog/partner-ledger.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import {
  appendLedgerEntry,
  ensureClientFundsAccount,
  ensurePartnerFundsAccount,
} from '../../src/modules/ledger/entry.store';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { handoverCodeMac } from '../../src/modules/settlement/handover-code';
import { issueHandoverCode } from '../../src/modules/settlement/handover.store';
import { confirmHandoverAtPartner } from '../../src/workflows/handover';
import { issueHandoverCodeAndNotify } from '../../src/workflows/handover-code';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
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
import { listHandoversSince } from '../../src/modules/settlement/risk-facts.store';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  ...AGREEMENT_STACK_MIGRATIONS,
  'db/migrations/0038_partner_ledger_identity.sql',
  'db/migrations/0039_agreements_handover.sql',
  'db/migrations/0040_settlement_handover.sql',
].map((path) => resolve(process.cwd(), path));

const CUSTOMER_ID = '019a9800-0000-7000-8000-0000000000c1';
const AGREEMENT_ID = '019a9800-0000-7000-8000-0000000000a1';
const OFFER_ID = '019a9800-0000-7000-8000-0000000000f1';
const PRICE = 150_000n;
const PEPPER = randomBytes(32);
const SHOP = { latitude: '4.051056', longitude: '9.767869' };

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

async function status(): Promise<string | undefined> {
  const result = await admin.query<{ status: string }>(
    'SELECT status FROM agreements.agreement_state WHERE id = $1',
    [AGREEMENT_ID],
  );
  return result.rows[0]?.status;
}

/** Verse 100 % du prix par le flux réel de confirmation : l'accord passe FUNDED. */
async function fund(): Promise<void> {
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
}

async function issue(): Promise<{ code: string; expiresAt: string }> {
  return transact('app_rw', (client) =>
    issueHandoverCode(client, { agreementId: AGREEMENT_ID, pepper: PEPPER, actorId: 'system-handover' }),
  );
}

async function handover(
  code: string,
  partnerId = 'merchant-1',
): Promise<{ readonly agreementId: string; readonly entryId: string }> {
  return transact('app_rw', (client) =>
    confirmHandoverAtPartner(client, {
      code,
      partnerId,
      partnerUserId: 'vendeur-1',
      ...SHOP,
      pepper: PEPPER,
    }),
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
    await validateMerchant(client, uuidv7());
    await validateMerchant(client, uuidv7(), 'merchant-2');
    await seedPaymentPlan(client, PLAN_A);
    await publishOfferA(client, { offerId: OFFER_ID, partnerId: 'merchant-1', priceXaf: PRICE });
    await createAgreementA(client, { id: AGREEMENT_ID, customerId: CUSTOMER_ID, offerId: OFFER_ID });
  });
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER_ID, 'STRONG');
  await publishKycLimits(admin);
  await publishSetting(admin, 'handover_code_validity_days', 30);
});

describe('F-SAV-004 émission du code de remise', () => {
  it('à 100 %, émet un code valable 30 jours ; seule son empreinte est conservée', async () => {
    await fund();
    const issued = await issue();
    expect(issued.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    const row = await admin.query<{ code_mac: Buffer; days: number }>(
      `SELECT code_mac, extract(day FROM expires_at - issued_at)::int AS days FROM settlement.handover_code`,
    );
    expect(row.rows[0]?.days).toBe(30);
    expect(row.rows[0]?.code_mac.equals(handoverCodeMac(PEPPER, issued.code))).toBe(true);
    const leaked = await admin.query(
      `SELECT count(*)::int AS n FROM settlement.handover_code WHERE encode(code_mac, 'escape') LIKE '%' || $1 || '%'`,
      [issued.code],
    );
    expect(leaked.rows[0]).toEqual({ n: 0 });
  });

  it('refuse d’émettre un code avant 100 % (HANDOVER_NOT_ALLOWED)', async () => {
    const result = await failure(() => issue());
    expect(result.message).toMatch(/HANDOVER_NOT_ALLOWED/);
  });

  it('fermé par défaut : sans durée de validité publiée, aucun code (HANDOVER_SETTINGS_NOT_CONFIGURED)', async () => {
    // L'historique des paramètres est en ajout seul : on reconstruit la base sans ce paramètre.
    for (const schema of ['settlement', ...AGREEMENT_STACK_SCHEMAS]) {
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
    await fund();
    const result = await failure(() => issue());
    expect(result.message).toMatch(/HANDOVER_SETTINGS_NOT_CONFIGURED/);
  });

  it('refuse un second code tant que le premier est valide (HANDOVER_CODE_ACTIVE)', async () => {
    await fund();
    await issue();
    const result = await failure(() => issue());
    expect(result.message).toMatch(/HANDOVER_CODE_ACTIVE/);
  });
});

describe('F-SET-001 remise prouvée par le code', () => {
  it('CDC_04 § 2.2 remise : débit 2100 du client, crédit 2200 du marchand, accord HANDED_OVER', async () => {
    await fund();
    const { code } = await issue();
    const done = await handover(code);
    expect(done.agreementId).toBe(AGREEMENT_ID);
    expect(await status()).toBe('HANDED_OVER');
    const postings = await admin.query(
      `SELECT a.code, a.owner_type, p.direction, p.amount_xaf::text AS amount
         FROM ledger.posting p JOIN ledger.account a ON a.id = p.account_id
        WHERE p.entry_id = $1 ORDER BY p.ordinal`,
      [done.entryId],
    );
    expect(postings.rows).toEqual([
      { code: '2100', owner_type: 'CLIENT', direction: 'D', amount: '150000' },
      { code: '2200', owner_type: 'PARTNER', direction: 'C', amount: '150000' },
    ]);
    const trace = await admin.query(
      `SELECT partner_id, partner_user_id, latitude::text, longitude::text, used_at IS NOT NULL AS used
         FROM settlement.handover`,
    );
    expect(trace.rows).toEqual([
      { partner_id: 'merchant-1', partner_user_id: 'vendeur-1', latitude: '4.051056', longitude: '9.767869', used: true },
    ]);
  });

  it('accepte la saisie tolérante du vendeur (minuscules, tiret)', async () => {
    await fund();
    const { code } = await issue();
    await handover(`${code.slice(0, 5).toLowerCase()}-${code.slice(5)}`);
    expect(await status()).toBe('HANDED_OVER');
  });

  it('un code déjà utilisé est refusé (HANDOVER_CODE_USED)', async () => {
    await fund();
    const { code } = await issue();
    await handover(code);
    const result = await failure(() => handover(code));
    expect(result.code).toBe('HANDOVER_CODE_USED');
  });

  it('un code inconnu est refusé, rien n’est écrit (HANDOVER_CODE_INVALID)', async () => {
    await fund();
    await issue();
    const result = await failure(() => handover('ABCDE12345'));
    expect(result.code).toBe('HANDOVER_CODE_INVALID');
    expect(await status()).toBe('FUNDED');
  });

  it('un autre marchand ne peut pas utiliser le code (même réponse que code inconnu)', async () => {
    await fund();
    const { code } = await issue();
    const result = await failure(() => handover(code, 'merchant-2'));
    expect(result.code).toBe('HANDOVER_CODE_INVALID');
    expect(await status()).toBe('FUNDED');
  });

  it('un code expiré est refusé (HANDOVER_CODE_EXPIRED)', async () => {
    await fund();
    const { code } = await issue();
    // Seul moyen de faire vieillir un code sans attendre 30 jours : l'administrateur
    // de test recule son échéance en désactivant temporairement la garde d'ajout seul.
    await admin.query('ALTER TABLE settlement.handover_code DISABLE TRIGGER handover_code_no_update_delete');
    await admin.query(
      "UPDATE settlement.handover_code SET issued_at = now() - interval '31 days', expires_at = now() - interval '1 second'",
    );
    await admin.query('ALTER TABLE settlement.handover_code ENABLE ALWAYS TRIGGER handover_code_no_update_delete');
    const result = await failure(() => handover(code));
    expect(result.code).toBe('HANDOVER_CODE_EXPIRED');
  });

  it('refuse des coordonnées hors bornes (SETTLEMENT_INVALID_REQUEST)', async () => {
    await fund();
    const { code } = await issue();
    const result = await failure(() =>
      transact('app_rw', (client) =>
        confirmHandoverAtPartner(client, {
          code,
          partnerId: 'merchant-1',
          partnerUserId: 'vendeur-1',
          latitude: '91',
          longitude: '9.767869',
          pepper: PEPPER,
        }),
      ),
    );
    expect(result.code).toBe('SETTLEMENT_INVALID_REQUEST');
  });
});

describe('I-6 remise imposée par la base', () => {
  it('la base refuse HANDED_OVER sans écriture de remise (AGREEMENT_LEDGER_LINK_REQUIRED)', async () => {
    await fund();
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO agreements.status_event
             (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
           VALUES ($1, 3, 'TRANSITION', 'FUNDED', 'HANDED_OVER', NULL, NULL, 'vendeur-1', now())`,
          [AGREEMENT_ID],
        ),
      ),
    );
    expect(result.message).toMatch(/^AGREEMENT_LEDGER_LINK_REQUIRED/);
  });

  it('la base refuse une remise sans passage de l’accord à HANDED_OVER (HANDOVER_INCOMPLETE)', async () => {
    await fund();
    const { code } = await issue();
    const result = await failure(() =>
      transact('app_rw', async (client) => {
        const owner = await getPartnerLedgerOwner(client, 'merchant-1');
        if (owner === null) {
          throw new Error('identifiant comptable attendu');
        }
        const partnerAccount = await ensurePartnerFundsAccount(client, owner);
        const clientAccount = await ensureClientFundsAccount(client, CUSTOMER_ID);
        const entry = await appendLedgerEntry(client, {
          id: uuidv7(),
          operationType: 'HANDOVER',
          businessRefs: { agreement_id: AGREEMENT_ID },
          actorId: 'vendeur-1',
          approvers: [],
          idemScope: 'tests-raw',
          idemKey: uuidv7(),
          postings: [
            { accountId: clientAccount, direction: 'DEBIT', amount: xaf(PRICE) },
            { accountId: partnerAccount, direction: 'CREDIT', amount: xaf(PRICE) },
          ],
        });
        await client.query(
          `INSERT INTO settlement.handover
             (agreement_id, code_seq, partner_id, partner_user_id, latitude, longitude, entry_id, used_at)
           SELECT agreement_id, seq, 'merchant-1', 'vendeur-1', 4.05, 9.76, $2, now()
             FROM settlement.handover_code WHERE code_mac = $1`,
          [handoverCodeMac(PEPPER, code), entry.id],
        );
      }),
    );
    expect(result.message).toMatch(/^HANDOVER_INCOMPLETE/);
    expect(await status()).toBe('FUNDED');
  });

  /** Remise posée directement en base, sans le store : atteint les règles SQL seules. */
  async function rawHandover(code: string, options: { rowPartner: string; creditedPartner: string }): Promise<void> {
    await transact('app_rw', async (client) => {
      const owner = await getPartnerLedgerOwner(client, options.creditedPartner);
      if (owner === null) {
        throw new Error('identifiant comptable attendu');
      }
      const partnerAccount = await ensurePartnerFundsAccount(client, owner);
      const clientAccount = await ensureClientFundsAccount(client, CUSTOMER_ID);
      const entry = await appendLedgerEntry(client, {
        id: uuidv7(),
        operationType: 'HANDOVER',
        businessRefs: { agreement_id: AGREEMENT_ID },
        actorId: 'vendeur-1',
        approvers: [],
        idemScope: 'tests-raw',
        idemKey: uuidv7(),
        postings: [
          { accountId: clientAccount, direction: 'DEBIT', amount: xaf(PRICE) },
          { accountId: partnerAccount, direction: 'CREDIT', amount: xaf(PRICE) },
        ],
      });
      await client.query(
        `INSERT INTO settlement.handover
           (agreement_id, code_seq, partner_id, partner_user_id, latitude, longitude, entry_id, used_at)
         SELECT agreement_id, seq, $3, 'vendeur-1', 4.05, 9.76, $2, now()
           FROM settlement.handover_code WHERE code_mac = $1`,
        [handoverCodeMac(PEPPER, code), entry.id, options.rowPartner],
      );
      await client.query(
        `INSERT INTO agreements.status_event
           (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
         VALUES ($1, 3, 'TRANSITION', 'FUNDED', 'HANDED_OVER', NULL, NULL, 'vendeur-1', now())`,
        [AGREEMENT_ID],
      );
    });
  }

  it('la base refuse un code expiré, même sans le store (HANDOVER_CODE_EXPIRED)', async () => {
    await fund();
    const { code } = await issue();
    await admin.query('ALTER TABLE settlement.handover_code DISABLE TRIGGER handover_code_no_update_delete');
    await admin.query(
      "UPDATE settlement.handover_code SET issued_at = now() - interval '31 days', expires_at = now() - interval '1 second'",
    );
    await admin.query('ALTER TABLE settlement.handover_code ENABLE ALWAYS TRIGGER handover_code_no_update_delete');
    const result = await failure(() => rawHandover(code, { rowPartner: 'merchant-1', creditedPartner: 'merchant-1' }));
    expect(result.message).toMatch(/^HANDOVER_CODE_EXPIRED/);
  });

  it('la base refuse une remise déclarée par un autre marchand (HANDOVER_CODE_INVALID)', async () => {
    await fund();
    const { code } = await issue();
    const result = await failure(() => rawHandover(code, { rowPartner: 'merchant-2', creditedPartner: 'merchant-2' }));
    expect(result.message).toMatch(/^HANDOVER_CODE_INVALID/);
  });

  it('I-8 la base refuse une écriture qui crédite un autre marchand (HANDOVER_INCOMPLETE)', async () => {
    await fund();
    const { code } = await issue();
    const result = await failure(() => rawHandover(code, { rowPartner: 'merchant-1', creditedPartner: 'merchant-2' }));
    expect(result.message).toMatch(/^HANDOVER_INCOMPLETE/);
  });

  it('le chemin direct conforme est accepté par la base (contrôle positif)', async () => {
    await fund();
    const { code } = await issue();
    await rawHandover(code, { rowPartner: 'merchant-1', creditedPartner: 'merchant-1' });
    expect(await status()).toBe('HANDED_OVER');
  });

  it('codes et remises sont en ajout seul (SETTLEMENT_APPEND_ONLY)', async () => {
    await fund();
    const { code } = await issue();
    await handover(code);
    for (const sql of ['DELETE FROM settlement.handover', "UPDATE settlement.handover SET partner_user_id = 'x'", 'DELETE FROM settlement.handover_code']) {
      const result = await failure(() => admin.query(sql));
      expect(result.message, sql).toMatch(/^SETTLEMENT_APPEND_ONLY/);
    }
  });
});

describe('F-SAV-004 / F-NOT-001 code de remise prêt', () => {
  it('HANDOVER_READY est écrit avec le code, sans jamais contenir le code', async () => {
    await fund();
    const issued = await transact('app_rw', (client) =>
      issueHandoverCodeAndNotify(client, { agreementId: AGREEMENT_ID, pepper: PEPPER, actorId: 'system-handover' }),
    );
    const rows = await admin.query<{ event_type: string; channel: string }>(
      `SELECT event_type, channel FROM notifications.outbox
        WHERE recipient_id = $1 AND event_type = 'HANDOVER_READY' ORDER BY channel`,
      [CUSTOMER_ID],
    );
    expect(rows.rows).toEqual([
      { event_type: 'HANDOVER_READY', channel: 'PUSH' },
      { event_type: 'HANDOVER_READY', channel: 'SMS' },
    ]);
    const leak = await admin.query(`SELECT count(*)::int AS n FROM notifications.outbox WHERE row_to_json(outbox)::text LIKE '%' || $1 || '%'`, [issued.code]);
    expect(leak.rows[0]).toEqual({ n: 0 });
  });
});

describe('SEC-FRD-001 / D53 faits de remise pour la détection de fraude', () => {
  it('liste la remise de la boutique depuis l’instant donné, pas avant', async () => {
    await fund();
    const { code } = await issue();
    const before = new Date(Date.now() - 60_000);
    await handover(code);
    const facts = await transact('app_ro', (client) => listHandoversSince(client, before));
    expect(facts.map((fact) => ({ partnerId: fact.partnerId, agreementId: fact.agreementId }))).toEqual([
      { partnerId: 'merchant-1', agreementId: AGREEMENT_ID },
    ]);
    const later = await transact('app_ro', (client) => listHandoversSince(client, new Date(Date.now() + 60_000)));
    expect(later).toEqual([]);
  });
});
