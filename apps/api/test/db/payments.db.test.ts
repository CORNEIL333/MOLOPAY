import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  canonicalize,
  computeEntryHash,
  genesisPrevHash,
  type EntryContent,
  type JsonValue,
} from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPartnerDossier, partnerDossierHash } from '../../src/modules/catalog/partner';
import {
  appendPartnerDossier,
  recordPartnerValidation,
} from '../../src/modules/catalog/partner.store';
import {
  appendAttemptTransition,
  createStoredPaymentAttempt,
  getPaymentAttempt,
  recordWebhookReceipt,
} from '../../src/modules/payments/attempt.store';
import { createPlannedExpenseAgreement } from '../../src/modules/agreements/agreement.store';
import { confirmPaymentAttempt } from '../../src/modules/payments/confirmation.store';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import type { ProviderTransaction } from '../../src/modules/payments/provider';
import { xaf } from '@achat/money';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendLedgerEntry, ensureClientFundsAccount } from '../../src/modules/ledger/entry.store';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  'db/migrations/0001_ledger.sql',
  'db/migrations/0002_audit.sql',
  'db/migrations/0005_audit_metadata.sql',
  'db/migrations/0010_audit_catalog.sql',
  'db/migrations/0003_admin.sql',
  'db/migrations/0006_admin_clock.sql',
  'db/migrations/0008_catalog_partner.sql',
  'db/migrations/0009_catalog_offer.sql',
  'db/migrations/0011_agreements.sql',
  'db/migrations/0012_agreements_customer_signature.sql',
  'db/migrations/0013_partner_type_beneficiary.sql',
  'db/migrations/0014_partner_incident.sql',
  'db/migrations/0015_partner_default_lift.sql',
  'db/migrations/0026_payments_attempts.sql',
  'db/migrations/0027_payments_confirmation.sql',
  'db/migrations/0028_payments_entry_agreement.sql',
  'db/migrations/0029_agreements_funded.sql',
].map((path) => resolve(process.cwd(), path));

const CUSTOMER_ID = '019a9200-0000-7000-8000-0000000000c1';
const DEVICE_ID = '019a9200-0000-7000-8000-0000000000d1';
const AGREEMENT_ID = '019a9200-0000-7000-8000-0000000000a1';
const DRAFT_AGREEMENT_ID = '019a9200-0000-7000-8000-0000000000a2';
const SIGNATURE = Buffer.alloc(64, 9);

let container: TestDatabase;
let admin: Client;
let migrationSql: string[];

function uuid(seq: number): string {
  return `019a9200-0000-7000-8000-${seq.toString().padStart(12, '0')}`;
}

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

/** Bailleur validé par maker-checker (même circuit que les tests du lot 10). */
async function validateBeneficiary(client: Client): Promise<void> {
  const stored = await appendPartnerDossier(
    client,
    createPartnerDossier({
      partnerId: 'landlord-1',
      partnerType: 'BENEFICIARY',
      beneficiaryKind: 'LANDLORD',
      legalName: 'Bailleur de test',
      rccm: 'RC/DLA/2024/B/0001',
      niu: 'M000000000000A',
      representativeDocumentRef: 'kyc-doc-ref-0001',
      settlementAccountRef: 'settlement-ref-0001',
    }),
    'net-1',
  );
  const requestId = uuid(900);
  const payload: Record<string, JsonValue> = {
    partner_id: 'landlord-1',
    dossier_hash: partnerDossierHash(stored.dossier).toString('hex'),
  };
  const payloadHash = createHash('sha256').update(canonicalize(payload), 'utf8').digest();
  await client.query(
    `INSERT INTO admin.approval_request
       (id, kind, maker_id, payload, payload_hash, reason, prepared_at, expires_at)
     VALUES ($1, 'PARTNER_APPROVAL', 'net-1', $2::jsonb, $3, 'Onboarding partenaire',
             now(), now() + interval '1 day')`,
    [requestId, JSON.stringify(payload), payloadHash],
  );
  await client.query(
    `INSERT INTO admin.approval_decision
       (request_id, decision, decided_by, decided_at, decision_reason)
     VALUES ($1, 'APPROVED', 'comp-1', now(), NULL)`,
    [requestId],
  );
  await recordPartnerValidation(client, {
    partnerId: 'landlord-1',
    dossierVersion: stored.version,
    decision: {
      id: requestId,
      kind: 'PARTNER_APPROVAL',
      status: 'APPROVED',
      makerId: 'net-1',
      checkerId: 'comp-1',
      payload,
      payloadHash,
    },
  });
}

