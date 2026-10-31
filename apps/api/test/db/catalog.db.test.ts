import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalize, type JsonValue } from '@achat/chain';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createOffer,
  publishOffer,
  type Offer,
  type OfferInput,
} from '../../src/modules/catalog/domain';
import {
  appendOfferVersion,
  getCurrentOffer,
  listVisibleOffers,
} from '../../src/modules/catalog/offer.store';
import {
  createPartnerDossier,
  partnerDossierHash,
  type PartnerApprovalDecision,
  type PartnerDossier,
} from '../../src/modules/catalog/partner';
import {
  appendPartnerDossier,
  getBeneficiary,
  getPartner,
  recordPartnerValidation,
} from '../../src/modules/catalog/partner.store';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  'db/migrations/0003_admin.sql',
  'db/migrations/0006_admin_clock.sql',
  'db/migrations/0008_catalog_partner.sql',
  'db/migrations/0009_catalog_offer.sql',
  'db/migrations/0011_agreements.sql',
  'db/migrations/0012_agreements_customer_signature.sql',
  'db/migrations/0013_partner_type_beneficiary.sql',
  'db/migrations/0014_partner_incident.sql',
  'db/migrations/0015_partner_default_lift.sql',
].map((path) => resolve(process.cwd(), path));

const PREPARED_AT = '2026-10-27T08:00:00.000Z';
const EXPIRES_AT = '2026-10-28T08:00:00.000Z';

let container: TestDatabase;
let admin: Client;
let migrationSql: string[];

function uuid(seq: number): string {
  return `019a9000-0000-7000-8000-${seq.toString().padStart(12, '0')}`;
}

function dossier(overrides: Partial<PartnerDossier> = {}): PartnerDossier {
  return createPartnerDossier({
    partnerId: 'partner-1',
    partnerType: 'MERCHANT',
    beneficiaryKind: null,
    legalName: 'Électro Douala SARL',
    rccm: 'RC/DLA/2024/B/0001',
    niu: 'M000000000000A',
    representativeDocumentRef: 'kyc-doc-ref-0001',
    settlementAccountRef: 'settlement-ref-0001',
    ...overrides,
  });
}

function approvalPayload(target: PartnerDossier): Record<string, JsonValue> {
  return {
    partner_id: target.partnerId,
    dossier_hash: partnerDossierHash(target).toString('hex'),
  };
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

/** Crée une demande et sa décision ; renvoie la vue structurelle attendue. */
async function approve(
  client: Client,
  options: {
    readonly id: string;
    readonly payload: Record<string, JsonValue>;
    readonly kind?: string;
    readonly decision?: 'APPROVED' | 'REJECTED';
  },
): Promise<PartnerApprovalDecision> {
  const payloadHash = createHash('sha256')
    .update(canonicalize(options.payload), 'utf8')
    .digest();
  await client.query(
    `INSERT INTO admin.approval_request
       (id, kind, maker_id, payload, payload_hash, reason, prepared_at, expires_at)
     VALUES ($1, $2, 'net-1', $3::jsonb, $4, 'Onboarding partenaire', $5, $6)`,
    [
      options.id,
      options.kind ?? 'PARTNER_APPROVAL',
      JSON.stringify(options.payload),
      payloadHash,
      PREPARED_AT,
      EXPIRES_AT,
    ],
  );
  const decision = options.decision ?? 'APPROVED';
  await client.query(
    `INSERT INTO admin.approval_decision
       (request_id, decision, decided_by, decided_at, decision_reason)
     VALUES ($1, $2, 'comp-1', now(), $3)`,
    [options.id, decision, decision === 'REJECTED' ? 'Dossier incomplet' : null],
  );
  return {
    id: options.id,
    kind: options.kind ?? 'PARTNER_APPROVAL',
    status: decision,
    makerId: 'net-1',
    checkerId: 'comp-1',
    payload: options.payload,
    payloadHash,
  };
}

async function insertValidation(
  client: Client,
  requestId: string,
  dossierVersion = 1,
): Promise<void> {
  await client.query(
    `INSERT INTO catalog.partner_validation
       (partner_id, dossier_version, approval_request_id, validated_at)
     VALUES ('partner-1', $1, $2, '2000-01-01T00:00:00Z')`,
    [dossierVersion, requestId],
  );
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
});

