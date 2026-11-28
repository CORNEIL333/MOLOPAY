import { createPublicKey, verify } from 'node:crypto';
import { canonicalize } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { parseXaf, toCanonicalString, xaf } from '@achat/money';
import type { PoolClient } from 'pg';
import { getCurrentOffer } from '../catalog/offer.store';
import { getBeneficiary } from '../catalog/partner.store';
import { getPaymentPlan } from '../catalog/payment-plan.store';
import {
  AGREEMENT_MODELS,
  AGREEMENT_STATUSES,
  REFUND_POLICIES,
  RHYTHMS,
  agreementTermsHash,
  createAgreement,
  lockAgreement,
  transitionAgreement,
  type Agreement,
  type AgreementModel,
  type AgreementPlan,
  type AgreementStatus,
  type AgreementTerms,
  type RefundPolicy,
  type Rhythm,
} from './domain';

// Un Client ou un PoolClient suffit : le store n'utilise que `query`.
type SqlClient = Pick<PoolClient, 'query'>;

const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]*$/;
const SIGNATURE_DOMAIN = 'agreement-transition-v1';
const ACTOR_ID_PATTERN = /^[^\s]{1,200}$/;

/**
 * Appareil du client, lu côté serveur par l'appelant (module identity ;
 * agreements ne peut pas l'importer). Clé publique Ed25519 en PEM.
 */
export type SigningDevice = {
  readonly id: string;
  readonly accountId: string;
  readonly status: string;
  readonly publicKeyPem: string;
};

export type CustomerSignature = {
  readonly device: SigningDevice;
  /** Signature Ed25519 de `agreementSigningPayload`. */
  readonly signature: Buffer;
};

export type StoredAgreement = {
  readonly agreement: Agreement;
  /** Nombre d'événements de statut déjà enregistrés. */
  readonly seq: number;
};

type AgreementRow = {
  id: string;
  customer_id: string;
  model: string;
  offer_id: string | null;
  offer_version: number | null;
  partner_id: string | null;
  beneficiary_id: string | null;
  target_xaf: string;
  plan_id: string;
  rhythm: string;
  min_amount_xaf: string;
  duration_months: number;
  refund_policy: string;
  terms_hash: Buffer;
  created_at: Date;
  status: string;
  locked: boolean;
  seq: number;
  disputed_from: string | null;
};

// Transitions décidées par le client : signature d'appareil exigée
// (INT-NR-001 pour l'acceptation, SEC-AUTH-002 pour l'annulation).
const CUSTOMER_SIGNED = new Set(['DRAFT>ACTIVE', 'ACTIVE>CANCELLED_BY_CUSTOMER']);

function fail(code: 'AGREEMENT_INVALID_REQUEST' | 'AGREEMENT_NOT_FOUND' | 'AGREEMENT_SIGNATURE_INVALID', message: string): never {
  throw new BusinessError(code, message);
}

function amountFromText(value: string, field: string): bigint {
  if (!POSITIVE_DECIMAL_PATTERN.test(value)) {
    fail('AGREEMENT_INVALID_REQUEST', `${field} stocké invalide`);
  }
  return parseXaf(value).amount;
}

function oneOf<T extends string>(list: readonly T[], value: string, field: string): T {
  if (!(list as readonly string[]).includes(value)) {
    fail('AGREEMENT_INVALID_REQUEST', `${field} stocké hors liste`);
  }
  return value as T;
}

/**
 * Reconstruit l'accord depuis la base et revérifie l'empreinte des
 * conditions : une ligne altérée hors de l'application est détectée.
 */
