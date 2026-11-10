import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalize, type JsonValue } from '@achat/chain';
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
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
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
].map((path) => resolve(process.cwd(), path));

const CUSTOMER_ID = '019a9200-0000-7000-8000-0000000000c1';
const DEVICE_ID = '019a9200-0000-7000-8000-0000000000d1';
const AGREEMENT_ID = '019a9200-0000-7000-8000-0000000000a1';
const DRAFT_AGREEMENT_ID = '019a9200-0000-7000-8000-0000000000a2';
const TERMS_HASH = Buffer.alloc(32, 7);
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

async function insertAgreementC(client: Client, id: string): Promise<void> {
  await client.query(
    `INSERT INTO agreements.agreement
       (id, customer_id, model, offer_id, offer_version, partner_id, beneficiary_id,
        target_xaf, plan_id, rhythm, min_amount_xaf, duration_days, refund_policy,
        terms_hash, created_at)
     VALUES ($1, $2, 'PLANNED_EXPENSE', NULL, NULL, NULL, 'landlord-1', 300000,
             'plan-c', 'MONTHLY', 10000, 120, 'FULL_NO_FEE', $3, now())`,
    [id, CUSTOMER_ID, TERMS_HASH],
  );
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
  for (const schema of ['payments', 'agreements', 'catalog', 'admin', 'audit']) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
  await transact('app_rw', seed);
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