describe('F-PRT-001 · onboarding partenaire (PostgreSQL réel)', () => {
  it('F-PRT-001 un partenaire avec dossier non validé est PENDING', async () => {
    await transact('app_rw', (client) => appendPartnerDossier(client, dossier(), 'net-1'));
    const partner = await transact('app_ro', (client) => getPartner(client, 'partner-1'));
    expect(partner).toEqual({ id: 'partner-1', status: 'PENDING' });
  });

  it('F-PRT-001 valide après approbation maker-checker du dossier exact', async () => {
    const validation = await transact('app_rw', async (client) => {
      const stored = await appendPartnerDossier(client, dossier(), 'net-1');
      const decision = await approve(client, {
        id: uuid(1),
        payload: approvalPayload(stored.dossier),
      });
      return recordPartnerValidation(client, {
        partnerId: 'partner-1',
        dossierVersion: stored.version,
        decision,
      });
    });
    expect(validation.requestId).toBe(uuid(1));
    const partner = await transact('app_ro', (client) => getPartner(client, 'partner-1'));
    expect(partner).toEqual({ id: 'partner-1', status: 'VALIDATED' });
  });

  it('F-PRT-001 ancre created_at et validated_at sur l’horloge serveur', async () => {
    await transact('app_rw', async (client) => {
      await client.query(
        `INSERT INTO catalog.partner_dossier
           (partner_id, version, partner_type, legal_name, rccm, niu,
            representative_document_ref, settlement_account_ref,
            dossier_hash, created_by, created_at)
         VALUES ('partner-1', 1, 'MERCHANT', 'Électro Douala SARL', 'RC/DLA/2024/B/0001',
                 'M000000000000A', 'kyc-doc-ref-0001', 'settlement-ref-0001',
                 $1, 'net-1', '2000-01-01T00:00:00Z')`,
        [partnerDossierHash(dossier())],
      );
      await approve(client, { id: uuid(1), payload: approvalPayload(dossier()) });
      await insertValidation(client, uuid(1));
    });
    const rows = await admin.query<{ created_at: Date; validated_at: Date }>(
      `SELECT d.created_at, v.validated_at
       FROM catalog.partner_dossier d
       JOIN catalog.partner_validation v USING (partner_id)`,
    );
    expect(rows.rows[0]?.created_at.getUTCFullYear()).toBeGreaterThan(2000);
    expect(rows.rows[0]?.validated_at.getUTCFullYear()).toBeGreaterThan(2000);
  });

  it('F-PRT-001 refuse une validation sur demande rejetée', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await appendPartnerDossier(client, dossier(), 'net-1');
        await approve(client, {
          id: uuid(1),
          payload: approvalPayload(dossier()),
          decision: 'REJECTED',
        });
        await insertValidation(client, uuid(1));
      }),
    );
    expect(failure.message).toContain('CATALOG_PARTNER_NOT_VALIDATED');
  });

  it('F-PRT-001 refuse une demande approuvée d’un autre type', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await appendPartnerDossier(client, dossier(), 'net-1');
        await approve(client, {
          id: uuid(1),
          kind: 'FINANCIAL_SETTING',
          payload: approvalPayload(dossier()),
        });
        await insertValidation(client, uuid(1));
      }),
    );
    expect(failure.message).toContain('CATALOG_PARTNER_NOT_VALIDATED');
  });

  it('F-PRT-001 refuse une charge approuvée hors liste blanche', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await appendPartnerDossier(client, dossier(), 'net-1');
        await approve(client, {
          id: uuid(1),
          payload: { ...approvalPayload(dossier()), status: 'VALIDATED' },
        });
        await insertValidation(client, uuid(1));
      }),
    );
    expect(failure.message).toContain('CATALOG_FIELD_FORBIDDEN');
  });

  it('F-PRT-001 refuse une approbation portant sur une autre empreinte', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await appendPartnerDossier(client, dossier(), 'net-1');
        await approve(client, {
          id: uuid(1),
          payload: approvalPayload(dossier({ settlementAccountRef: 'settlement-ref-0002' })),
        });
        await insertValidation(client, uuid(1));
      }),
    );
    expect(failure.message).toContain('CATALOG_PARTNER_NOT_VALIDATED');
  });

  it('F-PRT-001 un dossier modifié après validation repasse PENDING', async () => {
    await transact('app_rw', async (client) => {
      const stored = await appendPartnerDossier(client, dossier(), 'net-1');
      const decision = await approve(client, {
        id: uuid(1),
        payload: approvalPayload(stored.dossier),
      });
      await recordPartnerValidation(client, {
        partnerId: 'partner-1',
        dossierVersion: stored.version,
        decision,
      });
      await appendPartnerDossier(
        client,
        dossier({ settlementAccountRef: 'settlement-ref-0002' }),
        'net-1',
      );
    });
    const partner = await transact('app_ro', (client) => getPartner(client, 'partner-1'));
    expect(partner).toEqual({ id: 'partner-1', status: 'PENDING' });
  });

  it('F-PRT-001 refuse de valider une version remplacée', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await appendPartnerDossier(client, dossier(), 'net-1');
        await appendPartnerDossier(
          client,
          dossier({ settlementAccountRef: 'settlement-ref-0002' }),
          'net-1',
        );
        await approve(client, { id: uuid(1), payload: approvalPayload(dossier()) });
        await insertValidation(client, uuid(1), 1);
      }),
    );
    expect(failure.message).toContain('CATALOG_PARTNER_NOT_VALIDATED');
  });

  it('F-PRT-002 refuse une version de dossier non consécutive', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await client.query(
          `INSERT INTO catalog.partner_dossier
             (partner_id, version, legal_name, rccm, niu,
              representative_document_ref, settlement_account_ref,
              dossier_hash, created_by, created_at)
           VALUES ('partner-1', 2, 'X', 'R', 'N', 'K', 'S', $1, 'net-1', now())`,
          [Buffer.alloc(32, 1)],
        );
      }),
    );
    expect(failure.message).toContain('CATALOG_INVALID_REQUEST');
  });

  it('SEC-AUTHZ-003 une même approbation ne valide qu’une fois', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await appendPartnerDossier(client, dossier(), 'net-1');
        await approve(client, { id: uuid(1), payload: approvalPayload(dossier()) });
        await insertValidation(client, uuid(1));
        await insertValidation(client, uuid(1));
      }),
    );
    expect(failure.code).toBe('23505');
  });

  it('F-PRT-002 dossiers et validations sont en ajout seul', async () => {
    await transact('app_rw', async (client) => {
      await appendPartnerDossier(client, dossier(), 'net-1');
      await approve(client, { id: uuid(1), payload: approvalPayload(dossier()) });
      await insertValidation(client, uuid(1));
    });
    for (const statement of [
      "UPDATE catalog.partner_dossier SET settlement_account_ref = 'pirate'",
      'DELETE FROM catalog.partner_validation',
    ]) {
      const asApp = await catchFailure(() =>
        transact('app_rw', (client) => client.query(statement)),
      );
      expect(asApp.code).toBe('42501');
      const asOwner = await catchFailure(() => admin.query(statement));
      expect(asOwner.message).toContain('CATALOG_APPEND_ONLY');
    }
    const truncate = await catchFailure(() =>
      admin.query('TRUNCATE catalog.partner_validation'),
    );
    expect(truncate.message).toContain('CATALOG_APPEND_ONLY');
  });
});

