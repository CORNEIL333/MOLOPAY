import { createHash } from 'node:crypto';
import { canonicalize } from '@achat/chain';
import { BusinessError, type ErrorCode } from '@achat/contracts';
import { MAX_AMOUNT, toCanonicalString, xaf } from '@achat/money';

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC_MS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REF_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const MAX_DURATION_DAYS = 3660;

// Lot 10 : modèles A et C. Le modèle B (achat financé) relève du lot 13.
export const AGREEMENT_MODELS = ['SAVE_THEN_BUY', 'PLANNED_EXPENSE'] as const;
export type AgreementModel = (typeof AGREEMENT_MODELS)[number];

// F-SAV-001 : rythme quotidien, hebdomadaire, mensuel ou libre.
export const RHYTHMS = ['DAILY', 'WEEKLY', 'MONTHLY', 'FREE'] as const;
export type Rhythm = (typeof RHYTHMS)[number];

// F-SAV-005 / F-PLN-004 : seul le barème par défaut publié est connu
// (100 %, sans frais). Tout autre barème exige une décision (D27).
export const REFUND_POLICIES = ['FULL_NO_FEE'] as const;
export type RefundPolicy = (typeof REFUND_POLICIES)[number];

// CDC_05 § 5.2. `LOCKED` est un attribut, pas un état.
export const AGREEMENT_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'FUNDED',
  'HANDED_OVER',
  'PAID_TO_BENEFICIARY',
  'CANCELLED_BY_CUSTOMER',
  'DISPUTED',
  'FROZEN',
  'REFUNDED',
  'CLOSED',
] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

/** Instantané de l'offre lu côté serveur (structure du module catalog). */
export type OfferSnapshot = {
  readonly id: string;
  readonly version: number;
  readonly partnerId: string;
  readonly partnerStatus: string;
  readonly state: string;
  readonly models: readonly string[];
  readonly priceXaf: bigint;
};

/** Plan de paiement approuvé (CDC_05 § 4 : rythme, montant minimal, durée max). */
export type AgreementPlan = {
  readonly id: string;
  readonly model: string;
  readonly approved: boolean;
  readonly rhythm: string;
  readonly minAmountXaf: bigint;
  readonly maxDurationDays: number;
};

/** Bénéficiaire du modèle C, vérifié par la conformité (F-PLN-001). */
export type BeneficiarySnapshot = {
  readonly id: string;
  readonly status: string;
};

export type AgreementTerms = {
  readonly agreementId: string;
  readonly customerId: string;
  readonly model: AgreementModel;
  readonly offerId: string | null;
  readonly offerVersion: number | null;
  readonly partnerId: string | null;
  readonly beneficiaryId: string | null;
  readonly targetXaf: bigint;
  readonly planId: string;
  readonly rhythm: Rhythm;
  readonly minAmountXaf: bigint;
  readonly durationDays: number;
  readonly refundPolicy: RefundPolicy;
};

export type Agreement = {
  readonly terms: AgreementTerms;
  /** Horodatage de création ; la base l’ancre sur son horloge, hors empreinte. */
  readonly createdAt: string;
  /** Empreinte SHA-256 (hex) de la forme canonique JCS des conditions. */
  readonly termsHash: string;
  readonly status: AgreementStatus;
  readonly locked: boolean;
  /** État d'origine d'un litige, seul état de retour autorisé. */
  readonly disputedFrom: 'ACTIVE' | 'FUNDED' | null;
};

export type CreateAgreementInput =
  | {
      readonly id: string;
      readonly customerId: string;
      readonly model: 'SAVE_THEN_BUY';
      readonly offer: OfferSnapshot;
      readonly plan: AgreementPlan;
      readonly durationDays: number;
      readonly createdAt: string;
    }
  | {
      readonly id: string;
      readonly customerId: string;
      readonly model: 'PLANNED_EXPENSE';
      readonly beneficiary: BeneficiarySnapshot;
      readonly targetXaf: bigint;
      readonly plan: AgreementPlan;
      readonly durationDays: number;
      readonly createdAt: string;
    };

function fail(code: ErrorCode, message: string): never {
  throw new BusinessError(code, message);
}

function assertUuidV7(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_V7_PATTERN.test(value)) {
    fail('AGREEMENT_INVALID_REQUEST', `${field} doit être un UUID v7`);
  }
  return value;
}

function assertRefId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !REF_ID_PATTERN.test(value)) {
    fail('AGREEMENT_INVALID_REQUEST', `${field} invalide`);
  }
  return value;
}

function assertIsoUtcMs(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !ISO_UTC_MS_PATTERN.test(value) ||
    Number.isNaN(new Date(value).getTime()) ||
    new Date(value).toISOString() !== value
  ) {
    fail('AGREEMENT_INVALID_REQUEST', `${field} doit être ISO 8601 UTC`);
  }
  return value;
}

