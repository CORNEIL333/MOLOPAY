import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalize, type JsonValue } from '@achat/chain';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOffer, publishOffer, type Offer } from '../../src/modules/catalog/domain';
import { appendOfferVersion, listVisibleOffers } from '../../src/modules/catalog/offer.store';
import { createPartnerDossier, partnerDossierHash } from '../../src/modules/catalog/partner';
import {
  appendPartnerDossier,
  recordMerchantDefault,
  recordPartnerValidation,
} from '../../src/modules/catalog/partner.store';
import {
  agreementSigningPayload,
  appendAgreementTransition,
  createPlannedExpenseAgreement,
  createSaveThenBuyAgreement,
  getAgreement,
  listAgreementsAffectedByDefault,
  lockStoredAgreement,
  type SigningDevice,
  type StoredAgreement,
} from '../../src/modules/agreements/agreement.store';
import { agreementTermsHash } from '../../src/modules/agreements/domain';
import { declareMerchantDefault } from '../../src/modules/agreements/merchant-default';
import { PLAN_A, PLAN_C, seedPaymentPlan } from './agreement-fixture';
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
  'db/migrations/0033_payment_plans.sql',
  'db/migrations/0034_agreements_plan_months.sql',
].map((path) => resolve(process.cwd(), path));

const OFFER_ID = '019a9100-0000-7000-8000-0000000000f1';
const CUSTOMER_ID = '019a9100-0000-7000-8000-0000000000c1';
const DEVICE_ID = '019a9100-0000-7000-8000-0000000000d1';
const REQUEST_ID = '019a9100-0000-7000-8000-0000000000a1';
const TERMS_HASH = Buffer.alloc(32, 7);
const SIGNATURE = Buffer.alloc(64, 9);

let container: TestDatabase;
let admin: Client;
let migrationSql: string[];

