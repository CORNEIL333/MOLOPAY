import { createHash, timingSafeEqual } from 'node:crypto';
import { canonicalize, type JsonValue } from '@achat/chain';
import { BusinessError, type ErrorCode } from '@achat/contracts';
import { type AuditEventDraft, type AuditEventType } from '../audit/domain';

export const INTERNAL_ROLES = [
  'SUPPORT_N1',
  'SUPPORT_N2',
  'OPERATIONS',
  'FINANCE',
  'COMPLIANCE',
  'RISK',
  'PARTNER_NETWORK',
  'AUDIT',
  'TECH_ADMIN',
] as const;

export type InternalRole = (typeof INTERNAL_ROLES)[number];

export const ADMIN_ACTIONS = [
  'READ_IDENTITY_DOCUMENT',
  'READ_FINANCIAL_HISTORY',
  'VIEW_AUDIT_LOG',
  'EXPORT_AUDIT_LOG',
  'PREPARE_SETTLEMENT',
  'APPROVE_SETTLEMENT',
  'PREPARE_LEDGER_REVERSAL',
  'APPROVE_LEDGER_REVERSAL',
  'PREPARE_FINANCIAL_SETTING',
  'APPROVE_FINANCIAL_SETTING',
  'PREPARE_PARTNER',
  'APPROVE_PARTNER',
  'PREPARE_PAYMENT_PLAN',
  'APPROVE_PAYMENT_PLAN',
  'REVIEW_BENEFICIARY_DOCUMENT',
  'PREPARE_REFUND',
  'APPROVE_REFUND',
  'PREPARE_BENEFICIARY_PAYOUT',
  'APPROVE_BENEFICIARY_PAYOUT',
  'DECIDE_RISK_ALERT',
  'MANAGE_USERS',
  'MANAGE_RISK_ALERT',
  'DECLARE_MERCHANT_DEFAULT',
  'REQUEST_BREAK_GLASS',
  'APPROVE_BREAK_GLASS',
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export type AdminPrincipal = {
  readonly actorId: string;
  readonly roles: readonly InternalRole[];
  readonly cityIds?: readonly string[];
  readonly partnerIds?: readonly string[];
  readonly maxAmountXaf?: bigint;
};

export type AuthorizationContext = {
  readonly cityId?: string;
  readonly partnerId?: string;
  readonly amountXaf?: bigint;
  readonly reason?: string;
};

export type AuthorizationDenialCode =
  | 'ADMIN_FORBIDDEN'
  | 'ADMIN_SCOPE_DENIED'
  | 'ADMIN_AMOUNT_LIMIT'
  | 'ADMIN_REASON_REQUIRED';

export type AuthorizationDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: AuthorizationDenialCode;
      readonly message: string;
    };