const OFFER_ID = '019a9000-0000-7000-8000-0000000000f1';
const BIG_PRICE = 9_007_199_254_740_993n;

function draftOffer(overrides: Partial<OfferInput> = {}): Offer {
  return createOffer({
    id: OFFER_ID,
    partner: { id: 'partner-1', status: 'VALIDATED' },
    universe: 'TECHNOLOGY',
    models: ['SAVE_THEN_BUY'],
    cityIds: ['douala'],
    priceXaf: 150_000n,
    availability: { kind: 'IN_STOCK', units: 3 },
    warranty: 'Garantie 12 mois',
    discountTerms: 'Remise de 5 % dès 50 % versés',
    ...overrides,
  });
}

async function validatePartner1(client: Client): Promise<void> {
  const stored = await appendPartnerDossier(client, dossier(), 'net-1');
  const decision = await approve(client, {
    id: uuid(1),
    payload: approvalPayload(stored.dossier),
  });
  await recordPartnerValidation(client, {
    partnerId: 'partner-1',
    dossierVersion: stored.version,
    decision,
  });
}

async function insertRawOffer(client: Client): Promise<void> {
  await client.query(
    `INSERT INTO catalog.offer (id, partner_id, created_at)
     VALUES ($1, 'partner-1', now())`,
    [OFFER_ID],
  );
}