function assertAmount(value: unknown, field: string): bigint {
  if (typeof value !== 'bigint' || value <= 0n || value > MAX_AMOUNT) {
    fail('AGREEMENT_INVALID_REQUEST', `${field} doit être un montant XAF positif`);
  }
  return xaf(value).amount;
}

function assertDuration(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_DURATION_DAYS
  ) {
    fail('AGREEMENT_INVALID_REQUEST', `${field} doit être un nombre de jours`);
  }
  return value;
}

function assertPlan(
  plan: AgreementPlan,
  model: AgreementModel,
  durationDays: number,
): { readonly rhythm: Rhythm; readonly minAmountXaf: bigint } {
  const planId = assertRefId(plan.id, 'plan.id');
  if (plan.approved !== true || plan.model !== model) {
    fail('AGREEMENT_PLAN_MISMATCH', `Plan ${planId} non approuvé pour ce modèle`);
  }
  if (!(RHYTHMS as readonly string[]).includes(plan.rhythm)) {
    fail('AGREEMENT_PLAN_MISMATCH', 'Rythme de plan inconnu');
  }
  const maxDuration = assertDuration(plan.maxDurationDays, 'plan.maxDurationDays');
  if (durationDays > maxDuration) {
    fail('AGREEMENT_PLAN_MISMATCH', 'Durée supérieure au maximum du plan');
  }
  return {
    rhythm: plan.rhythm as Rhythm,
    minAmountXaf: assertAmount(plan.minAmountXaf, 'plan.minAmountXaf'),
  };
}

function termsToJson(terms: AgreementTerms): Parameters<typeof canonicalize>[0] {
  return {
    agreement_id: terms.agreementId,
    customer_id: terms.customerId,
    model: terms.model,
    offer_id: terms.offerId,
    offer_version: terms.offerVersion,
    partner_id: terms.partnerId,
    beneficiary_id: terms.beneficiaryId,
    target_xaf: toCanonicalString(xaf(terms.targetXaf)),
    plan_id: terms.planId,
    rhythm: terms.rhythm,
    min_amount_xaf: toCanonicalString(xaf(terms.minAmountXaf)),
    duration_days: terms.durationDays,
    refund_policy: terms.refundPolicy,
  };
}

/** Empreinte des conditions : SHA-256 hexadécimal de leur forme JCS. */
export function agreementTermsHash(terms: AgreementTerms): string {
  return createHash('sha256')
    .update(canonicalize(termsToJson(terms)), 'utf8')
    .digest('hex');
}

/**
 * Crée un accord en brouillon (F-SAV-001, F-PLN-001). Le montant cible du
 * modèle A est le prix de la version d'offre lue côté serveur et ne change
 * plus ensuite (F-CAT-003, I-11) : l'accord référence `(offer_id, version)`.
 */
export function createAgreement(input: CreateAgreementInput): Agreement {
  const id = assertUuidV7(input.id, 'id');
  const customerId = assertUuidV7(input.customerId, 'customerId');
  const createdAt = assertIsoUtcMs(input.createdAt, 'createdAt');
  if (!(AGREEMENT_MODELS as readonly string[]).includes(input.model)) {
    fail('AGREEMENT_INVALID_REQUEST', 'Modèle non pris en charge par ce lot');
  }
  const durationDays = assertDuration(input.durationDays, 'durationDays');
  const plan = assertPlan(input.plan, input.model, durationDays);

  let terms: AgreementTerms;
  if (input.model === 'SAVE_THEN_BUY') {
    const offer = input.offer;
    const offerId = assertUuidV7(offer.id, 'offer.id');
    if (!Number.isSafeInteger(offer.version) || offer.version < 1) {
      fail('AGREEMENT_INVALID_REQUEST', 'offer.version invalide');
    }
    if (
      offer.state !== 'PUBLISHED' ||
      offer.partnerStatus !== 'VALIDATED' ||
      !offer.models.includes('SAVE_THEN_BUY')
    ) {
      fail('AGREEMENT_OFFER_NOT_AVAILABLE', 'Offre indisponible pour le modèle A');
    }
    terms = {
      agreementId: id,
      customerId,
      model: 'SAVE_THEN_BUY',
      offerId,
      offerVersion: offer.version,
      partnerId: assertRefId(offer.partnerId, 'offer.partnerId'),
      beneficiaryId: null,
      targetXaf: assertAmount(offer.priceXaf, 'offer.priceXaf'),
      planId: input.plan.id,
      rhythm: plan.rhythm,
      minAmountXaf: plan.minAmountXaf,
      durationDays,
      refundPolicy: 'FULL_NO_FEE',
    };
  } else {
    const beneficiary = input.beneficiary;
    const beneficiaryId = assertRefId(beneficiary.id, 'beneficiary.id');
    if (beneficiary.status !== 'VERIFIED') {
      fail(
        'AGREEMENT_BENEFICIARY_NOT_VERIFIED',
        'Le bénéficiaire doit être vérifié avant tout objectif',
      );
    }
    terms = {
      agreementId: id,
      customerId,
      model: 'PLANNED_EXPENSE',
      offerId: null,
      offerVersion: null,
      partnerId: null,
      beneficiaryId,
      targetXaf: assertAmount(input.targetXaf, 'targetXaf'),
      planId: input.plan.id,
      rhythm: plan.rhythm,
      minAmountXaf: plan.minAmountXaf,
      durationDays,
      refundPolicy: 'FULL_NO_FEE',
    };
  }
  if (terms.minAmountXaf > terms.targetXaf) {
    fail('AGREEMENT_PLAN_MISMATCH', 'Montant minimal supérieur à la cible');
  }
  const frozenTerms = Object.freeze(terms);
  return Object.freeze({
    terms: frozenTerms,
    createdAt,
    termsHash: agreementTermsHash(frozenTerms),
    status: 'DRAFT',
    locked: false,
    disputedFrom: null,
  });
}