const GRANTS: Readonly<Record<InternalRole, ReadonlySet<AdminAction>>> = {
  SUPPORT_N1: new Set(),
  SUPPORT_N2: new Set<AdminAction>([
    'READ_IDENTITY_DOCUMENT',
    'READ_FINANCIAL_HISTORY',
  ]),
  OPERATIONS: new Set<AdminAction>([
    'READ_FINANCIAL_HISTORY',
    'PREPARE_SETTLEMENT',
    'PREPARE_LEDGER_REVERSAL',
    'DECLARE_MERCHANT_DEFAULT',
    // D49 : préparation des remboursements.
    'PREPARE_REFUND',
    // D50 : préparation des virements aux bénéficiaires C.
    'PREPARE_BENEFICIARY_PAYOUT',
  ]),
  FINANCE: new Set<AdminAction>([
    'READ_FINANCIAL_HISTORY',
    'PREPARE_SETTLEMENT',
    'APPROVE_SETTLEMENT',
    'PREPARE_FINANCIAL_SETTING',
    'APPROVE_FINANCIAL_SETTING',
    'APPROVE_LEDGER_REVERSAL',
    // D26 : FINANCE prépare les plans de paiement.
    'PREPARE_PAYMENT_PLAN',
    // D49 : remboursements (préparation, décision, instruction, exécution).
    'PREPARE_REFUND',
    'APPROVE_REFUND',
    // D50 : virements aux bénéficiaires C.
    'PREPARE_BENEFICIARY_PAYOUT',
    'APPROVE_BENEFICIARY_PAYOUT',
  ]),
  COMPLIANCE: new Set<AdminAction>([
    'READ_IDENTITY_DOCUMENT',
    'READ_FINANCIAL_HISTORY',
    'APPROVE_PARTNER',
    'DECLARE_MERCHANT_DEFAULT',
    // D26 : COMPLIANCE approuve les plans (préparateur ≠ approbateur, I-7).
    'APPROVE_PAYMENT_PLAN',
    // D48 / F-PLN-002 : examen des pièces des bénéficiaires (proposition puis confirmation).
    'REVIEW_BENEFICIARY_DOCUMENT',
    // D53 / SEC-FRD-002 : décision tracée sur une alerte de fraude (Conformité/Risque).
    'DECIDE_RISK_ALERT',
  ]),
  RISK: new Set<AdminAction>([
    'READ_FINANCIAL_HISTORY',
    'MANAGE_RISK_ALERT',
    'DECLARE_MERCHANT_DEFAULT',
    // D53 / SEC-FRD-002 : décision tracée sur une alerte de fraude.
    'DECIDE_RISK_ALERT',
  ]),
  // D31 : déclarer une défaillance ne fait que bloquer ; une seule personne
  // suffit, motif obligatoire. La levée passe par la revalidation maker-checker.
  PARTNER_NETWORK: new Set<AdminAction>(['PREPARE_PARTNER', 'DECLARE_MERCHANT_DEFAULT']),
  AUDIT: new Set<AdminAction>(['VIEW_AUDIT_LOG', 'EXPORT_AUDIT_LOG']),
  TECH_ADMIN: new Set<AdminAction>([
    'MANAGE_USERS',
    'REQUEST_BREAK_GLASS',
    'APPROVE_BREAK_GLASS',
  ]),
};

const REASON_REQUIRED_ACTIONS: ReadonlySet<AdminAction> = new Set<AdminAction>([
  'READ_IDENTITY_DOCUMENT',
  'READ_FINANCIAL_HISTORY',
  'EXPORT_AUDIT_LOG',
  'DECLARE_MERCHANT_DEFAULT',
  'REQUEST_BREAK_GLASS',
  'APPROVE_BREAK_GLASS',
]);

const PARTNER_SCOPED_ACTIONS: ReadonlySet<AdminAction> = new Set<AdminAction>([
  'PREPARE_PARTNER',
  'APPROVE_PARTNER',
  'DECLARE_MERCHANT_DEFAULT',
]);

const CITY_SCOPED_ACTIONS: ReadonlySet<AdminAction> = new Set<AdminAction>([
  'PREPARE_SETTLEMENT',
  'APPROVE_SETTLEMENT',
  'PREPARE_LEDGER_REVERSAL',
  'APPROVE_LEDGER_REVERSAL',
  'MANAGE_RISK_ALERT',
]);

const AMOUNT_LIMITED_ACTIONS: ReadonlySet<AdminAction> = new Set<AdminAction>([
  'APPROVE_SETTLEMENT',
  'APPROVE_REFUND',
  'APPROVE_BENEFICIARY_PAYOUT',
  'APPROVE_LEDGER_REVERSAL',
]);

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC_MS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_REASON_LENGTH = 1000;
const HOUR_MS = 3_600_000;
const DEFAULT_TTL_MS = 24 * HOUR_MS;
const MAX_TTL_MS = 7 * 24 * HOUR_MS;
const BREAK_GLASS_TTL_MS = 2 * HOUR_MS;
const PAYLOAD_AMOUNT_PATTERN = /^[1-9][0-9]*$/;