function uuid(seq: number): string {
  return `019a9100-0000-7000-8000-${seq.toString().padStart(12, '0')}`;
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

async function catchFailure(action: () => Promise<unknown>): Promise<{
  code: string | undefined;
  message: string;
}> {
  try {
    await action();
  } catch (error: unknown) {
    const failure = error as { code?: string; message?: string };
    return { code: failure.code, message: failure.message ?? '' };
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

function offer(priceXaf: bigint, published = true): Offer {
  const draft = createOffer({
    id: OFFER_ID,
    partner: { id: 'partner-1', status: 'VALIDATED' },
    universe: 'TECHNOLOGY',
    models: ['SAVE_THEN_BUY'],
    cityIds: ['douala'],
    priceXaf,
    availability: { kind: 'IN_STOCK', units: 3 },
    warranty: 'Garantie 12 mois',
    discountTerms: 'Remise de 5 % dès 50 % versés',
  });
  return published ? publishOffer(draft) : draft;
}

/** Valide un partenaire par maker-checker (demande PARTNER_APPROVAL approuvée). */
async function validatePartner(
  client: Client,
  options: {
    readonly partnerId: string;
    readonly requestId: string;
    readonly partnerType: 'MERCHANT' | 'BENEFICIARY';
    readonly beneficiaryKind: 'LANDLORD' | null;
  },
): Promise<void> {
  const stored = await appendPartnerDossier(
    client,
    createPartnerDossier({
      partnerId: options.partnerId,
      partnerType: options.partnerType,
      beneficiaryKind: options.beneficiaryKind,
      legalName: 'Partenaire de test',
      rccm: 'RC/DLA/2024/B/0001',
      niu: 'M000000000000A',
      representativeDocumentRef: 'kyc-doc-ref-0001',
      settlementAccountRef: 'settlement-ref-0001',
    }),
    'net-1',
  );
  const payload: Record<string, JsonValue> = {
    partner_id: options.partnerId,
    dossier_hash: partnerDossierHash(stored.dossier).toString('hex'),
  };
  const payloadHash = createHash('sha256').update(canonicalize(payload), 'utf8').digest();
  await client.query(
    `INSERT INTO admin.approval_request
       (id, kind, maker_id, payload, payload_hash, reason, prepared_at, expires_at)
     VALUES ($1, 'PARTNER_APPROVAL', 'net-1', $2::jsonb, $3, 'Onboarding partenaire',
             now(), now() + interval '1 day')`,
    [options.requestId, JSON.stringify(payload), payloadHash],
  );
  await client.query(
    `INSERT INTO admin.approval_decision
       (request_id, decision, decided_by, decided_at, decision_reason)
     VALUES ($1, 'APPROVED', 'comp-1', now(), NULL)`,
    [options.requestId],
  );
  await recordPartnerValidation(client, {
    partnerId: options.partnerId,
    dossierVersion: stored.version,
    decision: {
      id: options.requestId,
      kind: 'PARTNER_APPROVAL',
      status: 'APPROVED',
      makerId: 'net-1',
      checkerId: 'comp-1',
      payload,
      payloadHash,
    },
  });
}

/**
 * Marchand validé avec une offre publiée à 150 000 XAF (v1) et bailleur
 * validé comme bénéficiaire (F-PLN-001).
 */
async function seedCatalog(client: Client): Promise<void> {
  await seedPaymentPlan(client, PLAN_A);
  await seedPaymentPlan(client, PLAN_C);
  await validatePartner(client, {
    partnerId: 'partner-1',
    requestId: REQUEST_ID,
    partnerType: 'MERCHANT',
    beneficiaryKind: null,
  });
  await appendOfferVersion(client, offer(150_000n), 'net-1');
  await validatePartner(client, {
    partnerId: 'landlord-1',
    requestId: uuid(900),
    partnerType: 'BENEFICIARY',
    beneficiaryKind: 'LANDLORD',
  });
}

async function insertAgreementA(
  client: Client,
  options: {
    readonly id?: string;
    readonly offerVersion?: number;
    readonly targetXaf?: string;
    readonly partnerId?: string;
  } = {},
): Promise<string> {
  const id = options.id ?? uuid(1);
  await client.query(
    `INSERT INTO agreements.agreement
       (id, customer_id, model, offer_id, offer_version, partner_id, beneficiary_id,
        target_xaf, plan_id, rhythm, min_amount_xaf, duration_months, refund_policy,
        terms_hash, created_at)
     VALUES ($1, $2, 'SAVE_THEN_BUY', $3, $4, $5, NULL, $6::bigint, 'plan-a',
             'WEEKLY', 5000, 3, 'FULL_NO_FEE', $7, '2000-01-01T00:00:00Z')`,
    [
      id,
      CUSTOMER_ID,
      OFFER_ID,
      options.offerVersion ?? 1,
      options.partnerId ?? 'partner-1',
      options.targetXaf ?? '150000',
      TERMS_HASH,
    ],
  );
  return id;
}

async function insertAgreementC(client: Client, id = uuid(2)): Promise<string> {
  await client.query(
    `INSERT INTO agreements.agreement
       (id, customer_id, model, offer_id, offer_version, partner_id, beneficiary_id,
        target_xaf, plan_id, rhythm, min_amount_xaf, duration_months, refund_policy,
        terms_hash, created_at)
     VALUES ($1, $2, 'PLANNED_EXPENSE', NULL, NULL, NULL, 'landlord-1', 300000,
             'plan-c', 'MONTHLY', 10000, 4, 'FULL_NO_FEE', $3, now())`,
    [id, CUSTOMER_ID, TERMS_HASH],
  );
  return id;
}

async function appendEvent(
  client: Client,
  agreementId: string,
  options: {
    readonly seq: number;
    readonly from: string;
    readonly to: string;
    readonly kind?: 'TRANSITION' | 'LOCK';
    readonly signed?: boolean;
  },
): Promise<void> {
  const signed =
    options.signed ??
    ((options.kind ?? 'TRANSITION') === 'TRANSITION' &&
      ((options.from === 'DRAFT' && options.to === 'ACTIVE') ||
        (options.from === 'ACTIVE' && options.to === 'CANCELLED_BY_CUSTOMER')));
  await client.query(
    `INSERT INTO agreements.status_event
       (agreement_id, seq, kind, from_status, to_status, device_id, signature,
        actor_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'client-1', '2000-01-01T00:00:00Z')`,
    [
      agreementId,
      options.seq,
      options.kind ?? 'TRANSITION',
      options.from,
      options.to,
      signed ? DEVICE_ID : null,
      signed ? SIGNATURE : null,
    ],
  );
}

async function stateOf(id: string): Promise<{
  status: string;
  locked: boolean;
  target_xaf: string;
}> {
  const result = await admin.query<{ status: string; locked: boolean; target_xaf: string }>(
    'SELECT status, locked, target_xaf FROM agreements.agreement_state WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('accord introuvable');
  }
  return row;
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
  await admin.query('DROP SCHEMA IF EXISTS agreements CASCADE');
  await admin.query('DROP SCHEMA IF EXISTS catalog CASCADE');
  await admin.query('DROP SCHEMA IF EXISTS admin CASCADE');
  await admin.query('DROP SCHEMA IF EXISTS audit CASCADE');
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
  await transact('app_rw', seedCatalog);
});

describe('F-CAT-003 · I-11 · prix figé imposé par la base (PostgreSQL réel)', () => {
  it('F-CAT-003 accepte un accord A au prix de la version courante publiée', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    expect(await stateOf(id)).toEqual({ status: 'DRAFT', locked: false, target_xaf: '150000' });
  });

  it('F-CAT-003 ancre created_at sur l’horloge serveur', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    const row = await admin.query<{ created_at: Date }>(
      'SELECT created_at FROM agreements.agreement WHERE id = $1',
      [id],
    );
    expect(row.rows[0]?.created_at.getUTCFullYear()).toBeGreaterThan(2000);
  });

  it('I-11 refuse une cible différente du prix de la version', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', (client) => insertAgreementA(client, { targetXaf: '1' })),
    );
    expect(failure.message).toContain('AGREEMENT_INVALID_REQUEST');
  });

  it('I-11 refuse un accord sur une version ancienne et conserve le prix des accords existants', async () => {
    const existing = await transact('app_rw', (client) => insertAgreementA(client));
    await transact('app_rw', (client) => appendOfferVersion(client, offer(199_000n), 'net-1'));
    const stale = await catchFailure(() =>
      transact('app_rw', (client) => insertAgreementA(client, { id: uuid(3) })),
    );
    expect(stale.message).toContain('AGREEMENT_OFFER_NOT_AVAILABLE');
    expect((await stateOf(existing)).target_xaf).toBe('150000');
    const fresh = await transact('app_rw', (client) =>
      insertAgreementA(client, { id: uuid(4), offerVersion: 2, targetXaf: '199000' }),
    );
    expect((await stateOf(fresh)).target_xaf).toBe('199000');
  });

  it('F-SAV-001 refuse une version courante non publiée', async () => {
    await transact('app_rw', (client) =>
      appendOfferVersion(client, offer(150_000n, false), 'net-1'),
    );
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        insertAgreementA(client, { offerVersion: 2 }),
      ),
    );
    expect(failure.message).toContain('AGREEMENT_OFFER_NOT_AVAILABLE');
  });

  it('F-SAV-001 refuse un partenaire différent de celui de l’offre', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', (client) => insertAgreementA(client, { partnerId: 'partner-2' })),
    );
    expect(failure.message).toContain('AGREEMENT_INVALID_REQUEST');
  });

  it('F-PLN-001 accepte un objectif C et refuse un mélange offre/bénéficiaire', async () => {
    const id = await transact('app_rw', (client) => insertAgreementC(client));
    expect((await stateOf(id)).status).toBe('DRAFT');
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO agreements.agreement
             (id, customer_id, model, offer_id, offer_version, partner_id, beneficiary_id,
              target_xaf, plan_id, rhythm, min_amount_xaf, duration_months, refund_policy,
              terms_hash, created_at)
           VALUES ($1, $2, 'PLANNED_EXPENSE', $3, 1, 'partner-1', 'landlord-1', 300000,
                   'plan-c', 'MONTHLY', 10000, 4, 'FULL_NO_FEE', $4, now())`,
          [uuid(5), CUSTOMER_ID, OFFER_ID, TERMS_HASH],
        ),
      ),
    );
    expect(failure.code).toBe('23514');
    expect(failure.message).toContain('agreement_model_target');
  });

  it('F-SAV-005 refuse un barème de restitution non publié', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO agreements.agreement
             (id, customer_id, model, offer_id, offer_version, partner_id, beneficiary_id,
              target_xaf, plan_id, rhythm, min_amount_xaf, duration_months, refund_policy,
              terms_hash, created_at)
           VALUES ($1, $2, 'PLANNED_EXPENSE', NULL, NULL, NULL, 'landlord-1', 300000,
                   'plan-c', 'MONTHLY', 10000, 4, 'FEE_10_PERCENT', $3, now())`,
          [uuid(6), CUSTOMER_ID, TERMS_HASH],
        ),
      ),
    );
    expect(failure.code).toBe('23514');
  });
});

