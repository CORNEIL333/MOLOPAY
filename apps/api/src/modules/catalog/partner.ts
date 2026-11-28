import { createHash, timingSafeEqual } from 'node:crypto';
import { canonicalize, type JsonValue } from '@achat/chain';
import { BusinessError, type ErrorCode } from '@achat/contracts';
import { type Partner } from './domain';

const PARTNER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,199}$/;
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC_MS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HASH_HEX_PATTERN = /^[0-9a-f]{64}$/;
const MAX_LEGAL_NAME_LENGTH = 200;

// CDC_05 § 4 : un partenaire est un marchand ou un bénéficiaire (modèle C).
export const PARTNER_TYPES = ['MERCHANT', 'BENEFICIARY'] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

// F-PLN-001 : bailleur, agence, école, vendeur de matériaux ou de terrain.
export const BENEFICIARY_KINDS = [
  'LANDLORD',
  'AGENCY',
  'SCHOOL',
  'MATERIALS_SELLER',
  'LAND_SELLER',
] as const;
export type BeneficiaryKind = (typeof BENEFICIARY_KINDS)[number];

/**
 * Dossier d'onboarding (F-PRT-001). Les pièces ne transitent jamais ici :
 * seules des références opaques vers le stockage KYC et vers les coordonnées
 * de règlement détenues par l'établissement sont conservées.
 */
export type PartnerDossierInput = {
  readonly partnerId: string;
  readonly partnerType: PartnerType;
  /** Catégorie d’un bénéficiaire ; `null` pour un marchand. */
  readonly beneficiaryKind: BeneficiaryKind | null;
  readonly legalName: string;
  readonly rccm: string;
  readonly niu: string;
  readonly representativeDocumentRef: string;
  readonly settlementAccountRef: string;
};

export type PartnerDossier = PartnerDossierInput;

/**
 * Vue structurelle d'une demande maker-checker du module admin. Le catalogue
 * n'importe pas `admin` (frontières de modules) : l'adaptateur lui transmet la
 * demande telle que lue, et ce module revérifie tout ce dont il dépend.
 */
export type PartnerApprovalDecision = {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly makerId: string;
  readonly checkerId: string | null;
  readonly payload: Readonly<Record<string, JsonValue>>;
  readonly payloadHash: Buffer;
};

export type PartnerValidation = {
  readonly partnerId: string;
  readonly dossierHash: string;
  readonly requestId: string;
  readonly validatedAt: string;
};

const DOSSIER_KEYS: ReadonlySet<string> = new Set([
  'partnerId',
  'partnerType',
  'beneficiaryKind',
  'legalName',
  'rccm',
  'niu',
  'representativeDocumentRef',
  'settlementAccountRef',
]);

const APPROVAL_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  'partner_id',
  'dossier_hash',
]);

function fail(code: ErrorCode, message: string): never {
  throw new BusinessError(code, message);
}

function assertMatches(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('CATALOG_INVALID_REQUEST', `${field} invalide`);
  }
  return value;
}

function assertLegalName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value !== value.trim() ||
    value.length > MAX_LEGAL_NAME_LENGTH
  ) {
    fail('CATALOG_INVALID_REQUEST', 'legalName invalide');
  }
  return value;
}

export function createPartnerDossier(input: PartnerDossierInput): PartnerDossier {
  for (const key of Object.keys(input)) {
    if (!DOSSIER_KEYS.has(key)) {
      fail('CATALOG_FIELD_FORBIDDEN', `Champ de dossier non autorisé: ${key}`);
    }
  }
  const partnerType = input.partnerType;
  if (!(PARTNER_TYPES as readonly unknown[]).includes(partnerType)) {
    fail('CATALOG_INVALID_REQUEST', 'partnerType invalide');
  }
  const beneficiaryKind = input.beneficiaryKind;
  const kindValid =
    partnerType === 'BENEFICIARY'
      ? (BENEFICIARY_KINDS as readonly unknown[]).includes(beneficiaryKind)
      : beneficiaryKind === null;
  if (!kindValid) {
    fail('CATALOG_INVALID_REQUEST', 'beneficiaryKind incohérent avec partnerType');
  }
  return Object.freeze({
    partnerId: assertMatches(input.partnerId, PARTNER_ID_PATTERN, 'partnerId'),
    partnerType,
    beneficiaryKind,
    legalName: assertLegalName(input.legalName),
    rccm: assertMatches(input.rccm, REFERENCE_PATTERN, 'rccm'),
    niu: assertMatches(input.niu, REFERENCE_PATTERN, 'niu'),
    representativeDocumentRef: assertMatches(
      input.representativeDocumentRef,
      REFERENCE_PATTERN,
      'representativeDocumentRef',
    ),
    settlementAccountRef: assertMatches(
      input.settlementAccountRef,
      REFERENCE_PATTERN,
      'settlementAccountRef',
    ),
  });
}

