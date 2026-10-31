import { timingSafeEqual } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { type Partner } from './domain';
import {
  createPartnerDossier,
  partnerDossierHash,
  partnerFromValidation,
  validatePartner,
  BENEFICIARY_KINDS,
  type BeneficiaryKind,
  type PartnerApprovalDecision,
  type PartnerDossier,
  type PartnerType,
  type PartnerValidation,
} from './partner';

// Un Client ou un PoolClient suffit : le store n'utilise que `query`.
type SqlClient = Pick<PoolClient, 'query'>;

type DossierRow = {
  partner_id: string;
  version: number;
  partner_type: string;
  beneficiary_kind: string | null;
  legal_name: string;
  rccm: string;
  niu: string;
  representative_document_ref: string;
  settlement_account_ref: string;
  dossier_hash: Buffer;
};

type StateRow = {
  partner_id: string;
  dossier_version: number;
  status: string;
  partner_type: string;
  beneficiary_kind: string | null;
  approval_request_id: string | null;
  validated_at: Date | null;
};

export type StoredPartnerDossier = {
  readonly dossier: PartnerDossier;
  readonly version: number;
};

/**
 * Ajoute une version du dossier. La base attribue l'horodatage et refuse une
 * version qui ne suit pas la précédente (écritures concurrentes incluses).
 */
export async function appendPartnerDossier(
  client: SqlClient,
  input: PartnerDossier,
  createdBy: string,
): Promise<StoredPartnerDossier> {
  const dossier = createPartnerDossier(input);
  const result = await client.query<{ version: number }>(
    `INSERT INTO catalog.partner_dossier
       (partner_id, version, partner_type, beneficiary_kind, legal_name, rccm, niu,
        representative_document_ref, settlement_account_ref,
        dossier_hash, created_by, created_at)
     SELECT $1, COALESCE(max(version), 0) + 1, $9, $10, $2, $3, $4, $5, $6, $7, $8, now()
     FROM catalog.partner_dossier WHERE partner_id = $1
     RETURNING version`,
    [
      dossier.partnerId,
      dossier.legalName,
      dossier.rccm,
      dossier.niu,
      dossier.representativeDocumentRef,
      dossier.settlementAccountRef,
      partnerDossierHash(dossier),
      createdBy,
      dossier.partnerType,
      dossier.beneficiaryKind,
    ],
  );
  const version = result.rows[0]?.version;
  if (version === undefined) {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'Dossier non enregistré');
  }
  return { dossier, version };
}

/** Relit un dossier et vérifie que l'empreinte stockée correspond aux champs. */
export async function getPartnerDossier(
  client: SqlClient,
  partnerId: string,
  version: number,
): Promise<StoredPartnerDossier | null> {
  const result = await client.query<DossierRow>(
    `SELECT partner_id, version, partner_type, beneficiary_kind, legal_name, rccm, niu,
            representative_document_ref, settlement_account_ref, dossier_hash
     FROM catalog.partner_dossier
     WHERE partner_id = $1 AND version = $2`,
    [partnerId, version],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  const dossier = createPartnerDossier({
    partnerId: row.partner_id,
    partnerType: row.partner_type as PartnerType,
    beneficiaryKind: row.beneficiary_kind as BeneficiaryKind | null,
    legalName: row.legal_name,
    rccm: row.rccm,
    niu: row.niu,
    representativeDocumentRef: row.representative_document_ref,
    settlementAccountRef: row.settlement_account_ref,
  });
  const expected = partnerDossierHash(dossier);
  if (
    row.dossier_hash.length !== expected.length ||
    !timingSafeEqual(row.dossier_hash, expected)
  ) {
    throw new BusinessError(
      'CATALOG_INVALID_REQUEST',
      'Empreinte du dossier stocké incohérente',
    );
  }
  return { dossier, version: row.version };
}

/**
 * Enregistre la validation du dossier courant. Le domaine vérifie la décision
 * avant l'écriture ; le déclencheur la revérifie contre les tables admin et
 * ancre `validated_at` sur l'horloge du serveur.
 */
export async function recordPartnerValidation(
  client: SqlClient,
  input: {
    readonly partnerId: string;
    readonly dossierVersion: number;
    readonly decision: PartnerApprovalDecision;
  },
): Promise<PartnerValidation> {
  const stored = await getPartnerDossier(
    client,
    input.partnerId,
    input.dossierVersion,
  );
  if (stored === null) {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'Dossier absent');
  }
  const checked = validatePartner({
    dossier: stored.dossier,
    decision: input.decision,
    validatedAt: new Date().toISOString(),
  });
  const result = await client.query<{ validated_at: Date }>(
    `INSERT INTO catalog.partner_validation
       (partner_id, dossier_version, approval_request_id, validated_at)
     VALUES ($1, $2, $3, now())
     RETURNING validated_at`,
    [checked.partnerId, stored.version, checked.requestId],
  );
  const validatedAt = result.rows[0]?.validated_at;
  if (validatedAt === undefined) {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'Validation non enregistrée');
  }
  return { ...checked, validatedAt: validatedAt.toISOString() };
}