export function agreementFromRow(row: AgreementRow): StoredAgreement {
  const terms: AgreementTerms = Object.freeze({
    agreementId: row.id,
    customerId: row.customer_id,
    model: oneOf<AgreementModel>(AGREEMENT_MODELS, row.model, 'model'),
    offerId: row.offer_id,
    offerVersion: row.offer_version,
    partnerId: row.partner_id,
    beneficiaryId: row.beneficiary_id,
    targetXaf: amountFromText(row.target_xaf, 'target_xaf'),
    planId: row.plan_id,
    rhythm: oneOf<Rhythm>(RHYTHMS, row.rhythm, 'rhythm'),
    minAmountXaf: amountFromText(row.min_amount_xaf, 'min_amount_xaf'),
    durationMonths: row.duration_months,
    refundPolicy: oneOf<RefundPolicy>(REFUND_POLICIES, row.refund_policy, 'refund_policy'),
  });
  const termsHash = agreementTermsHash(terms);
  if (!Buffer.isBuffer(row.terms_hash) || row.terms_hash.toString('hex') !== termsHash) {
    fail('AGREEMENT_INVALID_REQUEST', 'Empreinte des conditions altérée');
  }
  const status = oneOf<AgreementStatus>(AGREEMENT_STATUSES, row.status, 'status');
  let disputedFrom: Agreement['disputedFrom'] = null;
  if (status === 'DISPUTED') {
    disputedFrom = oneOf(['ACTIVE', 'FUNDED'] as const, row.disputed_from ?? '', 'disputed_from');
  }
  return {
    agreement: Object.freeze({
      terms,
      createdAt: row.created_at.toISOString(),
      termsHash,
      status,
      locked: row.locked,
      disputedFrom,
    }),
    seq: row.seq,
  };
}

/**
 * Message signé par l'appareil : JCS d'un objet séparé par domaine, lié à
 * l'accord, à l'empreinte de ses conditions, à la transition et au rang de
 * l'événement (une signature ne se rejoue pas sur un autre événement).
 */
export function agreementSigningPayload(input: {
  readonly agreementId: string;
  readonly termsHash: string;
  readonly from: AgreementStatus;
  readonly to: AgreementStatus;
  readonly seq: number;
}): Buffer {
  return Buffer.from(
    canonicalize({
      domain: SIGNATURE_DOMAIN,
      agreement_id: input.agreementId,
      terms_hash: input.termsHash,
      from: input.from,
      to: input.to,
      seq: input.seq,
    }),
    'utf8',
  );
}

function ed25519Verifies(publicKeyPem: string, payload: Buffer, signature: Buffer): boolean {
  try {
    const key = createPublicKey({ key: publicKeyPem, format: 'pem' });
    return key.asymmetricKeyType === 'ed25519' && verify(null, payload, key, signature);
  } catch {
    return false;
  }
}

function assertCustomerSignature(
  agreement: Agreement,
  signature: CustomerSignature | undefined,
  payload: Buffer,
): void {
  if (signature === undefined) {
    fail('AGREEMENT_SIGNATURE_INVALID', 'Signature de l’appareil exigée');
  }
  const device = signature.device;
  if (device.accountId !== agreement.terms.customerId || device.status !== 'ACTIVE') {
    fail('AGREEMENT_SIGNATURE_INVALID', 'Appareil inactif ou d’un autre client');
  }
  if (!ed25519Verifies(device.publicKeyPem, payload, signature.signature)) {
    fail('AGREEMENT_SIGNATURE_INVALID', 'Signature de l’appareil invalide');
  }
}

const SELECT_AGREEMENT = `
  SELECT s.id, s.customer_id, s.model, s.offer_id, s.offer_version, s.partner_id,
         s.beneficiary_id, s.target_xaf, s.plan_id, s.rhythm, s.min_amount_xaf,
         s.duration_months, s.refund_policy, s.terms_hash, s.created_at, s.status,
         s.locked,
         COALESCE((SELECT max(e.seq) FROM agreements.status_event e
                   WHERE e.agreement_id = s.id), 0) AS seq,
         (SELECT e.from_status FROM agreements.status_event e
           WHERE e.agreement_id = s.id AND e.kind = 'TRANSITION'
             AND e.to_status = 'DISPUTED'
           ORDER BY e.seq DESC LIMIT 1) AS disputed_from
  FROM agreements.agreement_state s
  WHERE s.id = $1`;