/** Empreinte SHA-256 du dossier canonisé (RFC 8785), liée à l'approbation. */
export function partnerDossierHash(dossier: PartnerDossier): Buffer {
  const checked = createPartnerDossier(dossier);
  return createHash('sha256')
    .update(canonicalize({ ...checked }), 'utf8')
    .digest();
}

/**
 * Valide un partenaire à partir d'une demande PARTNER_APPROVAL approuvée qui
 * porte l'empreinte exacte du dossier : un dossier modifié après approbation
 * exige une nouvelle décision.
 */
export function validatePartner(input: {
  readonly dossier: PartnerDossier;
  readonly decision: PartnerApprovalDecision;
  readonly validatedAt: string;
}): PartnerValidation {
  const { decision } = input;
  if (
    typeof input.validatedAt !== 'string' ||
    !ISO_UTC_MS_PATTERN.test(input.validatedAt) ||
    Number.isNaN(new Date(input.validatedAt).getTime()) ||
    new Date(input.validatedAt).toISOString() !== input.validatedAt
  ) {
    fail('CATALOG_INVALID_REQUEST', 'validatedAt doit être ISO 8601 UTC');
  }
  assertMatches(decision.id, UUID_V7_PATTERN, 'requestId');
  if (decision.kind !== 'PARTNER_APPROVAL' || decision.status !== 'APPROVED') {
    fail(
      'CATALOG_PARTNER_NOT_VALIDATED',
      'Une demande PARTNER_APPROVAL approuvée est requise',
    );
  }
  if (decision.checkerId === null || decision.checkerId === decision.makerId) {
    fail('MAKER_CANNOT_APPROVE', 'Le préparateur ne peut pas approuver');
  }
  for (const key of Object.keys(decision.payload)) {
    if (!APPROVAL_PAYLOAD_KEYS.has(key)) {
      fail('CATALOG_FIELD_FORBIDDEN', `Champ approuvé non autorisé: ${key}`);
    }
  }
  let payloadHash: Buffer;
  try {
    payloadHash = createHash('sha256')
      .update(canonicalize(decision.payload), 'utf8')
      .digest();
  } catch {
    fail('CATALOG_INVALID_REQUEST', 'Charge approuvée non canonisable');
  }
  if (
    !Buffer.isBuffer(decision.payloadHash) ||
    payloadHash.length !== decision.payloadHash.length ||
    !timingSafeEqual(payloadHash, decision.payloadHash)
  ) {
    fail('CATALOG_INVALID_REQUEST', 'La charge approuvée a été altérée');
  }
  const dossierHash = partnerDossierHash(input.dossier).toString('hex');
  const approvedHash = decision.payload['dossier_hash'];
  if (
    decision.payload['partner_id'] !== input.dossier.partnerId ||
    typeof approvedHash !== 'string' ||
    !HASH_HEX_PATTERN.test(approvedHash) ||
    approvedHash !== dossierHash
  ) {
    fail(
      'CATALOG_PARTNER_NOT_VALIDATED',
      'L’approbation ne porte pas sur ce dossier',
    );
  }
  return Object.freeze({
    partnerId: input.dossier.partnerId,
    dossierHash,
    requestId: decision.id,
    validatedAt: input.validatedAt,
  });
}

/**
 * Statut dérivé : un partenaire n'est VALIDATED que s'il existe une validation
 * qui le concerne ; sinon il reste PENDING et donc invisible du catalogue.
 */
export function partnerFromValidation(
  partnerId: string,
  validation: PartnerValidation | null,
): Partner {
  assertMatches(partnerId, PARTNER_ID_PATTERN, 'partnerId');
  if (validation === null) {
    return Object.freeze({ id: partnerId, status: 'PENDING' as const });
  }
  if (validation.partnerId !== partnerId) {
    fail('CATALOG_INVALID_REQUEST', 'Validation d’un autre partenaire');
  }
  return Object.freeze({ id: partnerId, status: 'VALIDATED' as const });
}