describe('INT-LED-003 · accords en ajout seul (PostgreSQL réel)', () => {
  it('refuse modification, suppression et troncature, même au propriétaire', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    const update = await catchFailure(() =>
      transact(null, (client) =>
        client.query('UPDATE agreements.agreement SET target_xaf = 1 WHERE id = $1', [id]),
      ),
    );
    expect(update.message).toContain('AGREEMENT_APPEND_ONLY');
    const remove = await catchFailure(() =>
      transact(null, (client) =>
        client.query('DELETE FROM agreements.agreement WHERE id = $1', [id]),
      ),
    );
    expect(remove.message).toContain('AGREEMENT_APPEND_ONLY');
    const truncate = await catchFailure(() =>
      transact(null, (client) =>
        client.query('TRUNCATE agreements.agreement CASCADE'),
      ),
    );
    expect(truncate.message).toContain('AGREEMENT_APPEND_ONLY');
  });

  it('refuse la modification d’un événement de statut', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    await transact('app_rw', (client) =>
      appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'ACTIVE' }),
    );
    const update = await catchFailure(() =>
      transact(null, (client) =>
        client.query(`UPDATE agreements.status_event SET to_status = 'CLOSED'`),
      ),
    );
    expect(update.message).toContain('AGREEMENT_APPEND_ONLY');
  });

  it('interdit l’écriture au rôle lecture seule', async () => {
    const failure = await catchFailure(() =>
      transact('app_ro', (client) => insertAgreementA(client)),
    );
    expect(failure.code).toBe('42501');
  });
});

