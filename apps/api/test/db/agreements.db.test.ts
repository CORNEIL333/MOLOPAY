import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalize, type JsonValue } from '@achat/chain';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOffer, publishOffer, type Offer } from '../../src/modules/catalog/domain';
import { appendOfferVersion } from '../../src/modules/catalog/offer.store';
import { createPartnerDossier, partnerDossierHash } from '../../src/modules/catalog/partner';
import {
  appendPartnerDossier,
  recordPartnerValidation,
} from '../../src/modules/catalog/partner.store';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  'db/migrations/0003_admin.sql',
  'db/migrations/0006_admin_clock.sql',
  'db/migrations/0008_catalog_partner.sql',
  'db/migrations/0009_catalog_offer.sql',
  'db/migrations/0011_agreements.sql',
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

/** Partenaire validé par maker-checker et offre publiée à 150 000 XAF (v1). */
async function seedCatalog(client: Client): Promise<void> {
  const stored = await appendPartnerDossier(
    client,
    createPartnerDossier({
      partnerId: 'partner-1',
      legalName: 'Électro Douala SARL',
      rccm: 'RC/DLA/2024/B/0001',
      niu: 'M000000000000A',
      representativeDocumentRef: 'kyc-doc-ref-0001',
      settlementAccountRef: 'settlement-ref-0001',
    }),
    'net-1',
  );
  const payload: Record<string, JsonValue> = {
    partner_id: 'partner-1',
    dossier_hash: partnerDossierHash(stored.dossier).toString('hex'),
  };
  const payloadHash = createHash('sha256').update(canonicalize(payload), 'utf8').digest();
  await client.query(
    `INSERT INTO admin.approval_request
       (id, kind, maker_id, payload, payload_hash, reason, prepared_at, expires_at)
     VALUES ($1, 'PARTNER_APPROVAL', 'net-1', $2::jsonb, $3, 'Onboarding partenaire',
             now(), now() + interval '1 day')`,
    [REQUEST_ID, JSON.stringify(payload), payloadHash],
  );
  await client.query(
    `INSERT INTO admin.approval_decision
       (request_id, decision, decided_by, decided_at, decision_reason)
     VALUES ($1, 'APPROVED', 'comp-1', now(), NULL)`,
    [REQUEST_ID],
  );
  await recordPartnerValidation(client, {
    partnerId: 'partner-1',
    dossierVersion: stored.version,
    decision: {
      id: REQUEST_ID,
      kind: 'PARTNER_APPROVAL',
      status: 'APPROVED',
      makerId: 'net-1',
      checkerId: 'comp-1',
      payload,
      payloadHash,
    },
  });
  await appendOfferVersion(client, offer(150_000n), 'net-1');
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
        target_xaf, plan_id, rhythm, min_amount_xaf, duration_days, refund_policy,
        terms_hash, created_at)
     VALUES ($1, $2, 'SAVE_THEN_BUY', $3, $4, $5, NULL, $6::bigint, 'plan-a',
             'WEEKLY', 5000, 90, 'FULL_NO_FEE', $7, '2000-01-01T00:00:00Z')`,
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
        target_xaf, plan_id, rhythm, min_amount_xaf, duration_days, refund_policy,
        terms_hash, created_at)
     VALUES ($1, $2, 'PLANNED_EXPENSE', NULL, NULL, NULL, 'landlord-1', 300000,
             'plan-c', 'MONTHLY', 10000, 120, 'FULL_NO_FEE', $3, now())`,
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
      options.from === 'DRAFT' &&
      options.to === 'ACTIVE');
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
              target_xaf, plan_id, rhythm, min_amount_xaf, duration_days, refund_policy,
              terms_hash, created_at)
           VALUES ($1, $2, 'PLANNED_EXPENSE', $3, 1, 'partner-1', 'landlord-1', 300000,
                   'plan-c', 'MONTHLY', 10000, 120, 'FULL_NO_FEE', $4, now())`,
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
              target_xaf, plan_id, rhythm, min_amount_xaf, duration_days, refund_policy,
              terms_hash, created_at)
           VALUES ($1, $2, 'PLANNED_EXPENSE', NULL, NULL, NULL, 'landlord-1', 300000,
                   'plan-c', 'MONTHLY', 10000, 120, 'FEE_10_PERCENT', $3, now())`,
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
    expect(failure.message).toContain('status_event_activation_signed');
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