export async function getAgreement(
  client: SqlClient,
  agreementId: string,
): Promise<StoredAgreement | null> {
  const result = await client.query<AgreementRow>(SELECT_AGREEMENT, [agreementId]);
  const row = result.rows[0];
  return row === undefined ? null : agreementFromRow(row);
}

async function insertAgreement(client: SqlClient, agreement: Agreement): Promise<void> {
  const t = agreement.terms;
  await client.query(
    `INSERT INTO agreements.agreement
       (id, customer_id, model, offer_id, offer_version, partner_id, beneficiary_id,
        target_xaf, plan_id, rhythm, min_amount_xaf, duration_months, refund_policy,
        terms_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::bigint, $9, $10, $11::bigint, $12, $13,
             $14, $15)`,
    [
      t.agreementId,
      t.customerId,
      t.model,
      t.offerId,
      t.offerVersion,
      t.partnerId,
      t.beneficiaryId,
      toCanonicalString(xaf(t.targetXaf)),
      t.planId,
      t.rhythm,
      toCanonicalString(xaf(t.minAmountXaf)),
      t.durationMonths,
      t.refundPolicy,
      Buffer.from(agreement.termsHash, 'hex'),
      agreement.createdAt,
    ],
  );
}

/**
 * D26 : le plan est lu dans le registre des plans approuvés (maker-checker),
 * jamais fourni par l'appelant. La base revérifie à l'insertion.
 */
async function approvedPlan(client: SqlClient, planId: string): Promise<AgreementPlan> {
  const plan = await getPaymentPlan(client, planId);
  if (plan === null) {
    throw new BusinessError('AGREEMENT_PLAN_MISMATCH', `Plan ${planId} absent du registre`);
  }
  return {
    id: plan.planId,
    model: plan.model,
    approved: true,
    rhythm: plan.rhythm,
    minAmountXaf: plan.minAmountXaf,
    maxDurationMonths: plan.maxDurationMonths,
  };
}

/**
 * Crée un accord A sur la version courante de l'offre lue en base : la cible
 * est son prix (I-11). La base revérifie version courante, publication et prix.
 */
export async function createSaveThenBuyAgreement(
  client: SqlClient,
  input: {
    readonly id: string;
    readonly customerId: string;
    readonly offerId: string;
    readonly planId: string;
    readonly durationMonths: number;
    readonly createdAt: string;
  },
): Promise<StoredAgreement> {
  const stored = await getCurrentOffer(client, input.offerId);
  if (stored === null) {
    throw new BusinessError('AGREEMENT_OFFER_NOT_AVAILABLE', 'Offre inconnue');
  }
  const agreement = createAgreement({
    id: input.id,
    customerId: input.customerId,
    model: 'SAVE_THEN_BUY',
    offer: {
      id: stored.offer.id,
      version: stored.version,
      partnerId: stored.offer.partner.id,
      partnerStatus: stored.offer.partner.status,
      state: stored.offer.state,
      models: stored.offer.models,
      priceXaf: stored.offer.priceXaf,
    },
    plan: await approvedPlan(client, input.planId),
    durationMonths: input.durationMonths,
    createdAt: input.createdAt,
  });
  await insertAgreement(client, agreement);
  return reload(client, agreement.terms.agreementId);
}

/**
 * Crée un objectif C vers un bénéficiaire lu en base : partenaire de type
 * BENEFICIARY validé par maker-checker (F-PLN-001). La base revérifie.
 */
