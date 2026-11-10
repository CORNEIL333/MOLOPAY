import { createHash } from 'node:crypto';
import { canonicalize, computeEntryHash, genesisPrevHash, type EntryContent, type JsonValue } from '@achat/chain';
import type { Client } from 'pg';
import { createPlannedExpenseAgreement } from '../../src/modules/agreements/agreement.store';
import { createPartnerDossier, partnerDossierHash } from '../../src/modules/catalog/partner';
import { appendPartnerDossier, recordPartnerValidation } from '../../src/modules/catalog/partner.store';
import { uuidv7 } from '../../src/modules/ledger/domain';

/** Migrations nécessaires à un accord C, aux paiements et au grand livre. */
export const AGREEMENT_STACK_MIGRATIONS = [
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
];

export const AGREEMENT_STACK_SCHEMAS = ['payments', 'agreements', 'catalog', 'admin', 'audit', 'ledger'];

/** Bailleur validé par maker-checker (même circuit que les tests du lot 10). */
export async function validateLandlord(client: Client, requestId: string): Promise<void> {
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