function fail(code: ErrorCode, message: string): never {
  throw new BusinessError(code, message);
}

function nonEmpty(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function assertActorId(value: string, field: string): void {
  if (
    nonEmpty(value) === null ||
    value !== value.trim() ||
    /[\s\u200b-\u200f\u2028\u2029\ufeff]/u.test(value) ||
    value.length > 200
  ) {
    fail(
      'ADMIN_INVALID_REQUEST',
      `${field} doit être un identifiant non vide, sans espace ni caractère invisible`,
    );
  }
}

export function authorize(
  principal: AdminPrincipal,
  action: AdminAction,
  context: AuthorizationContext,
): AuthorizationDecision {
  if (!principal.roles.some((role) => GRANTS[role]?.has(action) === true)) {
    return {
      allowed: false,
      code: 'ADMIN_FORBIDDEN',
      message: `Rôle insuffisant pour ${action}`,
    };
  }
  if (
    REASON_REQUIRED_ACTIONS.has(action) &&
    nonEmpty(context.reason) === null
  ) {
    return {
      allowed: false,
      code: 'ADMIN_REASON_REQUIRED',
      message: `Un motif est exigé pour ${action}`,
    };
  }
  if (CITY_SCOPED_ACTIONS.has(action)) {
    if (
      context.cityId === undefined ||
      principal.cityIds === undefined ||
      principal.cityIds.length === 0 ||
      !principal.cityIds.includes(context.cityId)
    ) {
      return {
        allowed: false,
        code: 'ADMIN_SCOPE_DENIED',
        message: 'Ville hors périmètre',
      };
    }
  }
  if (
    PARTNER_SCOPED_ACTIONS.has(action) &&
    principal.roles.includes('PARTNER_NETWORK')
  ) {
    if (
      context.partnerId === undefined ||
      principal.partnerIds === undefined ||
      !principal.partnerIds.includes(context.partnerId)
    ) {
      return {
        allowed: false,
        code: 'ADMIN_SCOPE_DENIED',
        message: 'Partenaire hors périmètre',
      };
    }
  }
  if (AMOUNT_LIMITED_ACTIONS.has(action)) {
    const amount = context.amountXaf;
    if (
      principal.maxAmountXaf === undefined ||
      amount === undefined ||
      amount <= 0n ||
      amount > principal.maxAmountXaf
    ) {
      return {
        allowed: false,
        code: 'ADMIN_AMOUNT_LIMIT',
        message: 'Montant absent ou au-delà du plafond d’approbation',
      };
    }
  }
  return { allowed: true };
}

export function assertAuthorized(
  principal: AdminPrincipal,
  action: AdminAction,
  context: AuthorizationContext,
): void {
  const decision = authorize(principal, action, context);
  if (!decision.allowed) {
    fail(decision.code, decision.message);
  }
}

export const APPROVAL_KINDS = [
  'SETTLEMENT',
  'REFUND',
  'LEDGER_REVERSAL',
  'FINANCIAL_SETTING',
  'PARTNER_APPROVAL',
  'PAYMENT_PLAN',
  'ROLE_GRANT',
  'BREAK_GLASS',
] as const;

export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export type ApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED';

export type ApprovalTransition =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export type ApprovalRequest = {
  readonly id: string;
  readonly kind: ApprovalKind;
  readonly makerId: string;
  readonly payload: Readonly<Record<string, JsonValue>>;
  readonly payloadHash: Buffer;
  readonly reason: string;
  readonly preparedAt: string;
  readonly expiresAt: string;
  readonly status: ApprovalStatus;
  readonly checkerId: string | null;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
};

export type CreateApprovalInput = {
  readonly id: string;
  readonly kind: ApprovalKind;
  readonly payload: Readonly<Record<string, JsonValue>>;
  readonly reason: string;
  readonly now: string;
  readonly ttlMs?: number;
};

export type ApprovalDecision = 'APPROVED' | 'REJECTED';

const KIND_ACTIONS: Readonly<
  Record<ApprovalKind, { readonly prepare: AdminAction; readonly approve: AdminAction }>
> = {
  SETTLEMENT: { prepare: 'PREPARE_SETTLEMENT', approve: 'APPROVE_SETTLEMENT' },
  REFUND: { prepare: 'PREPARE_SETTLEMENT', approve: 'APPROVE_SETTLEMENT' },
  LEDGER_REVERSAL: {
    prepare: 'PREPARE_LEDGER_REVERSAL',
    approve: 'APPROVE_LEDGER_REVERSAL',
  },
  FINANCIAL_SETTING: {
    prepare: 'PREPARE_FINANCIAL_SETTING',
    approve: 'APPROVE_FINANCIAL_SETTING',
  },
  PARTNER_APPROVAL: { prepare: 'PREPARE_PARTNER', approve: 'APPROVE_PARTNER' },
  PAYMENT_PLAN: { prepare: 'PREPARE_PAYMENT_PLAN', approve: 'APPROVE_PAYMENT_PLAN' },
  ROLE_GRANT: { prepare: 'MANAGE_USERS', approve: 'MANAGE_USERS' },
  BREAK_GLASS: {
    prepare: 'REQUEST_BREAK_GLASS',
    approve: 'APPROVE_BREAK_GLASS',
  },
};

function isIsoUtcMs(value: string): boolean {
  return (
    ISO_UTC_MS_PATTERN.test(value) &&
    !Number.isNaN(new Date(value).getTime()) &&
    new Date(value).toISOString() === value
  );
}

function requireReason(value: string | undefined, message: string): string {
  const trimmed = nonEmpty(value);
  if (trimmed === null) {
    fail('ADMIN_REASON_REQUIRED', message);
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    fail(
      'ADMIN_INVALID_REQUEST',
      `Motif supérieur à ${MAX_REASON_LENGTH.toString()} caractères`,
    );
  }
  return trimmed;
}

function canonicalPayload(payload: Readonly<Record<string, JsonValue>>): string {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    fail('ADMIN_INVALID_REQUEST', 'La charge utile doit être un objet JSON');
  }
  try {
    return canonicalize(payload);
  } catch (error: unknown) {
    fail(
      'ADMIN_INVALID_REQUEST',
      `Charge utile non canonisable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function declaredAmount(
  payload: Readonly<Record<string, JsonValue>>,
): bigint | null {
  const raw = payload['amount_xaf'];
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string' || !PAYLOAD_AMOUNT_PATTERN.test(raw)) {
    fail(
      'ADMIN_INVALID_REQUEST',
      'amount_xaf doit être un entier XAF positif sous forme de chaîne',
    );
  }
  return BigInt(raw);
}

function assertContextMatchesPayload(
  payload: Readonly<Record<string, JsonValue>>,
  context: AuthorizationContext,
  required: {
    readonly amount: boolean;
    readonly city: boolean;
    readonly partner: boolean;
  },
): void {
  const amount = declaredAmount(payload);
  if (amount === null) {
    if (required.amount) {
      fail(
        'ADMIN_INVALID_REQUEST',
        'La charge approuvée doit déclarer amount_xaf',
      );
    }
  } else if (context.amountXaf === undefined || context.amountXaf !== amount) {
    fail(
      'ADMIN_INVALID_REQUEST',
      'Montant du contexte différent de la charge approuvée',
    );
  }
  const cityId = payload['city_id'];
  if (cityId === undefined) {
    if (required.city) {
      fail(
        'ADMIN_INVALID_REQUEST',
        'La charge approuvée doit déclarer city_id',
      );
    }
  } else if (typeof cityId !== 'string' || context.cityId !== cityId) {
    fail(
      'ADMIN_INVALID_REQUEST',
      'Ville du contexte différente de la charge approuvée',
    );
  }
  const partnerId = payload['partner_id'];
  if (partnerId === undefined) {
    if (required.partner) {
      fail(
        'ADMIN_INVALID_REQUEST',
        'La charge approuvée doit déclarer partner_id',
      );
    }
  } else if (typeof partnerId !== 'string' || context.partnerId !== partnerId) {
    fail(
      'ADMIN_INVALID_REQUEST',
      'Partenaire du contexte différent de la charge approuvée',
    );
  }
}

export function createApprovalRequest(
  input: CreateApprovalInput,
  principal: AdminPrincipal,
  context: AuthorizationContext,
): ApprovalRequest {
  if (!UUID_V7_PATTERN.test(input.id)) {
    fail('ADMIN_INVALID_REQUEST', 'id doit être un UUID v7 minuscule');
  }
  if (!(APPROVAL_KINDS as readonly string[]).includes(input.kind)) {
    fail('ADMIN_INVALID_REQUEST', `Type de demande inconnu: ${input.kind}`);
  }
  if (nonEmpty(principal.actorId) === null) {
    fail('ADMIN_INVALID_REQUEST', 'Préparateur absent');
  }
  assertActorId(principal.actorId, 'Préparateur');
  if (!isIsoUtcMs(input.now)) {
    fail(
      'ADMIN_INVALID_REQUEST',
      'now doit être ISO 8601 UTC avec millisecondes',
    );
  }
  const reason = requireReason(input.reason, 'Un motif est exigé pour la demande');
  const canonical = canonicalPayload(input.payload);
  assertContextMatchesPayload(input.payload, context, {
    amount: false,
    city: false,
    partner: false,
  });
  const payloadHash = createHash('sha256').update(canonical, 'utf8').digest();

  const ttl =
    input.ttlMs ??
    (input.kind === 'BREAK_GLASS' ? BREAK_GLASS_TTL_MS : DEFAULT_TTL_MS);
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_TTL_MS) {
    fail('ADMIN_INVALID_REQUEST', 'Durée de validité hors bornes');
  }
  if (input.kind === 'BREAK_GLASS' && ttl > BREAK_GLASS_TTL_MS) {
    fail(
      'ADMIN_INVALID_REQUEST',
      'Le bris de glace est limité à deux heures',
    );
  }

  assertAuthorized(principal, KIND_ACTIONS[input.kind].prepare, {
    ...context,
    reason: context.reason ?? reason,
  });

  const expiresAt = new Date(
    new Date(input.now).getTime() + ttl,
  ).toISOString();

  return {
    id: input.id,
    kind: input.kind,
    makerId: principal.actorId,
    payload: input.payload,
    payloadHash,
    reason,
    preparedAt: input.now,
    expiresAt,
    status: 'PENDING',
    checkerId: null,
    decidedAt: null,
    decisionReason: null,
  };
}

function assertPending(request: ApprovalRequest): void {
  if (request.status !== 'PENDING') {
    fail(
      'ADMIN_REQUEST_NOT_PENDING',
      `Demande déjà ${request.status}`,
    );
  }
}

function assertPayloadIntact(request: ApprovalRequest): void {
  const recomputed = createHash('sha256')
    .update(canonicalPayload(request.payload), 'utf8')
    .digest();
  if (
    recomputed.length !== request.payloadHash.length ||
    !timingSafeEqual(recomputed, request.payloadHash)
  ) {
    fail(
      'ADMIN_INVALID_REQUEST',
      'Charge utile altérée depuis la préparation',
    );
  }
}

function assertNotExpired(request: ApprovalRequest, now: string): void {
  if (!isIsoUtcMs(now)) {
    fail('ADMIN_INVALID_REQUEST', 'now doit être ISO 8601 UTC avec millisecondes');
  }
  if (!isIsoUtcMs(request.expiresAt)) {
    fail('ADMIN_INVALID_REQUEST', 'expiresAt doit être ISO 8601 UTC avec millisecondes');
  }
  if (new Date(now).getTime() >= new Date(request.expiresAt).getTime()) {
    fail('ADMIN_REQUEST_EXPIRED', 'Demande expirée');
  }
}

export function decideApprovalRequest(
  request: ApprovalRequest,
  checker: AdminPrincipal,
  context: AuthorizationContext,
  decision: ApprovalDecision,
  decisionReason: string | undefined,
  now: string,
): ApprovalRequest {
  assertPayloadIntact(request);
  assertPending(request);
  assertNotExpired(request, now);
  assertActorId(checker.actorId, 'Décideur');
  if (checker.actorId === request.makerId) {
    fail(
      'MAKER_CANNOT_APPROVE',
      'Le préparateur ne peut pas décider sa propre demande',
    );
  }
  const approveAction = KIND_ACTIONS[request.kind].approve;
  const reason =
    decision === 'REJECTED'
      ? requireReason(decisionReason, 'Un motif est exigé pour le refus')
      : nonEmpty(decisionReason);
  assertAuthorized(checker, approveAction, {
    ...context,
    reason: context.reason ?? reason ?? request.reason,
  });
  if (decision === 'APPROVED') {
    assertContextMatchesPayload(request.payload, context, {
      amount: AMOUNT_LIMITED_ACTIONS.has(approveAction),
      city: CITY_SCOPED_ACTIONS.has(approveAction),
      partner: request.kind === 'PARTNER_APPROVAL',
    });
  }
  return {
    ...request,
    status: decision,
    checkerId: checker.actorId,
    decidedAt: now,
    decisionReason: reason,
  };
}

export function cancelApprovalRequest(
  request: ApprovalRequest,
  principal: AdminPrincipal,
  now: string,
): ApprovalRequest {
  assertPayloadIntact(request);
  assertPending(request);
  assertNotExpired(request, now);
  assertActorId(principal.actorId, 'Annulateur');
  if (principal.actorId !== request.makerId) {
    fail(
      'ADMIN_FORBIDDEN',
      'Seul le préparateur peut annuler sa demande',
    );
  }
  return {
    ...request,
    status: 'CANCELLED',
    decidedAt: now,
    decisionReason: null,
  };
}

const AUDIT_TYPE_BY_KIND: Readonly<Record<ApprovalKind, AuditEventType>> = {
  SETTLEMENT: 'BACKOFFICE_ACTION',
  REFUND: 'BACKOFFICE_ACTION',
  LEDGER_REVERSAL: 'BACKOFFICE_ACTION',
  FINANCIAL_SETTING: 'CONFIG_CHANGED',
  PARTNER_APPROVAL: 'BACKOFFICE_ACTION',
  PAYMENT_PLAN: 'CONFIG_CHANGED',
  ROLE_GRANT: 'PERMISSION_CHANGED',
  BREAK_GLASS: 'BACKOFFICE_ACTION',
};

export function approvalAuditEvent(
  id: string,
  ts: string,
  request: ApprovalRequest,
  transition: ApprovalTransition,
  actor: AdminPrincipal,
): AuditEventDraft {
  const refs: Record<string, JsonValue> = {
    kind: request.kind,
    status: request.status,
    maker_id: request.makerId,
    payload_sha256: request.payloadHash.toString('hex'),
  };
  if (request.checkerId !== null) {
    refs['checker_id'] = request.checkerId;
  }
  const reason =
    transition === 'APPROVED' || transition === 'REJECTED'
      ? (request.decisionReason ?? request.reason)
      : request.reason;
  return {
    id,
    ts,
    eventType: AUDIT_TYPE_BY_KIND[request.kind],
    actorId: actor.actorId,
    action: `${request.kind}_${transition}`,
    targetType: 'APPROVAL_REQUEST',
    targetId: request.id,
    outcome: 'SUCCESS',
    reason,
    refs,
  };
}
