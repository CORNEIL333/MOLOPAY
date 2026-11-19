import {
  BusinessError,
  ERROR_CODES,
  errorMessage,
  type ErrorCode,
  type ProblemLocale,
} from '@achat/contracts';

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
  'REQUEST_UNAUTHENTICATED',
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
]);

const BAD_REQUEST: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'REQUEST_INVALID',
  'INVALID_AMOUNT',
]);

/** Statuts qui ne se déduisent pas du suffixe du code. */
const STATUS_OVERRIDES: Readonly<Partial<Record<ErrorCode, number>>> = {
  REQUEST_RATE_LIMITED: 429,
  REQUEST_METHOD_NOT_ALLOWED: 405,
  REQUEST_TOO_LARGE: 413,
  REQUEST_UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL_ERROR: 500,
  RATE_LIMIT_UNCONFIGURED: 503,
  PIN_UNCONFIGURED: 503,
  STAFF_AUTH_UNCONFIGURED: 503,
  PARTNER_AUTH_UNCONFIGURED: 503,
  HANDOVER_UNCONFIGURED: 503,
  SIGNING_UNCONFIGURED: 503,
  SERVICE_UNAVAILABLE: 503,
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
  const override = STATUS_OVERRIDES[code];
  if (override !== undefined) return override;
  return 422;
}

/**
 * Refus d'authentification : un seul détail, quelle que soit la cause (compte
 * désactivé, défi expiré, clé clonée…), pour ne rien apprendre à un attaquant.
 * La cause exacte reste dans le message interne.
 */
const AUTH_REFUSED_DETAIL: Readonly<Record<ProblemLocale, string>> = {
  fr: 'Authentification refusée',
  en: 'Authentication refused',
};

function problemWith(status: number, code: ErrorCode, locale: ProblemLocale, rawDetail?: string): Problem {
  const detail =
    code === 'STAFF_AUTH_INVALID' || code === 'PARTNER_AUTH_INVALID'
      ? AUTH_REFUSED_DETAIL[locale]
      : rawDetail;
  return {
    type: `urn:achat:problem:${TYPE_SLUGS[code] ?? code.toLowerCase().replaceAll('_', '-')}`,
    title: errorMessage(code, locale),
    status,
    code,
    // Un détail égal au code n'apprend rien : il n'est pas répété.
    ...(detail === undefined || detail === '' || detail === code ? {} : { detail }),
  };
}

function problem(code: ErrorCode, locale: ProblemLocale, rawDetail?: string): Problem {
  return problemWith(statusForCode(code), code, locale, rawDetail);
}

/**
 * Refus émis par la couche HTTP (Nest/Express) : le statut réel est conservé,
 * le code reste générique et aucun message interne n'est exposé.
 */
export function problemForStatus(status: number, locale: ProblemLocale): Problem {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    return problemWith(500, 'INTERNAL_ERROR', locale);
  }
  const code: ErrorCode =
    status === 400
      ? 'REQUEST_INVALID'
      : status === 401
        ? 'REQUEST_UNAUTHENTICATED'
        : status === 403
          ? 'PERMISSION_DENIED'
          : status === 404
            ? 'ROUTE_NOT_FOUND'
            : status === 405
              ? 'REQUEST_METHOD_NOT_ALLOWED'
              : status === 409
                ? 'REQUEST_CONFLICT'
                : status === 413
                  ? 'REQUEST_TOO_LARGE'
                  : status === 415
                    ? 'REQUEST_UNSUPPORTED_MEDIA_TYPE'
                    : status === 429
                      ? 'REQUEST_RATE_LIMITED'
                      : status === 500
                        ? 'INTERNAL_ERROR'
                        : status >= 500
                          ? 'SERVICE_UNAVAILABLE'
                          : 'REQUEST_INVALID';
  return problemWith(status, code, locale);
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
export function toProblem(error: unknown, locale: ProblemLocale = 'fr'): Problem {
  if (error instanceof BusinessError) {
    return problem(error.code, locale, error.message);
  }
  if (typeof error === 'object' && error !== null) {
    const pg = error as { code?: unknown; message?: unknown };
    if (pg.code === 'P0001' && typeof pg.message === 'string') {
      const match = SQL_BUSINESS_PREFIX.exec(pg.message);
      if (match !== null && KNOWN_CODES.has(match[1] ?? '')) {
        const detail = pg.message.slice(match[0].length).slice(0, MAX_DETAIL_LENGTH);
        return problem(match[1] as ErrorCode, locale, detail);
      }
    }
    if (pg.code === '23505' || pg.code === '40001') {
      return problem('REQUEST_CONFLICT', locale);
    }
    if (typeof pg.code === 'string' && /^(23|22)/.test(pg.code)) {
      return problem('REQUEST_INVALID', locale);
    }
  }
  return problem('INTERNAL_ERROR', locale);
}