async function insertRawVersion(
  client: Client,
  options: {
    readonly version?: number;
    readonly state?: string;
    readonly models?: readonly string[];
  },
): Promise<void> {
  await client.query(
    `INSERT INTO catalog.offer_version
       (offer_id, version, universe, models, city_ids, price_xaf,
        availability_kind, stock_units, lead_days, warranty, discount_terms,
        state, created_by, created_at)
     VALUES ($1, $2, 'TECHNOLOGY', $3::text[], ARRAY['douala'], 150000,
             'IN_STOCK', 3, NULL, 'Garantie', 'Remise', $4, 'net-1', now())`,
    [
      OFFER_ID,
      options.version ?? 1,
      options.models ?? ['SAVE_THEN_BUY'],
      options.state ?? 'DRAFT',
    ],
  );
}

describe('F-PRT-002 · offres versionnées (PostgreSQL réel)', () => {
  it('F-PRT-001 une offre d’un partenaire non validé reste invisible', async () => {
    await transact('app_rw', async (client) => {
      await appendPartnerDossier(client, dossier(), 'net-1');
      await appendOfferVersion(client, draftOffer(), 'net-1');
    });
    const visible = await transact('app_ro', (client) => listVisibleOffers(client));
    expect(visible).toEqual([]);
    const current = await transact('app_ro', (client) => getCurrentOffer(client, OFFER_ID));
    expect(current?.offer.state).toBe('DRAFT');
    expect(current?.offer.partner.status).toBe('PENDING');
  });

  it('F-CAT-001 la base refuse la publication pour un partenaire non validé', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await appendPartnerDossier(client, dossier(), 'net-1');
        await insertRawOffer(client);
        await insertRawVersion(client, { state: 'PUBLISHED' });
      }),
    );
    expect(failure.message).toContain('CATALOG_PARTNER_NOT_VALIDATED');
  });

  it('F-CAT-004 une offre publiée d’un partenaire validé est visible et filtrable', async () => {
    await transact('app_rw', async (client) => {
      await validatePartner1(client);
      await appendOfferVersion(client, publishOffer(draftOffer()), 'net-1');
    });
    const visible = await transact('app_ro', (client) => listVisibleOffers(client));
    expect(visible.map((offer) => offer.id)).toEqual([OFFER_ID]);
    const yaounde = await transact('app_ro', (client) =>
      listVisibleOffers(client, { city: 'yaounde' }),
    );
    expect(yaounde).toEqual([]);
  });

  it('F-PRT-002 un changement de prix crée une version et conserve l’ancienne', async () => {
    await transact('app_rw', async (client) => {
      await validatePartner1(client);
      await appendOfferVersion(client, publishOffer(draftOffer()), 'net-1');
      await appendOfferVersion(
        client,
        publishOffer(draftOffer({ priceXaf: BIG_PRICE })),
        'net-1',
      );
    });
    const current = await transact('app_ro', (client) => getCurrentOffer(client, OFFER_ID));
    expect(current?.version).toBe(2);
    expect(current?.offer.priceXaf).toBe(BIG_PRICE);
    const history = await admin.query<{ version: number; price_xaf: string }>(
      `SELECT version, price_xaf::text AS price_xaf FROM catalog.offer_version
       WHERE offer_id = $1 ORDER BY version`,
      [OFFER_ID],
    );
    expect(history.rows).toEqual([
      { version: 1, price_xaf: '150000' },
      { version: 2, price_xaf: '9007199254740993' },
    ]);
  });

  it('F-PRT-001 un dossier modifié masque les offres déjà publiées', async () => {
    await transact('app_rw', async (client) => {
      await validatePartner1(client);
      await appendOfferVersion(client, publishOffer(draftOffer()), 'net-1');
      await appendPartnerDossier(
        client,
        dossier({ settlementAccountRef: 'settlement-ref-0002' }),
        'net-1',
      );
    });
    const visible = await transact('app_ro', (client) => listVisibleOffers(client));
    expect(visible).toEqual([]);
  });

  it('F-PRT-002 refuse qu’un autre partenaire versionne l’offre', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await appendOfferVersion(client, draftOffer(), 'net-1');
        await appendOfferVersion(
          client,
          draftOffer({ partner: { id: 'partner-2', status: 'VALIDATED' } }),
          'net-2',
        );
      }),
    );
    expect(failure.code).toBe('CATALOG_INVALID_REQUEST');
  });

  it('F-CAT-001 la base refuse un modèle dupliqué', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertRawOffer(client);
        await insertRawVersion(client, { models: ['SAVE_THEN_BUY', 'SAVE_THEN_BUY'] });
      }),
    );
    expect(failure.message).toContain('CATALOG_OFFER_INCOMPLETE');
  });

  it('F-PRT-002 refuse une version d’offre non consécutive', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', async (client) => {
        await insertRawOffer(client);
        await insertRawVersion(client, { version: 2 });
      }),
    );
    expect(failure.message).toContain('CATALOG_INVALID_REQUEST');
  });

  it('F-PRT-002 offres et versions sont en ajout seul', async () => {
    await transact('app_rw', (client) => appendOfferVersion(client, draftOffer(), 'net-1'));
    for (const statement of [
      'UPDATE catalog.offer_version SET price_xaf = 1',
      'DELETE FROM catalog.offer',
    ]) {
      const asApp = await catchFailure(() =>
        transact('app_rw', (client) => client.query(statement)),
      );
      expect(asApp.code).toBe('42501');
      const asOwner = await catchFailure(() => admin.query(statement));
      expect(asOwner.message).toContain('CATALOG_APPEND_ONLY');
    }
  });
});