export async function createPlannedExpenseAgreement(
  client: SqlClient,
  input: {
    readonly id: string;
    readonly customerId: string;
    readonly beneficiaryId: string;
    readonly targetXaf: bigint;
    readonly planId: string;
    readonly durationMonths: number;
    readonly createdAt: string;
  },
): Promise<StoredAgreement> {
  const beneficiary = await getBeneficiary(client, input.beneficiaryId);
  if (beneficiary === null) {
    throw new BusinessError(
      'AGREEMENT_BENEFICIARY_NOT_VERIFIED',
      'Bénéficiaire inconnu',
    );
  }
  const agreement = createAgreement({
    id: input.id,
    customerId: input.customerId,
    model: 'PLANNED_EXPENSE',
    beneficiary: { id: beneficiary.id, status: beneficiary.status },
    targetXaf: input.targetXaf,
    plan: await approvedPlan(client, input.planId),
    durationMonths: input.durationMonths,
    createdAt: input.createdAt,
  });
  await insertAgreement(client, agreement);
  return reload(client, agreement.terms.agreementId);
}

async function reload(client: SqlClient, agreementId: string): Promise<StoredAgreement> {
  const stored = await getAgreement(client, agreementId);
  if (stored === null) {
    fail('AGREEMENT_NOT_FOUND', 'Accord introuvable');
  }
  return stored;
}