/** Accord C créé par le store (empreinte des conditions authentique). */
async function insertAgreementC(client: Client, id: string): Promise<void> {
  await createPlannedExpenseAgreement(client, {
    id,
    customerId: CUSTOMER_ID,
    beneficiaryId: 'landlord-1',
    targetXaf: 300_000n,
    plan: {
      id: 'plan-c',
      model: 'PLANNED_EXPENSE',
      approved: true,
      rhythm: 'MONTHLY',
      minAmountXaf: 10_000n,
      maxDurationDays: 180,
    },
    durationDays: 120,
    createdAt: '2026-11-01T09:00:00.000Z',
  });
}

/** Un accord C ACTIVE (signé) et un accord C resté en DRAFT. */
async function seed(client: Client): Promise<void> {
  await validateBeneficiary(client);
  await insertAgreementC(client, AGREEMENT_ID);
  await client.query(
    `INSERT INTO agreements.status_event
       (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
     VALUES ($1, 1, 'TRANSITION', 'DRAFT', 'ACTIVE', $2, $3, 'client-1', now())`,
    [AGREEMENT_ID, DEVICE_ID, SIGNATURE],
  );
  await insertAgreementC(client, DRAFT_AGREEMENT_ID);
}

type AttemptInput = Parameters<typeof createStoredPaymentAttempt>[1];
type StoredAttempt = Awaited<ReturnType<typeof createStoredPaymentAttempt>>;

function attemptInput(overrides: Partial<AttemptInput> = {}): AttemptInput {
  return {
    id: uuid(1),
    agreementId: AGREEMENT_ID,
    channel: 'MTN_MOMO',
    amountXaf: 10_000n,
    idemKey: uuid(501),
    ...overrides,
  };
}

async function createAttempt(overrides: Partial<AttemptInput> = {}): Promise<StoredAttempt> {
  return transact('app_rw', (client) => createStoredPaymentAttempt(client, attemptInput(overrides)));
}

async function transition(
  attemptId: string,
  from: string,
  to: string,
  seq: number,
): Promise<Awaited<ReturnType<typeof appendAttemptTransition>>> {
  return transact('app_rw', (client) =>
    appendAttemptTransition(client, { attemptId, from, to, seq, actorId: 'payments-worker' }),
  );
}

async function rawEvent(attemptId: string, seq: number, from: string, to: string): Promise<void> {
  await transact('app_rw', (client) =>
    client.query(
      `INSERT INTO payments.attempt_event (attempt_id, seq, from_status, to_status, actor_id, created_at)
       VALUES ($1, $2, $3, $4, 'payments-worker', now())`,
      [attemptId, seq, from, to],
    ),
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
  for (const schema of ['payments', 'agreements', 'catalog', 'admin', 'audit', 'ledger']) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
  await transact('app_rw', seed);
  await seedGenesis();
});

describe('F-PAY-001/002 création d’une tentative en base', () => {
  it('crée une tentative CREATED sur un accord ACTIVE', async () => {
    const created = await createAttempt();
    expect(created.status).toBe('CREATED');
    expect(created.amountXaf).toBe(10_000n);
    expect(created.replayed).toBe(false);
  });

  it('F-PAY-002 un rejeu de la même clé renvoie la tentative originale sans en créer une autre', async () => {
    const first = await createAttempt();
    const again = await createAttempt({ id: uuid(2) });
    expect(again.id).toBe(first.id);
    expect(again.replayed).toBe(true);
    const count = await admin.query('SELECT count(*)::int AS n FROM payments.payment_attempt');
    expect(count.rows[0]).toEqual({ n: 1 });
  });

  it('INT-IDEM-001 refuse la même clé avec un autre montant (IDEMPOTENCY_KEY_REUSED)', async () => {
    await createAttempt();
    const result = await failure(() => createAttempt({ id: uuid(2), amountXaf: 20_000n }));
    expect(result.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('refuse une tentative sur un accord non ACTIVE (PAYMENT_AGREEMENT_NOT_ACTIVE)', async () => {
    const result = await failure(() => createAttempt({ agreementId: DRAFT_AGREEMENT_ID }));
    expect(result.message).toMatch(/^PAYMENT_AGREEMENT_NOT_ACTIVE/);
  });

  it('refuse une tentative sur un accord inexistant (violation de clé étrangère)', async () => {
    const result = await failure(() => createAttempt({ agreementId: uuid(777) }));
    expect(result.code).toBe('23503');
  });

  it('NF-FUN-001 la base refuse un montant nul ou un canal inconnu (23514)', async () => {
    const zero = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO payments.payment_attempt (id, agreement_id, channel, amount_xaf, idem_key, created_at)
           VALUES ($1, $2, 'MTN_MOMO', 0, $3, now())`,
          [uuid(3), AGREEMENT_ID, uuid(503)],
        ),
      ),
    );
    expect(zero.code).toBe('23514');
    const channel = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO payments.payment_attempt (id, agreement_id, channel, amount_xaf, idem_key, created_at)
           VALUES ($1, $2, 'PAYPAL', 1000, $3, now())`,
          [uuid(4), AGREEMENT_ID, uuid(504)],
        ),
      ),
    );
    expect(channel.code).toBe('23514');
  });

  it('horodate la création avec l’horloge serveur, pas celle du client', async () => {
    await transact('app_rw', (client) =>
      client.query(
        `INSERT INTO payments.payment_attempt (id, agreement_id, channel, amount_xaf, idem_key, created_at)
         VALUES ($1, $2, 'CASH', 1000, $3, '2000-01-01T00:00:00Z')`,
        [uuid(5), AGREEMENT_ID, uuid(505)],
      ),
    );
    const row = await admin.query<{ recent: boolean }>(
      `SELECT created_at > now() - interval '1 hour' AS recent FROM payments.payment_attempt WHERE id = $1`,
      [uuid(5)],
    );
    expect(row.rows[0]?.recent).toBe(true);
  });
});