/** Statut du partenaire dérivé de la base ; inconnu = null. */
export async function getPartner(
  client: SqlClient,
  partnerId: string,
): Promise<Partner | null> {
  const result = await client.query<StateRow>(
    `SELECT partner_id, dossier_version, status, partner_type, beneficiary_kind,
            approval_request_id, validated_at
     FROM catalog.partner_state WHERE partner_id = $1`,
    [partnerId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  if (row.status === 'PENDING') {
    return partnerFromValidation(row.partner_id, null);
  }
  if (
    row.status !== 'VALIDATED' ||
    row.approval_request_id === null ||
    row.validated_at === null
  ) {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'Statut partenaire inconnu');
  }
  return partnerFromValidation(row.partner_id, {
    partnerId: row.partner_id,
    dossierHash: '',
    requestId: row.approval_request_id,
    validatedAt: row.validated_at.toISOString(),
  });
}

export type Beneficiary = {
  readonly id: string;
  readonly kind: BeneficiaryKind;
  /** VERIFIED si le dossier courant est validé par maker-checker (F-PLN-001). */
  readonly status: 'VERIFIED' | 'PENDING';
};

/**
 * Bénéficiaire du modèle C : partenaire de type BENEFICIARY. Un marchand ou un
 * partenaire inconnu n'est pas un bénéficiaire (null).
 */
export async function getBeneficiary(
  client: SqlClient,
  partnerId: string,
): Promise<Beneficiary | null> {
  const result = await client.query<StateRow>(
    `SELECT partner_id, dossier_version, status, partner_type, beneficiary_kind,
            approval_request_id, validated_at
     FROM catalog.partner_state WHERE partner_id = $1`,
    [partnerId],
  );
  const row = result.rows[0];
  if (row === undefined || row.partner_type !== 'BENEFICIARY') {
    return null;
  }
  const kind = row.beneficiary_kind;
  if (kind === null || !(BENEFICIARY_KINDS as readonly string[]).includes(kind)) {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'Catégorie de bénéficiaire inconnue');
  }
  if (row.status !== 'VALIDATED' && row.status !== 'PENDING') {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'Statut partenaire inconnu');
  }
  return {
    id: row.partner_id,
    kind: kind as BeneficiaryKind,
    status: row.status === 'VALIDATED' ? 'VERIFIED' : 'PENDING',
  };
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACTOR_ID = /^[^\s]{1,200}$/;

export type MerchantDefault = {
  readonly id: string;
  readonly partnerId: string;
  readonly reason: string;
  readonly reportedBy: string;
  readonly recordedAt: string;
};

/**
 * Trace une défaillance marchand au registre des partenaires (F-SAV-006).
 * Effet uniquement restrictif ; la base refuse un doublon, un partenaire
 * inconnu ou un bénéficiaire, et ancre l'horodatage.
 */
export async function recordMerchantDefault(
  client: SqlClient,
  input: {
    readonly id: string;
    readonly partnerId: string;
    readonly reason: string;
    readonly reportedBy: string;
  },
): Promise<MerchantDefault> {
  if (!UUID_V7.test(input.id)) {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'id doit être un UUID v7');
  }
  if (!ACTOR_ID.test(input.reportedBy)) {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'reportedBy invalide');
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length === 0 || reason.length > 500 || reason !== input.reason) {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'Motif obligatoire (500 caractères max)');
  }
  const result = await client.query<{ created_at: Date }>(
    `INSERT INTO catalog.partner_incident
       (id, partner_id, kind, reason, reported_by, created_at)
     VALUES ($1, $2, 'MERCHANT_DEFAULT', $3, $4, now())
     RETURNING created_at`,
    [input.id, input.partnerId, reason, input.reportedBy],
  );
  const recordedAt = result.rows[0]?.created_at;
  if (recordedAt === undefined) {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'Incident non enregistré');
  }
  return {
    id: input.id,
    partnerId: input.partnerId,
    reason,
    reportedBy: input.reportedBy,
    recordedAt: recordedAt.toISOString(),
  };
}