async function insertEvent(
  client: SqlClient,
  input: {
    readonly agreementId: string;
    readonly seq: number;
    readonly kind: 'TRANSITION' | 'LOCK';
    readonly from: AgreementStatus;
    readonly to: AgreementStatus;
    readonly signature: CustomerSignature | null;
    readonly actorId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO agreements.status_event
       (agreement_id, seq, kind, from_status, to_status, device_id, signature,
        actor_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [
      input.agreementId,
      input.seq,
      input.kind,
      input.from,
      input.to,
      input.signature?.device.id ?? null,
      input.signature?.signature ?? null,
      input.actorId,
    ],
  );
}

function assertActor(actorId: string): string {
  if (typeof actorId !== 'string' || !ACTOR_ID_PATTERN.test(actorId)) {
    fail('AGREEMENT_INVALID_REQUEST', 'actorId invalide');
  }
  return actorId;
}

/**
 * Enregistre une transition : le domaine la contrôle, la signature du client
 * est vérifiée quand la transition lui revient, puis la base contrôle de
 * nouveau (liste blanche, séquence, verrou, lien grand livre).
 */
export async function appendAgreementTransition(
  client: SqlClient,
  input: {
    readonly agreementId: string;
    readonly to: AgreementStatus;
    readonly actorId: string;
    readonly signature?: CustomerSignature;
  },
): Promise<StoredAgreement> {
  const actorId = assertActor(input.actorId);
  const current = await reload(client, input.agreementId);
  const next = transitionAgreement(current.agreement, input.to);
  const from = current.agreement.status;
  const seq = current.seq + 1;
  const signed = CUSTOMER_SIGNED.has(`${from}>${input.to}`);
  if (signed) {
    assertCustomerSignature(
      current.agreement,
      input.signature,
      agreementSigningPayload({
        agreementId: input.agreementId,
        termsHash: current.agreement.termsHash,
        from,
        to: next.status,
        seq,
      }),
    );
  } else if (input.signature !== undefined) {
    fail('AGREEMENT_INVALID_REQUEST', 'Signature non attendue pour cette transition');
  }
  await insertEvent(client, {
    agreementId: input.agreementId,
    seq,
    kind: 'TRANSITION',
    from,
    to: next.status,
    signature: signed ? (input.signature ?? null) : null,
    actorId,
  });
  return reload(client, input.agreementId);
}

/** Verrouille un objectif actif (F-SAV-003). */
export async function lockStoredAgreement(
  client: SqlClient,
  input: { readonly agreementId: string; readonly actorId: string },
): Promise<StoredAgreement> {
  const actorId = assertActor(input.actorId);
  const current = await reload(client, input.agreementId);
  lockAgreement(current.agreement);
  await insertEvent(client, {
    agreementId: input.agreementId,
    seq: current.seq + 1,
    kind: 'LOCK',
    from: 'ACTIVE',
    to: 'ACTIVE',
    signature: null,
    actorId,
  });
  return reload(client, input.agreementId);
}

// Accords A d'un marchand défaillant pour lesquels l'article n'est pas remis
// et aucune restitution n'est engagée : remède à proposer (F-SAV-006).
const DEFAULT_AFFECTED_STATUSES = ['DRAFT', 'ACTIVE', 'FUNDED', 'DISPUTED', 'FROZEN'];

export type DefaultRemedy = 'EQUIVALENT_ITEM' | 'FULL_REFUND';

export type AffectedAgreement = {
  readonly agreementId: string;
  readonly status: AgreementStatus;
  /** F-SAV-006 : article équivalent ou remboursement intégral. */
  readonly remedies: readonly DefaultRemedy[];
};

export async function listAgreementsAffectedByDefault(
  client: SqlClient,
  partnerId: string,
): Promise<readonly AffectedAgreement[]> {
  const result = await client.query<{ id: string; status: string }>(
    `SELECT s.id, s.status
     FROM agreements.agreement_state s
     JOIN catalog.partner_state p ON p.partner_id = s.partner_id
     WHERE s.model = 'SAVE_THEN_BUY' AND s.partner_id = $1
       AND p.in_default AND s.status = ANY ($2::text[])
     ORDER BY s.id`,
    [partnerId, DEFAULT_AFFECTED_STATUSES],
  );
  return result.rows.map((row) => ({
    agreementId: row.id,
    status: oneOf<AgreementStatus>(AGREEMENT_STATUSES, row.status, 'status'),
    remedies: ['EQUIVALENT_ITEM', 'FULL_REFUND'],
  }));
}

/**
 * F-SAV-002 : passe un accord ACTIVE à FUNDED quand les versements confirmés
 * au grand livre atteignent la cible. Les fonds sont dérivés des écritures
 * (agreements.confirmed_funds_xaf), jamais affirmés ; la base revérifie.
 * Sans effet si l'accord n'est pas ACTIVE ou pas encore financé à 100 %.
 */
export async function markAgreementFundedIfComplete(
  client: SqlClient,
  input: { readonly agreementId: string; readonly actorId: string },
): Promise<{ readonly agreement: StoredAgreement; readonly funded: boolean }> {
  const actorId = assertActor(input.actorId);
  const current = await reload(client, input.agreementId);
  if (current.agreement.status === 'FUNDED') {
    return { agreement: current, funded: true };
  }
  if (current.agreement.status !== 'ACTIVE') {
    return { agreement: current, funded: false };
  }
  const result = await client.query<{ funds: string }>(
    'SELECT agreements.confirmed_funds_xaf($1)::text AS funds',
    [input.agreementId],
  );
  const funds = parseXaf(result.rows[0]?.funds ?? '0').amount;
  if (funds < current.agreement.terms.targetXaf) {
    return { agreement: current, funded: false };
  }
  const funded = await appendAgreementTransition(client, {
    agreementId: input.agreementId,
    to: 'FUNDED',
    actorId,
  });
  return { agreement: funded, funded: true };
}

export type AgreementHistoryItem = {
  readonly at: string;
  readonly kind: 'AGREEMENT_STATUS' | 'AGREEMENT_LOCK';
  readonly from: string;
  readonly to: string;
};

/** F-SUP-003 : journal des statuts d'un accord, dans l'ordre de séquence. */
export async function listAgreementEvents(
  client: SqlClient,
  agreementId: string,
): Promise<AgreementHistoryItem[]> {
  const result = await client.query<{ created_at: Date; kind: string; from_status: string; to_status: string }>(
    `SELECT created_at, kind, from_status, to_status
       FROM agreements.status_event WHERE agreement_id = $1 ORDER BY seq`,
    [agreementId],
  );
  return result.rows.map((row) => ({
    at: row.created_at.toISOString(),
    kind: row.kind === 'LOCK' ? 'AGREEMENT_LOCK' : 'AGREEMENT_STATUS',
    from: row.from_status,
    to: row.to_status,
  }));
}