describe('CDC_05 § 5.2 · transitions imposées par la base (PostgreSQL réel)', () => {
  it('CDC_05 active un accord signé et ancre l’horodatage', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    await transact('app_rw', (client) =>
      appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'ACTIVE' }),
    );
    expect((await stateOf(id)).status).toBe('ACTIVE');
    const row = await admin.query<{ created_at: Date }>(
      'SELECT created_at FROM agreements.status_event WHERE agreement_id = $1',
      [id],
    );
    expect(row.rows[0]?.created_at.getUTCFullYear()).toBeGreaterThan(2000);
  });

  it('CDC_05 refuse une activation sans signature d’appareil', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'ACTIVE', signed: false }),
      ),
    );
    expect(failure.code).toBe('23514');
    expect(failure.message).toContain('status_event_customer_signed');
  });

  it('SEC-AUTH-002 refuse une annulation client sans signature d’appareil', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    await transact('app_rw', (client) =>
      appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'ACTIVE' }),
    );
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendEvent(client, id, {
          seq: 2,
          from: 'ACTIVE',
          to: 'CANCELLED_BY_CUSTOMER',
          signed: false,
        }),
      ),
    );
    expect(failure.code).toBe('23514');
    expect(failure.message).toContain('status_event_customer_signed');
  });

  it('SEC-AUTH-002 refuse une signature sur une transition qui n’en attend pas', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    await transact('app_rw', (client) =>
      appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'ACTIVE' }),
    );
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendEvent(client, id, { seq: 2, from: 'ACTIVE', to: 'FROZEN', signed: true }),
      ),
    );
    expect(failure.code).toBe('23514');
  });

  it('CDC_05 refuse une transition hors liste blanche', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'CLOSED' }),
      ),
    );
    expect(failure.message).toContain('UNAUTHORIZED_TRANSITION');
  });

  it('CDC_05 refuse un état d’origine qui n’est pas l’état courant', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendEvent(client, id, { seq: 1, from: 'ACTIVE', to: 'FROZEN' }),
      ),
    );
    expect(failure.message).toContain('UNAUTHORIZED_TRANSITION');
  });

  it('CDC_05 refuse une séquence avec trou ou rejouée', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    const gap = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendEvent(client, id, { seq: 2, from: 'DRAFT', to: 'ACTIVE' }),
      ),
    );
    expect(gap.message).toContain('AGREEMENT_INVALID_REQUEST');
    await transact('app_rw', (client) =>
      appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'ACTIVE' }),
    );
    const replay = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'ACTIVE' }),
      ),
    );
    expect(replay.message).toContain('AGREEMENT_INVALID_REQUEST');
  });

  it('F-SAV-003 refuse l’annulation d’un objectif verrouillé et le double verrou', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    await transact('app_rw', async (client) => {
      await appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'ACTIVE' });
      await appendEvent(client, id, { seq: 2, from: 'ACTIVE', to: 'ACTIVE', kind: 'LOCK' });
    });
    expect(await stateOf(id)).toMatchObject({ status: 'ACTIVE', locked: true });
    const cancel = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendEvent(client, id, { seq: 3, from: 'ACTIVE', to: 'CANCELLED_BY_CUSTOMER' }),
      ),
    );
    expect(cancel.message).toContain('AGREEMENT_LOCKED');
    const relock = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendEvent(client, id, { seq: 3, from: 'ACTIVE', to: 'ACTIVE', kind: 'LOCK' }),
      ),
    );
    expect(relock.message).toContain('AGREEMENT_LOCKED');
  });

  it('F-SAV-003 refuse un verrou sur un brouillon', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendEvent(client, id, { seq: 1, from: 'ACTIVE', to: 'ACTIVE', kind: 'LOCK' }),
      ),
    );
    expect(failure.message).toContain('UNAUTHORIZED_TRANSITION');
  });

  it('F-SAV-005 annule un objectif actif non verrouillé', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    await transact('app_rw', async (client) => {
      await appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'ACTIVE' });
      await appendEvent(client, id, { seq: 2, from: 'ACTIVE', to: 'CANCELLED_BY_CUSTOMER' });
    });
    expect((await stateOf(id)).status).toBe('CANCELLED_BY_CUSTOMER');
  });

  it('CDC_05 un litige ne revient qu’à son état d’origine', async () => {
    const id = await transact('app_rw', (client) => insertAgreementC(client));
    await transact('app_rw', async (client) => {
      await appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'ACTIVE' });
      await appendEvent(client, id, { seq: 2, from: 'ACTIVE', to: 'DISPUTED' });
    });
    const wrong = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendEvent(client, id, { seq: 3, from: 'DISPUTED', to: 'FUNDED' }),
      ),
    );
    expect(wrong.message).toContain('UNAUTHORIZED_TRANSITION');
    await transact('app_rw', (client) =>
      appendEvent(client, id, { seq: 3, from: 'DISPUTED', to: 'ACTIVE' }),
    );
    expect((await stateOf(id)).status).toBe('ACTIVE');
  });

  it('CDC_05 gèle puis réactive un objectif', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    await transact('app_rw', async (client) => {
      await appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'ACTIVE' });
      await appendEvent(client, id, { seq: 2, from: 'ACTIVE', to: 'FROZEN' });
      await appendEvent(client, id, { seq: 3, from: 'FROZEN', to: 'ACTIVE' });
    });
    expect((await stateOf(id)).status).toBe('ACTIVE');
  });

  it.each([
    ['ACTIVE', 'FUNDED', [] as const],
    ['FROZEN', 'REFUNDED', [['ACTIVE', 'FROZEN']] as const],
    ['CANCELLED_BY_CUSTOMER', 'REFUNDED', [['ACTIVE', 'CANCELLED_BY_CUSTOMER']] as const],
  ])(
    'I-6 refuse %s → %s sans écriture du grand livre',
    async (from, to, path) => {
      const id = await transact('app_rw', (client) => insertAgreementA(client));
      await transact('app_rw', async (client) => {
        await appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'ACTIVE' });
        let seq = 2;
        for (const [stepFrom, stepTo] of path) {
          await appendEvent(client, id, { seq, from: stepFrom, to: stepTo });
          seq += 1;
        }
      });
      const failure = await catchFailure(() =>
        transact('app_rw', (client) =>
          appendEvent(client, id, { seq: 2 + path.length, from, to }),
        ),
      );
      expect(failure.message).toContain('AGREEMENT_LEDGER_LINK_REQUIRED');
    },
  );
});


function deviceKeys(accountId = CUSTOMER_ID, status = 'ACTIVE'): {
  readonly device: SigningDevice;
  readonly sign: (payload: Buffer) => Buffer;
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    device: {
      id: DEVICE_ID,
      accountId,
      status,
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    },
    sign: (payload) => sign(null, payload, privateKey),
  };
}

function payloadFor(
  stored: StoredAgreement,
  to: 'ACTIVE' | 'CANCELLED_BY_CUSTOMER',
): Buffer {
  return agreementSigningPayload({
    agreementId: stored.agreement.terms.agreementId,
    termsHash: stored.agreement.termsHash,
    from: stored.agreement.status,
    to,
    seq: stored.seq + 1,
  });
}

async function createA(): Promise<StoredAgreement> {
  return transact('app_rw', (client) =>
    createSaveThenBuyAgreement(client, {
      id: uuid(10),
      customerId: CUSTOMER_ID,
      offerId: OFFER_ID,
      planId: PLAN_A.planId,
      durationMonths: 3,
      createdAt: '2026-10-31T09:00:00.000Z',
    }),
  );
}

async function activate(
  stored: StoredAgreement,
  keys: ReturnType<typeof deviceKeys>,
): Promise<StoredAgreement> {
  return transact('app_rw', (client) =>
    appendAgreementTransition(client, {
      agreementId: stored.agreement.terms.agreementId,
      to: 'ACTIVE',
      actorId: 'client-1',
      signature: { device: keys.device, signature: keys.sign(payloadFor(stored, 'ACTIVE')) },
    }),
  );
}

