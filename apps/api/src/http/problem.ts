import { BusinessError, ERROR_CODES, type ErrorCode } from '@achat/contracts';

/** Problème RFC 9457 tel que décrit par `components.schemas.Problem`. */
export type Problem = {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ErrorCode;
  readonly detail?: string;
};

const UNAUTHORIZED: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'IDENTITY_SESSION_INVALID',
  'STAFF_AUTH_INVALID',
  'PARTNER_AUTH_INVALID',
  'IDENTITY_SESSION_EXPIRED',
]);

const FORBIDDEN: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'PERMISSION_DENIED',
  'ADMIN_FORBIDDEN',
  // Refus d'autorisation du back-office : hors périmètre (ville, partenaire) ou au-delà du plafond.
  'ADMIN_SCOPE_DENIED',
  'ADMIN_AMOUNT_LIMIT',
  // Portail partenaire : rôle (vendeur) ou partenaire hors périmètre (F-PRT-003/004).
  'PARTNER_ROLE_DENIED',
  'ORIGIN_FORBIDDEN',
  'MAKER_CANNOT_APPROVE',
  'IDENTITY_ACCOUNT_BLOCKED',
  'IDENTITY_DEVICE_REVOKED',
  'IDENTITY_PIN_LOCKED',
]);

const CONFLICT: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'REQUEST_CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
  'PAYMENT_ALREADY_CONFIRMED',
  'UNAUTHORIZED_TRANSITION',
  'AGREEMENT_LOCKED',
  'IDENTITY_NONCE_REUSED',
  'IDENTITY_OTP_REPLAYED',
  'IDENTITY_ACCOUNT_EXISTS',
  'IDENTITY_DECEASE_CASE_EXISTS',
  'IDENTITY_DECEASE_ALREADY_DECIDED',
  'IDENTITY_ACCOUNT_DECEASED',
  'SETTLEMENT_OUTGOING_FROZEN',
  'SETTLEMENT_FREEZE_STATE',
]);

const BAD_REQUEST: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'REQUEST_INVALID',
  'INVALID_AMOUNT',
  'REPORT_PERIOD_INVALID',
]);

const TITLES: Readonly<Record<number, string>> = {
  400: 'Requête invalide',
  401: 'Authentification requise',
  403: 'Action interdite',
  404: 'Ressource introuvable',
  409: 'Conflit',
  422: 'Règle métier non respectée',
  426: 'Mise à jour de l’application requise',
  429: 'Trop de requêtes',
  500: 'Erreur interne',
  503: 'Service indisponible',
};

// Le type d'un refus de débit reste générique : il ne décrit pas le mécanisme.
const TYPE_SLUGS: Readonly<Partial<Record<ErrorCode, string>>> = {
  REQUEST_RATE_LIMITED: 'too-many-requests',
  RATE_LIMIT_UNCONFIGURED: 'service-unavailable',
  PIN_UNCONFIGURED: 'service-unavailable',
  STAFF_AUTH_UNCONFIGURED: 'service-unavailable',
  PARTNER_AUTH_UNCONFIGURED: 'service-unavailable',
  HANDOVER_UNCONFIGURED: 'service-unavailable',
  SIGNING_UNCONFIGURED: 'service-unavailable',
  SIGNING_UNAVAILABLE: 'service-unavailable',
  SMS_UNCONFIGURED: 'service-unavailable',
  SMS_DELIVERY_FAILED: 'service-unavailable',
};

/** Statut HTTP d'un code métier ; tout code non classé est une règle métier (422). */
export function statusForCode(code: ErrorCode): number {
  if (UNAUTHORIZED.has(code)) return 401;
  if (FORBIDDEN.has(code)) return 403;
  if (CONFLICT.has(code)) return 409;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (BAD_REQUEST.has(code) || code.endsWith('_INVALID_REQUEST') || code.endsWith('_FIELD_FORBIDDEN')) {
    return 400;
  }
  if (code === 'INTERNAL_ERROR') return 500;
  if (code === 'REQUEST_RATE_LIMITED') return 429;
  // SEC-MOB-005 : application trop ancienne (mise à jour exigée).
  if (code === 'CLIENT_UPGRADE_REQUIRED') return 426;
  if (code === 'RATE_LIMIT_UNCONFIGURED' || code === 'PIN_UNCONFIGURED' || code === 'STAFF_AUTH_UNCONFIGURED' || code === 'PARTNER_AUTH_UNCONFIGURED' || code === 'HANDOVER_UNCONFIGURED' || code === 'SIGNING_UNCONFIGURED' || code === 'SIGNING_UNAVAILABLE' || code === 'SMS_UNCONFIGURED' || code === 'SMS_DELIVERY_FAILED') return 503;
  return 422;
}

/**
 * Refus d'authentification : un seul détail, quelle que soit la cause (compte
 * désactivé, défi expiré, clé clonée…), pour ne rien apprendre à un attaquant.
 * La cause exacte reste dans le message interne.
 */
const UNIFORM_DETAIL: Readonly<Partial<Record<ErrorCode, string>>> = Object.freeze({
  STAFF_AUTH_INVALID: 'Authentification refusée',
  PARTNER_AUTH_INVALID: 'Authentification refusée',
});

function problem(code: ErrorCode, rawDetail?: string): Problem {
  const status = statusForCode(code);
  const detail = UNIFORM_DETAIL[code] ?? rawDetail;
  return {
    type: `urn:achat:problem:${TYPE_SLUGS[code] ?? code.toLowerCase().replaceAll('_', '-')}`,
    title: TITLES[status] ?? 'Erreur',
    status,
    code,
    ...(detail === undefined || detail === '' ? {} : { detail }),
  };
}

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));
const SQL_BUSINESS_PREFIX = /^([A-Z][A-Z0-9_]+): /;
const MAX_DETAIL_LENGTH = 300;

/**
 * Traduit une erreur en problème. Erreur métier : son code et son message.
 * Exception levée par un déclencheur (« CODE: message ») : code connu repris.
 * Violation de contrainte SQL : code générique, sans détail interne.
 * Tout le reste : 500 sans détail (aucune fuite de pile ni de SQL).
 */
export function toProblem(error: unknown): Problem {
  if (error instanceof BusinessError) {
    return problem(error.code, error.message);
  }
  if (typeof error === 'object' && error !== null) {
    const pg = error as { code?: unknown; message?: unknown };
    if (pg.code === 'P0001' && typeof pg.message === 'string') {
      const match = SQL_BUSINESS_PREFIX.exec(pg.message);
      if (match !== null && KNOWN_CODES.has(match[1] ?? '')) {
        const detail = pg.message.slice(match[0].length).slice(0, MAX_DETAIL_LENGTH);
        return problem(match[1] as ErrorCode, detail);
      }
    }
    if (pg.code === '23505' || pg.code === '40001') {
      return problem('REQUEST_CONFLICT');
    }
    if (typeof pg.code === 'string' && /^(23|22)/.test(pg.code)) {
      return problem('REQUEST_INVALID');
    }
  }
  return problem('INTERNAL_ERROR');
}