function landlordDossier(): PartnerDossier {
  return dossier({
    partnerId: 'landlord-1',
    partnerType: 'BENEFICIARY',
    beneficiaryKind: 'LANDLORD',
  });
}

describe('F-PLN-001 · bénéficiaires vérifiés (PostgreSQL réel)', () => {
  it('F-PLN-001 un bénéficiaire est PENDING puis VERIFIED après maker-checker', async () => {
    await transact('app_rw', (client) => appendPartnerDossier(client, landlordDossier(), 'net-1'));
    const pending = await transact('app_ro', (client) => getBeneficiary(client, 'landlord-1'));
    expect(pending).toEqual({ id: 'landlord-1', kind: 'LANDLORD', status: 'PENDING' });
    await transact('app_rw', async (client) => {
      const decision = await approve(client, {
        id: uuid(50),
        payload: {
          partner_id: 'landlord-1',
          dossier_hash: partnerDossierHash(landlordDossier()).toString('hex'),
        },
      });
      await recordPartnerValidation(client, {
        partnerId: 'landlord-1',
        dossierVersion: 1,
        decision,
      });
    });
    const verified = await transact('app_ro', (client) => getBeneficiary(client, 'landlord-1'));
    expect(verified?.status).toBe('VERIFIED');
  });

  it('F-PLN-001 un marchand ou un inconnu n’est pas un bénéficiaire', async () => {
    await transact('app_rw', (client) => validatePartner1(client));
    expect(await transact('app_ro', (client) => getBeneficiary(client, 'partner-1'))).toBeNull();
    expect(await transact('app_ro', (client) => getBeneficiary(client, 'nobody'))).toBeNull();
  });

  it('CDC_05 refuse en base un type et une catégorie incohérents', async () => {
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO catalog.partner_dossier
             (partner_id, version, partner_type, beneficiary_kind, legal_name, rccm, niu,
              representative_document_ref, settlement_account_ref,
              dossier_hash, created_by, created_at)
           VALUES ('landlord-1', 1, 'BENEFICIARY', NULL, 'Bailleur', 'RC/1', 'M1',
                   'kyc-1', 'settlement-1', $1, 'net-1', now())`,
          [Buffer.alloc(32, 1)],
        ),
      ),
    );
    expect(failure.code).toBe('23514');
    expect(failure.message).toContain('partner_dossier_kind_matches_type');
  });

  it('F-PRT-002 refuse qu’un bénéficiaire validé publie une offre', async () => {
    await transact('app_rw', async (client) => {
      const stored = await appendPartnerDossier(
        client,
        dossier({ partnerType: 'BENEFICIARY', beneficiaryKind: 'MATERIALS_SELLER' }),
        'net-1',
      );
      const decision = await approve(client, {
        id: uuid(51),
        payload: approvalPayload(stored.dossier),
      });
      await recordPartnerValidation(client, {
        partnerId: 'partner-1',
        dossierVersion: stored.version,
        decision,
      });
    });
    const failure = await catchFailure(() =>
      transact('app_rw', (client) =>
        appendOfferVersion(client, publishOffer(draftOffer()), 'net-1'),
      ),
    );
    expect(failure.message).toContain('CATALOG_PARTNER_NOT_VALIDATED');
    expect(failure.message).toContain('marchand');
  });
});