describe('F-SAV-001 · INT-NR-001 · store des accords (PostgreSQL réel)', () => {
  it('F-CAT-003 crée un accord A au prix de la version courante, empreinte relue', async () => {
    const stored = await createA();
    expect(stored.seq).toBe(0);
    expect(stored.agreement.status).toBe('DRAFT');
    expect(stored.agreement.terms.targetXaf).toBe(150_000n);
    expect(stored.agreement.terms.offerVersion).toBe(1);
    expect(stored.agreement.termsHash).toBe(agreementTermsHash(stored.agreement.terms));
  });

  it('I-11 le prix d’un accord existant ne suit pas un changement de prix', async () => {
    const stored = await createA();
    await transact('app_rw', (client) => appendOfferVersion(client, offer(199_000n), 'net-1'));
    const reread = await transact('app_ro', (client) =>
      getAgreement(client, stored.agreement.terms.agreementId),
    );
    expect(reread?.agreement.terms.targetXaf).toBe(150_000n);
  });

  it('F-PLN-001 crée un objectif C vers un bénéficiaire vérifié', async () => {
    const stored = await transact('app_rw', (client) =>
      createPlannedExpenseAgreement(client, {
        id: uuid(11),
        customerId: CUSTOMER_ID,
        beneficiaryId: 'landlord-1',
        targetXaf: 300_000n,
        planId: PLAN_C.planId,
        durationMonths: 4,
        createdAt: '2026-10-31T09:00:00.000Z',
      }),
    );
    expect(stored.agreement.terms.beneficiaryId).toBe('landlord-1');
  });

  it('INT-NR-001 active un accord signé par l’appareil du client', async () => {
    const active = await activate(await createA(), deviceKeys());
    expect(active.agreement.status).toBe('ACTIVE');
    expect(active.seq).toBe(1);
  });

  it.each([
    ['sans signature', 'none'],
    ['signée par une autre clé', 'other-key'],
    ['par l’appareil d’un autre client', 'other-customer'],
    ['par un appareil révoqué', 'revoked'],
    ['avec une signature d’un autre rang', 'wrong-seq'],
  ])('INT-NR-001 refuse une activation %s → AGREEMENT_SIGNATURE_INVALID', async (_label, variant) => {
    const stored = await createA();
    const keys =
      variant === 'other-customer'
        ? deviceKeys(uuid(99))
        : variant === 'revoked'
          ? deviceKeys(CUSTOMER_ID, 'REVOKED')
          : deviceKeys();
    const signer = variant === 'other-key' ? deviceKeys() : keys;
    const payload =
      variant === 'wrong-seq'
        ? agreementSigningPayload({
            agreementId: stored.agreement.terms.agreementId,
            termsHash: stored.agreement.termsHash,
            from: 'DRAFT',
            to: 'ACTIVE',
            seq: 2,
          })
        : payloadFor(stored, 'ACTIVE');
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendAgreementTransition(client, {
          agreementId: stored.agreement.terms.agreementId,
          to: 'ACTIVE',
          actorId: 'client-1',
          ...(variant === 'none'
            ? {}
            : { signature: { device: keys.device, signature: signer.sign(payload) } }),
        }),
      ),
    );
    expect(failure.code).toBe('AGREEMENT_SIGNATURE_INVALID');
    const reread = await transact('app_ro', (client) =>
      getAgreement(client, stored.agreement.terms.agreementId),
    );
    expect(reread?.agreement.status).toBe('DRAFT');
  });

  it('SEC-AUTH-002 refuse de rejouer la signature d’activation pour annuler', async () => {
    const stored = await createA();
    const keys = deviceKeys();
    const activation = keys.sign(payloadFor(stored, 'ACTIVE'));
    await transact('app_rw', (client) =>
      appendAgreementTransition(client, {
        agreementId: stored.agreement.terms.agreementId,
        to: 'ACTIVE',
        actorId: 'client-1',
        signature: { device: keys.device, signature: activation },
      }),
    );
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendAgreementTransition(client, {
          agreementId: stored.agreement.terms.agreementId,
          to: 'CANCELLED_BY_CUSTOMER',
          actorId: 'client-1',
          signature: { device: keys.device, signature: activation },
        }),
      ),
    );
    expect(failure.code).toBe('AGREEMENT_SIGNATURE_INVALID');
  });

  it('F-SAV-003 verrouille puis refuse l’annulation signée', async () => {
    const keys = deviceKeys();
    await activate(await createA(), keys);
    const id = uuid(10);
    const locked = await transact('app_rw', (client) =>
      lockStoredAgreement(client, { agreementId: id, actorId: 'client-1' }),
    );
    expect(locked.agreement.locked).toBe(true);
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendAgreementTransition(client, {
          agreementId: id,
          to: 'CANCELLED_BY_CUSTOMER',
          actorId: 'client-1',
          signature: {
            device: keys.device,
            signature: keys.sign(payloadFor(locked, 'CANCELLED_BY_CUSTOMER')),
          },
        }),
      ),
    );
    expect(failure.code).toBe('AGREEMENT_LOCKED');
  });

  it('F-SAV-005 annule un objectif actif avec signature', async () => {
    const keys = deviceKeys();
    const active = await activate(await createA(), keys);
    const cancelled = await transact('app_rw', (client) =>
      appendAgreementTransition(client, {
        agreementId: uuid(10),
        to: 'CANCELLED_BY_CUSTOMER',
        actorId: 'client-1',
        signature: {
          device: keys.device,
          signature: keys.sign(payloadFor(active, 'CANCELLED_BY_CUSTOMER')),
        },
      }),
    );
    expect(cancelled.agreement.status).toBe('CANCELLED_BY_CUSTOMER');
  });

  it('CDC_05 refuse une signature fournie pour une transition non client', async () => {
    const keys = deviceKeys();
    await activate(await createA(), keys);
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendAgreementTransition(client, {
          agreementId: uuid(10),
          to: 'FROZEN',
          actorId: 'ops-1',
          signature: { device: keys.device, signature: Buffer.alloc(64) },
        }),
      ),
    );
    expect(failure.code).toBe('AGREEMENT_INVALID_REQUEST');
  });

  it('AGREEMENT_NOT_FOUND pour un accord inconnu', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendAgreementTransition(client, {
          agreementId: uuid(77),
          to: 'FROZEN',
          actorId: 'ops-1',
        }),
      ),
    );
    expect(failure.code).toBe('AGREEMENT_NOT_FOUND');
  });
});