/**
 * Transitions autorisées (CDC_05 § 5.2), refus par défaut. La clé est
 * `origine>cible` ; la valeur restreint le modèle quand la branche en dépend.
 */
const TRANSITIONS: ReadonlyMap<string, AgreementModel | 'ANY'> = new Map([
  ['DRAFT>ACTIVE', 'ANY'],
  ['ACTIVE>FUNDED', 'ANY'],
  ['FUNDED>HANDED_OVER', 'SAVE_THEN_BUY'],
  ['FUNDED>PAID_TO_BENEFICIARY', 'PLANNED_EXPENSE'],
  ['HANDED_OVER>CLOSED', 'SAVE_THEN_BUY'],
  ['PAID_TO_BENEFICIARY>CLOSED', 'PLANNED_EXPENSE'],
  ['ACTIVE>CANCELLED_BY_CUSTOMER', 'ANY'],
  ['CANCELLED_BY_CUSTOMER>REFUNDED', 'ANY'],
  ['REFUNDED>CLOSED', 'ANY'],
  ['ACTIVE>DISPUTED', 'ANY'],
  ['FUNDED>DISPUTED', 'ANY'],
  ['DISPUTED>ACTIVE', 'ANY'],
  ['DISPUTED>FUNDED', 'ANY'],
  ['DISPUTED>REFUNDED', 'ANY'],
  ['ACTIVE>FROZEN', 'ANY'],
  ['FROZEN>ACTIVE', 'ANY'],
  ['FROZEN>REFUNDED', 'ANY'],
] as const);

export function isAllowedTransition(
  model: AgreementModel,
  from: AgreementStatus,
  to: AgreementStatus,
): boolean {
  const scope = TRANSITIONS.get(`${from}>${to}`);
  return scope === 'ANY' || scope === model;
}

/**
 * Applique une transition. Un accord verrouillé ne peut être annulé par le
 * client (F-SAV-003) : les cas prévus (décès, défaillance marchand, force
 * majeure) passent par `FROZEN` puis `REFUNDED`. Un litige ne revient qu'à
 * l'état dont il est parti.
 */
export function transitionAgreement(
  agreement: Agreement,
  to: AgreementStatus,
): Agreement {
  const from = agreement.status;
  if (
    !(AGREEMENT_STATUSES as readonly string[]).includes(to) ||
    !isAllowedTransition(agreement.terms.model, from, to)
  ) {
    fail('UNAUTHORIZED_TRANSITION', `Transition ${from} → ${String(to)} interdite`);
  }
  if (to === 'CANCELLED_BY_CUSTOMER' && agreement.locked) {
    fail('AGREEMENT_LOCKED', 'Objectif verrouillé : annulation refusée');
  }
  if (from === 'DISPUTED' && to !== 'REFUNDED' && to !== agreement.disputedFrom) {
    fail('UNAUTHORIZED_TRANSITION', 'Un litige ne revient qu’à son état d’origine');
  }
  let disputedFrom: Agreement['disputedFrom'] = null;
  if (to === 'DISPUTED') {
    disputedFrom = from === 'FUNDED' ? 'FUNDED' : 'ACTIVE';
  }
  return Object.freeze({ ...agreement, status: to, disputedFrom });
}

/**
 * Verrouille l'objectif jusqu'à l'échéance (F-SAV-003). Le verrou n'est
 * jamais levé par le client ; il est posé sur un accord actif seulement.
 */
export function lockAgreement(agreement: Agreement): Agreement {
  if (agreement.status !== 'ACTIVE') {
    fail('UNAUTHORIZED_TRANSITION', 'Seul un objectif actif peut être verrouillé');
  }
  if (agreement.locked) {
    fail('AGREEMENT_LOCKED', 'Objectif déjà verrouillé');
  }
  return Object.freeze({ ...agreement, locked: true });
}