describe('CDC_05 § 5.1 / INT-IDEM-003/005 transitions imposées par la base', () => {
  it('accepte CREATED → PENDING → FAILED et dérive l’état courant', async () => {
    const created = await createAttempt();
    await transition(created.id, 'CREATED', 'PENDING', 1);
    const failed = await transition(created.id, 'PENDING', 'FAILED', 2);
    expect(failed.status).toBe('FAILED');
    const stored = await transact('app_ro', (client) => getPaymentAttempt(client, created.id));
    expect(stored?.status).toBe('FAILED');
  });

  it('accepte PENDING → EXPIRED', async () => {
    const created = await createAttempt();
    await transition(created.id, 'CREATED', 'PENDING', 1);
    expect((await transition(created.id, 'PENDING', 'EXPIRED', 2)).status).toBe('EXPIRED');
  });

  it('I-6 refuse CONFIRMED tant que le lien vers le grand livre n’existe pas (PAYMENT_LEDGER_LINK_REQUIRED)', async () => {
    const created = await createAttempt();
    await transition(created.id, 'CREATED', 'PENDING', 1);
    const result = await failure(() => rawEvent(created.id, 2, 'PENDING', 'CONFIRMED'));
    expect(result.message).toMatch(/^PAYMENT_LEDGER_LINK_REQUIRED/);
  });

  it('INT-IDEM-005 refuse un retour depuis un état terminal (UNAUTHORIZED_TRANSITION)', async () => {
    const created = await createAttempt();
    await transition(created.id, 'CREATED', 'PENDING', 1);
    await transition(created.id, 'PENDING', 'FAILED', 2);
    const result = await failure(() => rawEvent(created.id, 3, 'FAILED', 'PENDING'));
    expect(result.message).toMatch(/^UNAUTHORIZED_TRANSITION/);
  });

  it('refuse une transition non déclarée CREATED → FAILED (UNAUTHORIZED_TRANSITION)', async () => {
    const created = await createAttempt();
    const result = await failure(() => rawEvent(created.id, 1, 'CREATED', 'FAILED'));
    expect(result.message).toMatch(/^UNAUTHORIZED_TRANSITION/);
  });

  it('refuse un état de départ qui n’est pas l’état courant (UNAUTHORIZED_TRANSITION)', async () => {
    const created = await createAttempt();
    await transition(created.id, 'CREATED', 'PENDING', 1);
    const result = await failure(() => rawEvent(created.id, 2, 'CREATED', 'PENDING'));
    expect(result.message).toMatch(/^UNAUTHORIZED_TRANSITION/);
  });

  it('refuse un trou dans la séquence (PAYMENT_INVALID_REQUEST)', async () => {
    const created = await createAttempt();
    const result = await failure(() => rawEvent(created.id, 2, 'CREATED', 'PENDING'));
    expect(result.message).toMatch(/^PAYMENT_INVALID_REQUEST/);
  });

  it('INT-IDEM-005 deux messages concurrents ne produisent qu’un seul état terminal', async () => {
    const created = await createAttempt();
    await transition(created.id, 'CREATED', 'PENDING', 1);
    const results = await Promise.allSettled([
      transition(created.id, 'PENDING', 'FAILED', 2),
      transition(created.id, 'PENDING', 'EXPIRED', 2),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const events = await admin.query('SELECT count(*)::int AS n FROM payments.attempt_event WHERE attempt_id = $1', [
      created.id,
    ]);
    expect(events.rows[0]).toEqual({ n: 2 });
  });

  it('le store refuse une transition interdite avant la base (UNAUTHORIZED_TRANSITION)', async () => {
    const created = await createAttempt();
    const result = await failure(() => transition(created.id, 'CREATED', 'REFUNDED', 1));
    expect(result.code).toBe('UNAUTHORIZED_TRANSITION');
  });
});

describe('I-2 ajout seul', () => {
  it.each([
    ['UPDATE payments.payment_attempt SET amount_xaf = 1'],
    ['DELETE FROM payments.payment_attempt'],
    ['UPDATE payments.attempt_event SET to_status = \'PENDING\''],
    ['DELETE FROM payments.attempt_event'],
    ['DELETE FROM payments.webhook_receipt'],
  ])('refuse « %s » même pour le propriétaire (PAYMENT_APPEND_ONLY)', async (sql) => {
    const created = await createAttempt();
    await transition(created.id, 'CREATED', 'PENDING', 1);
    await transact('app_rw', (client) =>
      recordWebhookReceipt(client, {
        channel: 'MTN_MOMO',
        nonce: 'nonce-append-only-1',
        signedAtMs: Date.now(),
      }),
    );
    const result = await failure(() => admin.query(sql));
    expect(result.message).toMatch(/^PAYMENT_APPEND_ONLY/);
  });

  it('le rôle applicatif n’a ni UPDATE ni DELETE (42501)', async () => {
    await createAttempt();
    const result = await failure(() =>
      transact('app_rw', (client) => client.query('DELETE FROM payments.payment_attempt')),
    );
    expect(result.code).toBe('42501');
  });

  it('le rôle lecture seule ne peut pas créer de tentative (42501)', async () => {
    const result = await failure(() =>
      transact('app_ro', (client) => createStoredPaymentAttempt(client, attemptInput())),
    );
    expect(result.code).toBe('42501');
  });
});

describe('SEC-API-002 anti-rejeu des webhooks', () => {
  it('enregistre un nonce une seule fois puis refuse le rejeu (WEBHOOK_REPLAYED)', async () => {
    const receipt = { channel: 'ORANGE_MONEY', nonce: 'nonce-0001-abcdef', signedAtMs: Date.now() };
    await transact('app_rw', (client) => recordWebhookReceipt(client, receipt));
    const result = await failure(() => transact('app_rw', (client) => recordWebhookReceipt(client, receipt)));
    expect(result.code).toBe('WEBHOOK_REPLAYED');
  });

  it('F-PAY-002 1 000 webhooks dupliqués concurrents ne laissent qu’une réception', async () => {
    const receipt = { channel: 'MTN_MOMO', nonce: 'nonce-dup-0000001', signedAtMs: Date.now() };
    const client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    try {
      await client.query('SET ROLE app_rw');
      let accepted = 0;
      let replayed = 0;
      for (let i = 0; i < 1000; i += 1) {
        try {
          await recordWebhookReceipt(client, receipt);
          accepted += 1;
        } catch (error: unknown) {
          if (error instanceof BusinessError && error.code === 'WEBHOOK_REPLAYED') {
            replayed += 1;
          } else {
            throw error;
          }
        }
      }
      expect({ accepted, replayed }).toEqual({ accepted: 1, replayed: 999 });
    } finally {
      await client.end();
    }
  });

  it('le même nonce sur un autre canal est une autre réception', async () => {
    await transact('app_rw', (client) =>
      recordWebhookReceipt(client, { channel: 'MTN_MOMO', nonce: 'nonce-shared-0001', signedAtMs: Date.now() }),
    );
    await transact('app_rw', (client) =>
      recordWebhookReceipt(client, { channel: 'ORANGE_MONEY', nonce: 'nonce-shared-0001', signedAtMs: Date.now() }),
    );
    const count = await admin.query('SELECT count(*)::int AS n FROM payments.webhook_receipt');
    expect(count.rows[0]).toEqual({ n: 2 });
  });

  it.each([6 * 60_000, -6 * 60_000])(
    'la base refuse un horodatage décalé de %s ms (WEBHOOK_TIMESTAMP_OUT_OF_WINDOW)',
    async (offset) => {
      const result = await failure(() =>
        transact('app_rw', (client) =>
          client.query(
            `INSERT INTO payments.webhook_receipt (channel, nonce, signed_at, received_at)
             VALUES ('CARD', 'nonce-window-0001', $1, now())`,
            [new Date(Date.now() + offset).toISOString()],
          ),
        ),
      );
      expect(result.message).toMatch(/^WEBHOOK_TIMESTAMP_OUT_OF_WINDOW/);
    },
  );

  it('refuse un nonce mal formé (23514)', async () => {
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO payments.webhook_receipt (channel, nonce, signed_at, received_at)
           VALUES ('CARD', 'a b', now(), now())`,
        ),
      ),
    );
    expect(result.code).toBe('23514');
  });
});

// ---------------------------------------------------------------------------
// Tranche 2 : confirmation liée au grand livre (I-6, CDC_04 § 2.2).
// ---------------------------------------------------------------------------

const ACCOUNT_AGGREGATOR = '019a0000-0000-7000-8000-000000001200';

/** Genèse chaînée (INT-HASH-001) posée par l'administrateur de test. */
async function seedGenesis(): Promise<void> {
  const id = uuidv7();
  const ts = '2026-11-01T00:00:00.000Z';
  const content: EntryContent = {
    seq: 1,
    id,
    ts,
    type: 'GENESIS',
    refs: { params_hash: 'parametres-v1-de-test' },
    postings: [],
    actor: 'system',
    approvers: [],
    idemScope: 'system',
    idemKey: 'genesis',
    reversesEntryId: null,
  };
  await admin.query(
    `INSERT INTO ledger.journal_entry
       (seq, id, recorded_at, operation_type, business_refs, actor_id, approvers,
        idem_scope, idem_key, reverses_entry_id, prev_hash, entry_hash)
     VALUES (1, $1, $2, 'GENESIS', $3::jsonb, 'system', '[]'::jsonb, 'system', 'genesis', NULL, $4, $5)`,
    [id, ts, JSON.stringify(content.refs), genesisPrevHash(), computeEntryHash(genesisPrevHash(), content)],
  );
}

async function pendingAttempt(
  overrides: Partial<AttemptInput> = {},
): Promise<StoredAttempt> {
  const created = await createAttempt(overrides);
  await transition(created.id, 'CREATED', 'PENDING', 1);
  return created;
}

function succeeded(attempt: StoredAttempt, overrides: Partial<ProviderTransaction> = {}): ProviderTransaction {
  return {
    providerTxId: `tx-${attempt.id.slice(-12)}`,
    attemptId: attempt.id,
    amountXaf: attempt.amountXaf,
    outcome: 'SUCCEEDED',
    ...overrides,
  };
}

async function confirm(
  attempt: StoredAttempt,
  overrides: Partial<ProviderTransaction> = {},
  customerId = CUSTOMER_ID,
): Promise<Awaited<ReturnType<typeof confirmPaymentAttempt>>> {
  return transact('app_rw', (client) =>
    confirmPaymentAttempt(client, {
      attemptId: attempt.id,
      customerId,
      providerTransaction: succeeded(attempt, overrides),
      actorId: 'payments-worker',
    }),
  );
}

async function counts(): Promise<{ entries: number; contributions: number }> {
  const result = await admin.query<{ entries: number; contributions: number }>(
    `SELECT (SELECT count(*)::int FROM ledger.journal_entry WHERE operation_type = 'PAYMENT_CONFIRMED') AS entries,
            (SELECT count(*)::int FROM payments.contribution) AS contributions`,
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('comptage impossible');
  }
  return row;
}

describe('F-SAV-002 / I-6 confirmation liée au grand livre', () => {
  it('CDC_04 § 2.2 confirme : débit 1200, crédit 2100 du client, état CONFIRMED, même transaction', async () => {
    const attempt = await pendingAttempt();
    const confirmed = await confirm(attempt);
    expect(confirmed.attempt.status).toBe('CONFIRMED');
    expect(confirmed.replayed).toBe(false);
    const postings = await admin.query<{ code: string; owner_id: string | null; direction: string; amount_xaf: string }>(
      `SELECT a.code, a.owner_id, p.direction, p.amount_xaf::text
         FROM ledger.posting p JOIN ledger.account a ON a.id = p.account_id
        WHERE p.entry_id = $1 ORDER BY p.ordinal`,
      [confirmed.entryId],
    );
    expect(postings.rows).toEqual([
      { code: '1200', owner_id: null, direction: 'D', amount_xaf: '10000' },
      { code: '2100', owner_id: CUSTOMER_ID, direction: 'C', amount_xaf: '10000' },
    ]);
    expect(await counts()).toEqual({ entries: 1, contributions: 1 });
  });

  it('I-9 le solde du client est dérivé des écritures', async () => {
    await confirm(await pendingAttempt());
    await confirm(await pendingAttempt({ id: uuid(2), idemKey: uuid(502), amountXaf: 2_500n }));
    const balance = await admin.query<{ credit: string }>(
      `SELECT credit_total_xaf::text AS credit FROM ledger.account_balance
        WHERE code = '2100' AND owner_type = 'CLIENT' AND owner_id = $1`,
      [CUSTOMER_ID],
    );
    expect(balance.rows[0]?.credit).toBe('12500');
  });

  it('I-5 / F-PAY-002 une confirmation rejouée n’a d’effet qu’une fois', async () => {
    const attempt = await pendingAttempt();
    const first = await confirm(attempt);
    const again = await confirm(attempt);
    expect(again).toMatchObject({ entryId: first.entryId, replayed: true });
    expect(await counts()).toEqual({ entries: 1, contributions: 1 });
  });

  it('INT-IDEM-005 deux confirmations concurrentes : une seule écriture', async () => {
    const attempt = await pendingAttempt();
    const results = await Promise.all([confirm(attempt), confirm(attempt), confirm(attempt)]);
    expect(new Set(results.map((r) => r.entryId)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await counts()).toEqual({ entries: 1, contributions: 1 });
  });

  it.each([
    ['un échec chez le prestataire', { outcome: 'FAILED' as const }],
    ['un paiement encore en attente', { outcome: 'PENDING' as const }],
    ['un autre montant', { amountXaf: 9_999n }],
    ['une autre tentative', { attemptId: uuid(99) }],
  ])('F-PAY-003 refuse %s (PAYMENT_CONFIRMATION_UNVERIFIED), rien n’est écrit', async (_label, overrides) => {
    const attempt = await pendingAttempt();
    const result = await failure(() => confirm(attempt, overrides));
    expect(result.code).toBe('PAYMENT_CONFIRMATION_UNVERIFIED');
    expect(await counts()).toEqual({ entries: 0, contributions: 0 });
  });

  it('refuse de confirmer une tentative pas encore PENDING (UNAUTHORIZED_TRANSITION)', async () => {
    const created = await createAttempt();
    const result = await failure(() => confirm(created));
    expect(result.code).toBe('UNAUTHORIZED_TRANSITION');
    expect(await counts()).toEqual({ entries: 0, contributions: 0 });
  });

  it('F-PAY-004 un message d’échec tardif ne fait pas régresser un paiement confirmé (PAYMENT_ALREADY_CONFIRMED)', async () => {
    const attempt = await pendingAttempt();
    await confirm(attempt);
    const store = await failure(() => transition(attempt.id, 'CONFIRMED', 'FAILED', 3));
    expect(store.code).toBe('PAYMENT_ALREADY_CONFIRMED');
    const base = await failure(() => rawEvent(attempt.id, 3, 'CONFIRMED', 'FAILED'));
    expect(base.message).toMatch(/^PAYMENT_ALREADY_CONFIRMED/);
  });

  it('INT-IDEM-002 un identifiant de transaction ne crédite qu’une tentative (23505), écriture annulée', async () => {
    const first = await pendingAttempt();
    await confirm(first, { providerTxId: 'tx-partage-0001' });
    const second = await pendingAttempt({ id: uuid(2), idemKey: uuid(502) });
    const result = await failure(() => confirm(second, { providerTxId: 'tx-partage-0001' }));
    expect(result.code).toBe('23505');
    expect(await counts()).toEqual({ entries: 1, contributions: 1 });
  });

  it('D39 les espèces ne se confirment pas par ce chemin (PAYMENT_INVALID_REQUEST)', async () => {
    const attempt = await pendingAttempt({ channel: 'CASH' });
    const result = await failure(() => confirm(attempt));
    expect(result.code).toBe('PAYMENT_INVALID_REQUEST');
    expect(await counts()).toEqual({ entries: 0, contributions: 0 });
  });

  it('refuse un client qui n’est pas celui de l’accord (PAYMENT_INVALID_REQUEST), rien n’est écrit', async () => {
    const attempt = await pendingAttempt();
    const result = await failure(() => confirm(attempt, {}, uuid(888)));
    expect(result.message).toMatch(/PAYMENT_INVALID_REQUEST/);
    expect(await counts()).toEqual({ entries: 0, contributions: 0 });
  });
});

describe('I-6 imposé par la base, sans passer par le store', () => {
  async function rawEntry(client: Client, attemptId: string, creditAccount: string, amount: string): Promise<string> {
    const entry = await appendLedgerEntry(client, {
      id: uuidv7(),
      operationType: 'PAYMENT_CONFIRMED',
      businessRefs: { payment_attempt_id: attemptId, agreement_id: AGREEMENT_ID },
      actorId: 'payments-worker',
      approvers: [],
      idemScope: 'tests-raw',
      idemKey: uuidv7(),
      postings: [
        { accountId: ACCOUNT_AGGREGATOR, direction: 'DEBIT', amount: xaf(BigInt(amount)) },
        { accountId: creditAccount, direction: 'CREDIT', amount: xaf(BigInt(amount)) },
      ],
    });
    return entry.id;
  }

  async function rawContribution(client: Client, attemptId: string, entryId: string): Promise<void> {
    await client.query(
      `INSERT INTO payments.contribution
         (id, attempt_id, channel, provider_tx_id, customer_id, amount_xaf, entry_id, confirmed_at)
       VALUES ($1, $2, 'MTN_MOMO', 'tx-brut-0001', $3, 10000, $4, now())`,
      [uuidv7(), attemptId, CUSTOMER_ID, entryId],
    );
  }

  it('refuse une contribution sans transition CONFIRMED dans la même transaction', async () => {
    const attempt = await pendingAttempt();
    const result = await failure(() =>
      transact('app_rw', async (client) => {
        const account = await ensureClientFundsAccount(client, CUSTOMER_ID);
        const entryId = await rawEntry(client, attempt.id, account, '10000');
        await rawContribution(client, attempt.id, entryId);
      }),
    );
    expect(result.message).toMatch(/^PAYMENT_CONFIRMATION_INCOMPLETE/);
    expect(await counts()).toEqual({ entries: 0, contributions: 0 });
  });

  it('I-8 refuse une écriture qui ne crédite pas les fonds du client (PAYMENT_LEDGER_LINK_REQUIRED)', async () => {
    const attempt = await pendingAttempt();
    const result = await failure(() =>
      transact('app_rw', async (client) => {
        const entryId = await rawEntry(client, attempt.id, '019a0000-0000-7000-8000-000000007100', '10000');
        await rawContribution(client, attempt.id, entryId);
      }),
    );
    expect(result.message).toMatch(/^PAYMENT_LEDGER_LINK_REQUIRED/);
  });

  it('refuse une écriture d’un autre montant que la tentative (PAYMENT_LEDGER_LINK_REQUIRED)', async () => {
    const attempt = await pendingAttempt();
    const result = await failure(() =>
      transact('app_rw', async (client) => {
        const account = await ensureClientFundsAccount(client, CUSTOMER_ID);
        const entryId = await rawEntry(client, attempt.id, account, '9000');
        await rawContribution(client, attempt.id, entryId);
      }),
    );
    expect(result.message).toMatch(/^PAYMENT_LEDGER_LINK_REQUIRED/);
  });

  it('les contributions sont en ajout seul (PAYMENT_APPEND_ONLY)', async () => {
    await confirm(await pendingAttempt());
    const result = await failure(() => admin.query('UPDATE payments.contribution SET amount_xaf = 1'));
    expect(result.message).toMatch(/^PAYMENT_APPEND_ONLY/);
  });
});

describe('D39 trop-perçu : une tentative ne dépasse pas le reste dû', () => {
  it('refuse une tentative supérieure à la cible (PAYMENT_EXCEEDS_REMAINING)', async () => {
    const result = await failure(() => createAttempt({ amountXaf: 300_001n }));
    expect(result.message).toMatch(/^PAYMENT_EXCEEDS_REMAINING/);
  });

  it('tient compte des versements déjà confirmés', async () => {
    await confirm(await pendingAttempt({ amountXaf: 290_000n }));
    const over = await failure(() => createAttempt({ id: uuid(2), idemKey: uuid(502), amountXaf: 10_001n }));
    expect(over.message).toMatch(/^PAYMENT_EXCEEDS_REMAINING/);
    const exact = await createAttempt({ id: uuid(3), idemKey: uuid(503), amountXaf: 10_000n });
    expect(exact.status).toBe('CREATED');
  });
});

describe('F-SAV-002 / I-9 accord FUNDED dérivé du grand livre', () => {
  async function confirmAndFund(attempt: StoredAttempt): Promise<Awaited<ReturnType<typeof confirmPaymentAndFundAgreement>>> {
    return transact('app_rw', (client) =>
      confirmPaymentAndFundAgreement(client, {
        attemptId: attempt.id,
        customerId: CUSTOMER_ID,
        providerTransaction: succeeded(attempt),
        actorId: 'payments-worker',
      }),
    );
  }

  async function agreementStatus(): Promise<string | undefined> {
    const result = await admin.query<{ status: string }>(
      'SELECT status FROM agreements.agreement_state WHERE id = $1',
      [AGREEMENT_ID],
    );
    return result.rows[0]?.status;
  }

  it('un versement partiel laisse l’accord ACTIVE', async () => {
    const result = await confirmAndFund(await pendingAttempt({ amountXaf: 100_000n }));
    expect(result.agreementFunded).toBe(false);
    expect(await agreementStatus()).toBe('ACTIVE');
  });

  it('le versement qui atteint 100 % passe l’accord à FUNDED dans la même transaction', async () => {
    await confirmAndFund(await pendingAttempt({ amountXaf: 200_000n }));
    const last = await confirmAndFund(await pendingAttempt({ id: uuid(2), idemKey: uuid(502), amountXaf: 100_000n }));
    expect(last.agreementFunded).toBe(true);
    expect(await agreementStatus()).toBe('FUNDED');
    const funds = await admin.query<{ funds: string }>(
      'SELECT agreements.confirmed_funds_xaf($1)::text AS funds',
      [AGREEMENT_ID],
    );
    expect(funds.rows[0]?.funds).toBe('300000');
  });

  it('un accord FUNDED n’accepte plus de tentative (PAYMENT_AGREEMENT_NOT_ACTIVE)', async () => {
    await confirmAndFund(await pendingAttempt({ amountXaf: 300_000n }));
    const result = await failure(() => createAttempt({ id: uuid(2), idemKey: uuid(502), amountXaf: 1_000n }));
    expect(result.message).toMatch(/^PAYMENT_AGREEMENT_NOT_ACTIVE/);
  });

  it('la confirmation rejouée ne refait pas la transition FUNDED', async () => {
    const attempt = await pendingAttempt({ amountXaf: 300_000n });
    await confirmAndFund(attempt);
    const again = await confirmAndFund(attempt);
    expect(again).toMatchObject({ agreementFunded: true });
    const events = await admin.query(
      `SELECT count(*)::int AS n FROM agreements.status_event WHERE agreement_id = $1 AND to_status = 'FUNDED'`,
      [AGREEMENT_ID],
    );
    expect(events.rows[0]).toEqual({ n: 1 });
  });

  it('I-6 la base refuse FUNDED sans 100 % au grand livre (AGREEMENT_LEDGER_LINK_REQUIRED)', async () => {
    await confirm(await pendingAttempt({ amountXaf: 299_999n }));
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO agreements.status_event
             (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
           VALUES ($1, 2, 'TRANSITION', 'ACTIVE', 'FUNDED', NULL, NULL, 'payments-worker', now())`,
          [AGREEMENT_ID],
        ),
      ),
    );
    expect(result.message).toMatch(/^AGREEMENT_LEDGER_LINK_REQUIRED/);
  });

  it('la base refuse une écriture de confirmation qui référence un autre accord (PAYMENT_LEDGER_LINK_REQUIRED)', async () => {
    const attempt = await pendingAttempt();
    const result = await failure(() =>
      transact('app_rw', async (client) => {
        const account = await ensureClientFundsAccount(client, CUSTOMER_ID);
        const entry = await appendLedgerEntry(client, {
          id: uuidv7(),
          operationType: 'PAYMENT_CONFIRMED',
          businessRefs: { payment_attempt_id: attempt.id, agreement_id: DRAFT_AGREEMENT_ID },
          actorId: 'payments-worker',
          approvers: [],
          idemScope: 'tests-raw',
          idemKey: uuidv7(),
          postings: [
            { accountId: ACCOUNT_AGGREGATOR, direction: 'DEBIT', amount: xaf(10_000n) },
            { accountId: account, direction: 'CREDIT', amount: xaf(10_000n) },
          ],
        });
        await client.query(
          `INSERT INTO payments.contribution
             (id, attempt_id, channel, provider_tx_id, customer_id, amount_xaf, entry_id, confirmed_at)
           VALUES ($1, $2, 'MTN_MOMO', 'tx-autre-accord', $3, 10000, $4, now())`,
          [uuidv7(), attempt.id, CUSTOMER_ID, entry.id],
        );
      }),
    );
    expect(result.message).toMatch(/^PAYMENT_LEDGER_LINK_REQUIRED/);
  });
});
