import { createHash } from 'node:crypto';
import { canonicalize, computeEntryHash, genesisPrevHash, type EntryContent, type JsonValue } from '@achat/chain';
import type { Client } from 'pg';
import {
  createPlannedExpenseAgreement,
  createSaveThenBuyAgreement,
} from '../../src/modules/agreements/agreement.store';
import { createOffer, publishOffer } from '../../src/modules/catalog/domain';
import { appendOfferVersion } from '../../src/modules/catalog/offer.store';
import { createPartnerDossier, partnerDossierHash } from '../../src/modules/catalog/partner';
import { appendPartnerDossier, recordPartnerValidation } from '../../src/modules/catalog/partner.store';
import {
  paymentPlanApprovalPayload,
  recordApprovedPaymentPlan,
  type PaymentPlanTerms,
} from '../../src/modules/catalog/payment-plan.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import {
  D43_KYC_LIMITS,
  KYC_LIMITS_SETTING_KEY,
  kycLimitsSettingValue,
  type KycLimits,
} from '../../src/modules/payments/kyc-limits';

/** Migrations nécessaires à un accord C, aux paiements et au grand livre. */
export const AGREEMENT_STACK_MIGRATIONS = [
  'db/migrations/0001_ledger.sql',
  'db/migrations/0002_audit.sql',
  'db/migrations/0004_identity.sql',
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
  'db/migrations/0026_payments_attempts.sql',
  'db/migrations/0027_payments_confirmation.sql',
  'db/migrations/0028_payments_entry_agreement.sql',
  'db/migrations/0029_agreements_funded.sql',
  'db/migrations/0036_payments_kyc_limits.sql',
  'db/migrations/0018_notification_reminder_reservation.sql',
  'db/migrations/0019_notification_outbox.sql',
];

export const AGREEMENT_STACK_SCHEMAS = ['notifications', 'payments', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];

/** Plan C de test : mensuel, 10 000 FCFA minimum, 6 mois au plus. */
export const PLAN_C: PaymentPlanTerms = {
  planId: 'plan-c',
  model: 'PLANNED_EXPENSE',
  rhythm: 'MONTHLY',
  minAmountXaf: 10_000n,
  maxDurationMonths: 6,
};

/** Plan A de test : hebdomadaire, 5 000 FCFA minimum, 6 mois au plus. */
export const PLAN_A: PaymentPlanTerms = {
  planId: 'plan-a',
  model: 'SAVE_THEN_BUY',
  rhythm: 'WEEKLY',
  minAmountXaf: 5_000n,
  maxDurationMonths: 6,
};

/** D26 : inscrit un plan au registre par une demande PAYMENT_PLAN approuvée par un tiers. */
export async function seedPaymentPlan(client: Client, terms: PaymentPlanTerms): Promise<void> {
  const requestId = uuidv7();
  const payload = paymentPlanApprovalPayload(terms);
  const payloadHash = createHash('sha256').update(canonicalize(payload), 'utf8').digest();
  await client.query(
    `INSERT INTO admin.approval_request
       (id, kind, maker_id, payload, payload_hash, reason, prepared_at, expires_at)
     VALUES ($1, 'PAYMENT_PLAN', 'fin-1', $2::jsonb, $3, 'Plan de test', now(), now() + interval '1 day')`,
    [requestId, JSON.stringify(payload), payloadHash],
  );
  await client.query(
    `INSERT INTO admin.approval_decision (request_id, decision, decided_by, decided_at, decision_reason)
     VALUES ($1, 'APPROVED', 'comp-1', now(), NULL)`,
    [requestId],
  );
  await recordApprovedPaymentPlan(client, { terms, approvalRequestId: requestId });
}

/** Bailleur validé par maker-checker (même circuit que les tests du lot 10). */
export async function validateLandlord(client: Client, requestId: string): Promise<void> {
  await validatePartner(client, requestId, 'landlord-1', 'BENEFICIARY');
}

/** Marchand validé par maker-checker. */
export async function validateMerchant(client: Client, requestId: string, partnerId = 'merchant-1'): Promise<void> {
  await validatePartner(client, requestId, partnerId, 'MERCHANT');
}