describe('F-PLN-001 · bénéficiaire vérifié imposé (PostgreSQL réel)', () => {
  it.each([
    ['un marchand', 'partner-1'],
    ['un partenaire inconnu', 'nobody'],
  ])('F-PLN-001 la base refuse un objectif C vers %s', async (_label, beneficiaryId) => {
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO agreements.agreement
             (id, customer_id, model, offer_id, offer_version, partner_id, beneficiary_id,
              target_xaf, plan_id, rhythm, min_amount_xaf, duration_months, refund_policy,
              terms_hash, created_at)
           VALUES ($1, $2, 'PLANNED_EXPENSE', NULL, NULL, NULL, $3, 300000,
                   'plan-c', 'MONTHLY', 10000, 4, 'FULL_NO_FEE', $4, now())`,
          [uuid(20), CUSTOMER_ID, beneficiaryId, TERMS_HASH],
        ),
      ),
    );
    expect(failure.message).toContain('AGREEMENT_BENEFICIARY_NOT_VERIFIED');
  });

  it('F-PLN-001 la base refuse un bénéficiaire dont le dossier modifié n’est pas revalidé', async () => {
    await transact('app_rw', (client) =>
      appendPartnerDossier(
        client,
        createPartnerDossier({
          partnerId: 'landlord-1',
          partnerType: 'BENEFICIARY',
          beneficiaryKind: 'LANDLORD',
          legalName: 'Partenaire de test',
          rccm: 'RC/DLA/2024/B/0001',
          niu: 'M000000000000A',
          representativeDocumentRef: 'kyc-doc-ref-0001',
          settlementAccountRef: 'settlement-ref-0002',
        }),
        'net-1',
      ),
    );
    const failure = await catchFailure(() =>
      transact('app_rw', (client) => insertAgreementC(client)),
    );
    expect(failure.message).toContain('AGREEMENT_BENEFICIARY_NOT_VERIFIED');
  });

  it.each([
    ['un marchand', 'partner-1'],
    ['un partenaire inconnu', 'nobody'],
  ])('F-PLN-001 le store refuse un objectif C vers %s', async (_label, beneficiaryId) => {
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        createPlannedExpenseAgreement(client, {
          id: uuid(21),
          customerId: CUSTOMER_ID,
          beneficiaryId,
          targetXaf: 300_000n,
          planId: PLAN_C.planId,
          durationMonths: 4,
          createdAt: '2026-10-31T09:00:00.000Z',
        }),
      ),
    );
    expect(failure.code).toBe('AGREEMENT_BENEFICIARY_NOT_VERIFIED');
  });
});

const INCIDENT_ID = '019a9100-0000-7000-8000-0000000000e1';

async function declareDefault(): Promise<void> {
  await transact('app_rw', (client) =>
    recordMerchantDefault(client, {
      id: INCIDENT_ID,
      partnerId: 'partner-1',
      reason: 'Fermeture du magasin constatée',
      reportedBy: 'ops-1',
    }),
  );
}

describe('F-SAV-006 · défaillance marchand (PostgreSQL réel)', () => {
  it('F-SAV-006 trace l’incident et retire les offres du catalogue public', async () => {
    expect(await transact('app_ro', (client) => listVisibleOffers(client))).toHaveLength(1);
    await declareDefault();
    const row = await admin.query<{ in_default: boolean }>(
      `SELECT in_default FROM catalog.partner_state WHERE partner_id = 'partner-1'`,
    );
    expect(row.rows[0]?.in_default).toBe(true);
    expect(await transact('app_ro', (client) => listVisibleOffers(client))).toHaveLength(0);
  });

  it('F-SAV-006 refuse une nouvelle publication du marchand défaillant', async () => {
    await declareDefault();
    const failure = await catchFailure(() =>
      transact('app_rw', (client) => appendOfferVersion(client, offer(140_000n), 'net-1')),
    );
    expect(failure.message).toContain('CATALOG_PARTNER_IN_DEFAULT');
  });

  it('F-SAV-006 refuse un nouvel accord A chez le marchand défaillant', async () => {
    await declareDefault();
    const failure = await catchFailure(() =>
      transact('app_rw', (client) => insertAgreementA(client)),
    );
    expect(failure.message).toContain('AGREEMENT_OFFER_NOT_AVAILABLE');
  });

  it('F-SAV-006 refuse l’activation d’un brouillon antérieur à la défaillance', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    await declareDefault();
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'ACTIVE' }),
      ),
    );
    expect(failure.message).toContain('AGREEMENT_OFFER_NOT_AVAILABLE');
  });

  it('F-SAV-006 liste les accords touchés avec les deux remèdes, puis permet le gel', async () => {
    const id = await transact('app_rw', (client) => insertAgreementA(client));
    await transact('app_rw', (client) =>
      appendEvent(client, id, { seq: 1, from: 'DRAFT', to: 'ACTIVE' }),
    );
    expect(
      await transact('app_ro', (client) => listAgreementsAffectedByDefault(client, 'partner-1')),
    ).toEqual([]);
    await declareDefault();
    const affected = await transact('app_ro', (client) =>
      listAgreementsAffectedByDefault(client, 'partner-1'),
    );
    expect(affected).toEqual([
      { agreementId: id, status: 'ACTIVE', remedies: ['EQUIVALENT_ITEM', 'FULL_REFUND'] },
    ]);
    await transact('app_rw', (client) =>
      appendEvent(client, id, { seq: 2, from: 'ACTIVE', to: 'FROZEN' }),
    );
    expect((await stateOf(id)).status).toBe('FROZEN');
  });

  it('F-SAV-006 refuse un doublon, un bénéficiaire et un partenaire inconnu', async () => {
    await declareDefault();
    const duplicate = await catchFailure(() =>
      transact('app_rw', (client) =>
        recordMerchantDefault(client, {
          id: uuid(31),
          partnerId: 'partner-1',
          reason: 'Second signalement',
          reportedBy: 'ops-2',
        }),
      ),
    );
    expect(duplicate.message).toContain('CATALOG_PARTNER_IN_DEFAULT');
    for (const partnerId of ['landlord-1', 'nobody']) {
      const failure = await catchFailure(() =>
        transact('app_rw', (client) =>
          recordMerchantDefault(client, {
            id: uuid(32),
            partnerId,
            reason: 'Signalement',
            reportedBy: 'ops-1',
          }),
        ),
      );
      expect(failure.message).toContain('CATALOG_INVALID_REQUEST');
    }
  });

  it('F-SAV-006 refuse un motif vide avant toute écriture', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        recordMerchantDefault(client, {
          id: INCIDENT_ID,
          partnerId: 'partner-1',
          reason: '   ',
          reportedBy: 'ops-1',
        }),
      ),
    );
    expect(failure.code).toBe('CATALOG_INVALID_REQUEST');
  });

  it('F-SAV-006 le registre est en ajout seul, même pour le propriétaire', async () => {
    await declareDefault();
    for (const sql of [
      `UPDATE catalog.partner_incident SET reason = 'effacé'`,
      'DELETE FROM catalog.partner_incident',
      'TRUNCATE catalog.partner_incident',
    ]) {
      const failure = await catchFailure(() => transact(null, (client) => client.query(sql)));
      expect(failure.message).toContain('CATALOG_APPEND_ONLY');
    }
  });
});

/** Nouvelle version du dossier marchand validée par maker-checker (levée D31). */
async function revalidateMerchant(requestId: string): Promise<void> {
  await transact('app_rw', (client) =>
    validatePartner(client, {
      partnerId: 'partner-1',
      requestId,
      partnerType: 'MERCHANT',
      beneficiaryKind: null,
    }),
  );
}

async function auditEvents(): Promise<
  { action: string; reason: string | null; refs: Record<string, string> }[]
> {
  const rows = await admin.query<{
    action: string;
    reason: string | null;
    refs: Record<string, string>;
  }>('SELECT action, reason, refs FROM audit.event ORDER BY seq');
  return rows.rows;
}

describe('D31 · déclaration, gel automatique et levée (PostgreSQL réel)', () => {
  it('F-SAV-006 gèle les accords actifs et journalise dans la même transaction', async () => {
    const active = (await activate(await createA(), deviceKeys())).agreement.terms.agreementId;
    const draft = await transact('app_rw', (client) => insertAgreementA(client, { id: uuid(2) }));
    const declaration = await transact('app_rw', (client) =>
      declareMerchantDefault(client, {
        incidentId: INCIDENT_ID,
        partnerId: 'partner-1',
        reason: 'Fermeture du magasin constatée',
        actorId: 'network-1',
      }),
    );
    expect(declaration.frozenAgreementIds).toEqual([active]);
    expect((await stateOf(active)).status).toBe('FROZEN');
    expect((await stateOf(draft)).status).toBe('DRAFT');
    expect(await auditEvents()).toEqual([
      {
        action: 'MERCHANT_DEFAULT_DECLARED',
        reason: 'Fermeture du magasin constatée',
        refs: { incident_id: INCIDENT_ID, frozen_agreements: '1' },
      },
    ]);
  });

  it('F-SAV-006 un accord à l’empreinte altérée fait échouer toute la déclaration', async () => {
    const tampered = await transact('app_rw', (client) => insertAgreementA(client));
    await transact('app_rw', (client) =>
      appendEvent(client, tampered, { seq: 1, from: 'DRAFT', to: 'ACTIVE' }),
    );
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        declareMerchantDefault(client, {
          incidentId: INCIDENT_ID,
          partnerId: 'partner-1',
          reason: 'Fermeture du magasin constatée',
          actorId: 'network-1',
        }),
      ),
    );
    expect(failure.code).toBe('AGREEMENT_INVALID_REQUEST');
    const incidents = await admin.query('SELECT id FROM catalog.partner_incident');
    expect(incidents.rowCount).toBe(0);
    expect(await auditEvents()).toHaveLength(0);
    expect((await stateOf(tampered)).status).toBe('ACTIVE');
  });

  it('F-SAV-006 une seconde déclaration active est refusée sans aucun effet', async () => {
    await transact('app_rw', (client) =>
      declareMerchantDefault(client, {
        incidentId: INCIDENT_ID,
        partnerId: 'partner-1',
        reason: 'Fermeture du magasin constatée',
        actorId: 'network-1',
      }),
    );
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        declareMerchantDefault(client, {
          incidentId: uuid(33),
          partnerId: 'partner-1',
          reason: 'Doublon',
          actorId: 'ops-1',
        }),
      ),
    );
    expect(failure.message).toContain('CATALOG_PARTNER_IN_DEFAULT');
    expect(await auditEvents()).toHaveLength(1);
  });

  it('D31 une nouvelle version non validée ne lève pas la défaillance', async () => {
    await declareDefault();
    await transact('app_rw', (client) =>
      appendPartnerDossier(
        client,
        createPartnerDossier({
          partnerId: 'partner-1',
          partnerType: 'MERCHANT',
          beneficiaryKind: null,
          legalName: 'Partenaire de test',
          rccm: 'RC/DLA/2024/B/0001',
          niu: 'M000000000000A',
          representativeDocumentRef: 'kyc-doc-ref-0001',
          settlementAccountRef: 'settlement-ref-0001',
        }),
        'net-1',
      ),
    );
    const row = await admin.query<{ in_default: boolean; status: string }>(
      `SELECT in_default, status FROM catalog.partner_state WHERE partner_id = 'partner-1'`,
    );
    expect(row.rows[0]).toEqual({ in_default: true, status: 'PENDING' });
  });

  it('D31 la revalidation maker-checker lève la défaillance sans réactiver les accords gelés', async () => {
    const id = (await activate(await createA(), deviceKeys())).agreement.terms.agreementId;
    await transact('app_rw', (client) =>
      declareMerchantDefault(client, {
        incidentId: INCIDENT_ID,
        partnerId: 'partner-1',
        reason: 'Fermeture du magasin constatée',
        actorId: 'network-1',
      }),
    );
    await revalidateMerchant(uuid(901));
    const row = await admin.query<{ in_default: boolean }>(
      `SELECT in_default FROM catalog.partner_state WHERE partner_id = 'partner-1'`,
    );
    expect(row.rows[0]?.in_default).toBe(false);
    expect((await stateOf(id)).status).toBe('FROZEN');
    const incidents = await admin.query('SELECT id FROM catalog.partner_incident');
    expect(incidents.rowCount).toBe(1);
    expect(await transact('app_ro', (client) => listVisibleOffers(client))).toHaveLength(0);
    const stale = await catchFailure(() =>
      transact('app_rw', (client) => insertAgreementA(client, { id: uuid(3) })),
    );
    expect(stale.message).toContain('AGREEMENT_OFFER_NOT_AVAILABLE');
    await transact('app_rw', (client) => appendOfferVersion(client, offer(150_000n), 'net-1'));
    expect(await transact('app_ro', (client) => listVisibleOffers(client))).toHaveLength(1);
    const fresh = await transact('app_rw', (client) =>
      insertAgreementA(client, { id: uuid(4), offerVersion: 2 }),
    );
    expect((await stateOf(fresh)).status).toBe('DRAFT');
  });

  it('D31 un brouillon antérieur à l’incident ne s’active pas après la levée', async () => {
    const draft = await transact('app_rw', (client) => insertAgreementA(client));
    await declareDefault();
    await revalidateMerchant(uuid(901));
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendEvent(client, draft, { seq: 1, from: 'DRAFT', to: 'ACTIVE' }),
      ),
    );
    expect(failure.message).toContain('AGREEMENT_OFFER_NOT_AVAILABLE');
  });

  it('D31 une récidive peut être déclarée après une levée', async () => {
    await declareDefault();
    await revalidateMerchant(uuid(901));
    await transact('app_rw', (client) =>
      recordMerchantDefault(client, {
        id: uuid(34),
        partnerId: 'partner-1',
        reason: 'Nouvelle défaillance',
        reportedBy: 'risk-1',
      }),
    );
    const row = await admin.query<{ in_default: boolean }>(
      `SELECT in_default FROM catalog.partner_state WHERE partner_id = 'partner-1'`,
    );
    expect(row.rows[0]?.in_default).toBe(true);
  });
});

describe('D26 / D27 accord adossé à un plan approuvé, durée en mois', () => {
  async function rawC(
    plan: string,
    rhythm: string,
    minAmount: number,
    months: number | null,
    days: number | null,
  ): Promise<{ code: string | undefined; message: string }> {
    return catchFailure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO agreements.agreement
             (id, customer_id, model, offer_id, offer_version, partner_id, beneficiary_id,
              target_xaf, plan_id, rhythm, min_amount_xaf, duration_months, duration_days,
              refund_policy, terms_hash, created_at)
           VALUES ($1, $2, 'PLANNED_EXPENSE', NULL, NULL, NULL, 'landlord-1', 300000,
                   $3, $4, $5, $6, $7, 'FULL_NO_FEE', $8, now())`,
          [uuid(77), CUSTOMER_ID, plan, rhythm, minAmount, months, days, TERMS_HASH],
        ),
      ),
    );
  }

  it.each([
    ['un plan absent du registre', 'plan-inconnu', 'MONTHLY', 10_000, 4, null],
    ['un rythme différent du plan', 'plan-c', 'WEEKLY', 10_000, 4, null],
    ['un minimum différent du plan', 'plan-c', 'MONTHLY', 5_000, 4, null],
    ['une durée au-delà du plan', 'plan-c', 'MONTHLY', 10_000, 7, null],
    ['une durée en jours', 'plan-c', 'MONTHLY', 10_000, null, 120],
    ['un plan d’un autre modèle', 'plan-a', 'WEEKLY', 5_000, 4, null],
  ] as const)('la base refuse %s (AGREEMENT_PLAN_MISMATCH)', async (_label, plan, rhythm, min, months, days) => {
    const failure = await rawC(plan, rhythm, min, months, days);
    expect(failure.message).toMatch(/^AGREEMENT_PLAN_MISMATCH/);
  });

  it('accepte un accord conforme au plan, durée en mois', async () => {
    const id = await transact('app_rw', (client) => insertAgreementC(client, uuid(78)));
    const row = await admin.query<{ duration_months: number; duration_days: number | null }>(
      'SELECT duration_months, duration_days FROM agreements.agreement WHERE id = $1',
      [id],
    );
    expect(row.rows[0]).toEqual({ duration_months: 4, duration_days: null });
  });

  it('le store refuse un plan absent du registre (AGREEMENT_PLAN_MISMATCH)', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        createPlannedExpenseAgreement(client, {
          id: uuid(79),
          customerId: CUSTOMER_ID,
          beneficiaryId: 'landlord-1',
          targetXaf: 300_000n,
          planId: 'plan-inconnu',
          durationMonths: 4,
          createdAt: '2026-10-31T09:00:00.000Z',
        }),
      ),
    );
    expect(failure.code).toBe('AGREEMENT_PLAN_MISMATCH');
  });

  it('le store refuse une durée au-delà du plan (AGREEMENT_PLAN_MISMATCH)', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        createPlannedExpenseAgreement(client, {
          id: uuid(80),
          customerId: CUSTOMER_ID,
          beneficiaryId: 'landlord-1',
          targetXaf: 300_000n,
          planId: PLAN_C.planId,
          durationMonths: 7,
          createdAt: '2026-10-31T09:00:00.000Z',
        }),
      ),
    );
    expect(failure.code).toBe('AGREEMENT_PLAN_MISMATCH');
  });
});