async function validatePartner(
  client: Client,
  requestId: string,
  partnerId: string,
  partnerType: 'MERCHANT' | 'BENEFICIARY',
): Promise<void> {
  const stored = await appendPartnerDossier(
    client,
    createPartnerDossier({
      partnerId,
      partnerType,
      beneficiaryKind: partnerType === 'BENEFICIARY' ? 'LANDLORD' : null,
      legalName: 'Bailleur de test',
      rccm: 'RC/DLA/2024/B/0001',
      niu: 'M000000000000A',
      representativeDocumentRef: 'kyc-doc-ref-0001',
      settlementAccountRef: 'settlement-ref-0001',
    }),
    'net-1',
  );
  const payload: Record<string, JsonValue> = {
    partner_id: partnerId,
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
    partnerId,
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

/**
 * Accord C (300 000 FCFA vers landlord-1) créé par le store. S'il est
 * `active`, l'activation est posée avec une signature d'appareil factice :
 * la base n'en vérifie que la présence, la vérification Ed25519 relève du store.
 */
export async function createAgreementC(
  client: Client,
  options: { readonly id: string; readonly customerId: string; readonly active: boolean },
): Promise<void> {
  await createPlannedExpenseAgreement(client, {
    id: options.id,
    customerId: options.customerId,
    beneficiaryId: 'landlord-1',
    targetXaf: 300_000n,
    planId: PLAN_C.planId,
    durationMonths: 4,
    createdAt: '2026-11-01T09:00:00.000Z',
  });
  if (options.active) {
    await client.query(
      `INSERT INTO agreements.status_event
         (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
       VALUES ($1, 1, 'TRANSITION', 'DRAFT', 'ACTIVE', $2, $3, 'client-1', now())`,
      [options.id, uuidv7(), Buffer.alloc(64, 9)],
    );
  }
}

/** Genèse chaînée du grand livre (INT-HASH-001), posée par l'administrateur. */
export async function seedLedgerGenesis(admin: Client): Promise<void> {
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

/** Compte client en base identité avec son niveau KYC (posé par l'administrateur). */
export async function seedCustomerAccount(
  admin: Client,
  customerId: string,
  kycLevel: 'NONE' | 'BASIC' | 'STRONG',
): Promise<void> {
  const suffix = customerId.replace(/-/g, '').slice(-8).replace(/[a-f]/g, '1');
  await admin.query(
    `INSERT INTO identity.account (id, phone, phone_verified_at, kyc_level)
     VALUES ($1, $2, now(), $3)`,
    [customerId, `+2376${suffix}`, kycLevel],
  );
}

/**
 * D43 : publie les plafonds KYC par le circuit réel (FINANCIAL_SETTING
 * préparé par fin-1, approuvé par comp-1, publié par le préparateur).
 */
export async function publishKycLimits(admin: Client, limits: KycLimits = D43_KYC_LIMITS): Promise<void> {
  const requestId = uuidv7();
  const value = kycLimitsSettingValue(limits);
  const payload = { key: KYC_LIMITS_SETTING_KEY, value };
  const payloadHash = createHash('sha256').update(canonicalize(payload), 'utf8').digest();
  await admin.query(
    `INSERT INTO admin.approval_request
       (id, kind, maker_id, payload, payload_hash, reason, prepared_at, expires_at)
     VALUES ($1, 'FINANCIAL_SETTING', 'fin-1', $2::jsonb, $3, 'Plafonds KYC', now(), now() + interval '1 day')`,
    [requestId, JSON.stringify(payload), payloadHash],
  );
  await admin.query(
    `INSERT INTO admin.approval_decision (request_id, decision, decided_by, decided_at, decision_reason)
     VALUES ($1, 'APPROVED', 'comp-1', now(), NULL)`,
    [requestId],
  );
  await admin.query(
    `INSERT INTO admin.setting_version (key, version, value, created_by, created_at, approval_request_id)
     SELECT $1, COALESCE(max(version), 0) + 1, $2::jsonb, 'fin-1', now(), $3
       FROM admin.setting_version WHERE key = $1`,
    [KYC_LIMITS_SETTING_KEY, JSON.stringify(value), requestId],
  );
}

/** Offre publiée du marchand, modèle A, au prix donné (version 1). */
export async function publishOfferA(
  client: Client,
  options: { readonly offerId: string; readonly partnerId: string; readonly priceXaf: bigint },
): Promise<void> {
  const draft = createOffer({
    id: options.offerId,
    partner: { id: options.partnerId, status: 'VALIDATED' },
    universe: 'TECHNOLOGY',
    models: ['SAVE_THEN_BUY'],
    cityIds: ['douala'],
    priceXaf: options.priceXaf,
    availability: { kind: 'IN_STOCK', units: 3 },
    warranty: 'Garantie 12 mois',
    discountTerms: 'Aucune remise',
  });
  await appendOfferVersion(client, publishOffer(draft), 'net-1');
}

/** Accord A sur l'offre courante, activé (signature d'appareil posée en base). */
export async function createAgreementA(
  client: Client,
  options: { readonly id: string; readonly customerId: string; readonly offerId: string },
): Promise<void> {
  await createSaveThenBuyAgreement(client, {
    id: options.id,
    customerId: options.customerId,
    offerId: options.offerId,
    planId: PLAN_A.planId,
    durationMonths: 3,
    createdAt: '2026-11-01T09:00:00.000Z',
  });
  await client.query(
    `INSERT INTO agreements.status_event
       (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
     VALUES ($1, 1, 'TRANSITION', 'DRAFT', 'ACTIVE', $2, $3, 'client-1', now())`,
    [options.id, uuidv7(), Buffer.alloc(64, 9)],
  );
}

/** Publie un paramètre versionné par le circuit réel (FINANCIAL_SETTING, deux personnes). */
export async function publishSetting(admin: Client, key: string, value: JsonValue): Promise<void> {
  const requestId = uuidv7();
  const payload = { key, value };
  const payloadHash = createHash('sha256').update(canonicalize(payload), 'utf8').digest();
  await admin.query(
    `INSERT INTO admin.approval_request
       (id, kind, maker_id, payload, payload_hash, reason, prepared_at, expires_at)
     VALUES ($1, 'FINANCIAL_SETTING', 'fin-1', $2::jsonb, $3, 'Paramètre', now(), now() + interval '1 day')`,
    [requestId, JSON.stringify(payload), payloadHash],
  );
  await admin.query(
    `INSERT INTO admin.approval_decision (request_id, decision, decided_by, decided_at, decision_reason)
     VALUES ($1, 'APPROVED', 'comp-1', now(), NULL)`,
    [requestId],
  );
  await admin.query(
    `INSERT INTO admin.setting_version (key, version, value, created_by, created_at, approval_request_id)
     SELECT $1, COALESCE(max(version), 0) + 1, $2::jsonb, 'fin-1', now(), $3
       FROM admin.setting_version WHERE key = $1`,
    [key, JSON.stringify(value), requestId],
  );
}
