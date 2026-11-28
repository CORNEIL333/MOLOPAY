import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import { problemForStatus, statusForCode, toProblem } from './problem';

describe('RFC 9457 · traduction des erreurs', () => {
  it.each([
    ['IDENTITY_SESSION_INVALID', 401],
    ['IDENTITY_SESSION_EXPIRED', 401],
    ['ORIGIN_FORBIDDEN', 403],
    ['IDENTITY_PIN_LOCKED', 403],
    ['MAKER_CANNOT_APPROVE', 403],
    ['ADMIN_FORBIDDEN', 403],
    ['ADMIN_SCOPE_DENIED', 403],
    ['ADMIN_AMOUNT_LIMIT', 403],
    ['STAFF_AUTH_INVALID', 401],
    ['STAFF_AUTH_UNCONFIGURED', 503],
    ['PARTNER_AUTH_INVALID', 401],
    ['PARTNER_AUTH_UNCONFIGURED', 503],
    ['PARTNER_ROLE_DENIED', 403],
    ['HANDOVER_UNCONFIGURED', 503],
    ['SIGNING_UNCONFIGURED', 503],
    ['SIGNING_UNAVAILABLE', 503],
    ['CLIENT_UPGRADE_REQUIRED', 426],
    ['IDENTITY_LANGUAGE_INVALID', 400],
    ['IDENTITY_ACCOUNT_NOT_FOUND', 404],
    ['IDENTITY_DECEASE_CASE_EXISTS', 409],
    ['IDENTITY_DECEASE_CASE_NOT_FOUND', 404],
    ['IDENTITY_DECEASE_ALREADY_DECIDED', 409],
    ['IDENTITY_ACCOUNT_DECEASED', 409],
    ['IDENTITY_TERMS_NOT_ACCEPTED', 422],
    ['REPORT_PERIOD_INVALID', 400],
    ['ADMIN_TECH_ADMIN_LIMIT', 422],
    ['AGREEMENT_ACTIVE_LIMIT_REACHED', 422],
    ['AGREEMENT_LIMITS_NOT_CONFIGURED', 422],
    ['NOTIFICATION_CHANNEL_UNCHANGED', 409],
    ['SMS_UNCONFIGURED', 503],
    ['SMS_DELIVERY_FAILED', 503],
    ['IDENTITY_ACCOUNT_EXISTS', 409],
    ['SETTLEMENT_OUTGOING_FROZEN', 409],
    ['SETTLEMENT_FREEZE_STATE', 409],
    ['SETTLEMENT_FREEZE_EXPIRED', 422],
    ['AGREEMENT_NOT_FOUND', 404],
    ['UNAUTHORIZED_TRANSITION', 409],
    ['AGREEMENT_LOCKED', 409],
    ['IDEMPOTENCY_KEY_REUSED', 409],
    ['AGREEMENT_INVALID_REQUEST', 400],
    ['CATALOG_FIELD_FORBIDDEN', 400],
    ['AGREEMENT_PLAN_MISMATCH', 422],
    ['AGREEMENT_LEDGER_LINK_REQUIRED', 422],
    ['INTERNAL_ERROR', 500],
    ['REQUEST_RATE_LIMITED', 429],
    ['RATE_LIMIT_UNCONFIGURED', 503],
    ['REQUEST_UNAUTHENTICATED', 401],
    ['REQUEST_METHOD_NOT_ALLOWED', 405],
    ['REQUEST_TOO_LARGE', 413],
    ['REQUEST_UNSUPPORTED_MEDIA_TYPE', 415],
    ['SERVICE_UNAVAILABLE', 503],
  ] as const)('%s → %i', (code, status) => {
    expect(statusForCode(code)).toBe(status);
  });

  it('reprend le code et le message d’une erreur métier', () => {
    expect(toProblem(new BusinessError('AGREEMENT_LOCKED', 'Objectif verrouillé'))).toEqual({
      type: 'urn:achat:problem:agreement-locked',
      title: 'Accord verrouillé',
      status: 409,
      code: 'AGREEMENT_LOCKED',
      detail: 'Objectif verrouillé',
    });
  });

  it('titre anglais quand la langue demandée est l’anglais, détail métier conservé', () => {
    const problem = toProblem(new BusinessError('AGREEMENT_LOCKED', 'Objectif verrouillé'), 'en');
    expect(problem).toMatchObject({ title: 'Agreement locked', code: 'AGREEMENT_LOCKED', detail: 'Objectif verrouillé' });
  });

  it('un détail égal au code n’est pas répété', () => {
    expect(toProblem(new BusinessError('REQUEST_INVALID'))).not.toHaveProperty('detail');
  });

  it('reprend le code connu d’une exception de déclencheur SQL', () => {
    const problem = toProblem({
      code: 'P0001',
      message: 'AGREEMENT_OFFER_NOT_AVAILABLE: offre indisponible pour le modèle A',
    });
    expect(problem).toMatchObject({
      status: 422,
      code: 'AGREEMENT_OFFER_NOT_AVAILABLE',
      detail: 'offre indisponible pour le modèle A',
    });
  });

  it('refuse un code de déclencheur inconnu → 500 sans détail', () => {
    const problem = toProblem({ code: 'P0001', message: 'FORGED_CODE: message' });
    expect(problem).toEqual({
      type: 'urn:achat:problem:internal-error',
      title: 'Erreur interne',
      status: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it('borne le détail d’un message de déclencheur', () => {
    const problem = toProblem({ code: 'P0001', message: `AGREEMENT_LOCKED: ${'x'.repeat(1000)}` });
    expect(problem.detail?.length).toBe(300);
  });

  it.each([
    ['unicité', '23505', 409, 'REQUEST_CONFLICT'],
    ['sérialisation', '40001', 409, 'REQUEST_CONFLICT'],
    ['contrainte CHECK', '23514', 400, 'REQUEST_INVALID'],
    ['format', '22P02', 400, 'REQUEST_INVALID'],
  ])('violation SQL (%s) → code générique sans détail', (_label, sqlState, status, code) => {
    const problem = toProblem({ code: sqlState, message: 'violates constraint "secret_name"' });
    expect(problem).toMatchObject({ status, code });
    expect(problem.detail).toBeUndefined();
  });

  it('erreur inattendue → 500 sans détail', () => {
    expect(toProblem(new Error('pile interne'))).not.toHaveProperty('detail');
    expect(toProblem('texte')).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });
});

describe('authentification : détail uniforme quelle que soit la cause (revue indépendante)', () => {
  it.each([
    ['PARTNER_AUTH_INVALID', new BusinessError('PARTNER_AUTH_INVALID', 'Session absente')],
    ['PARTNER_AUTH_INVALID', { code: 'P0001', message: 'PARTNER_AUTH_INVALID: compte désactivé' }],
    ['PARTNER_AUTH_INVALID', { code: 'P0001', message: 'PARTNER_AUTH_INVALID: compteur non croissant (clé clonée ?)' }],
    ['PARTNER_AUTH_INVALID', { code: 'P0001', message: 'PARTNER_AUTH_INVALID: défi expiré' }],
    ['STAFF_AUTH_INVALID', new BusinessError('STAFF_AUTH_INVALID', 'Session invalide')],
    ['STAFF_AUTH_INVALID', { code: 'P0001', message: 'STAFF_AUTH_INVALID: compte désactivé' }],
  ] as const)('%s : « Authentification refusée » seulement', (code, error) => {
    expect(toProblem(error)).toMatchObject({ status: 401, code, detail: 'Authentification refusée' });
  });

  it('les autres codes gardent leur détail', () => {
    expect(toProblem({ code: 'P0001', message: 'KYC_INVALID_REQUEST: rapprochement déjà examiné' })).toMatchObject({ detail: 'rapprochement déjà examiné' });
  });
});

describe('NF-COMP-002 · refus émis par la couche HTTP (statut conservé)', () => {
  it.each([
    [400, 400, 'REQUEST_INVALID'],
    [401, 401, 'REQUEST_UNAUTHENTICATED'],
    [403, 403, 'PERMISSION_DENIED'],
    [404, 404, 'ROUTE_NOT_FOUND'],
    [405, 405, 'REQUEST_METHOD_NOT_ALLOWED'],
    [409, 409, 'REQUEST_CONFLICT'],
    [413, 413, 'REQUEST_TOO_LARGE'],
    [415, 415, 'REQUEST_UNSUPPORTED_MEDIA_TYPE'],
    [429, 429, 'REQUEST_RATE_LIMITED'],
    [500, 500, 'INTERNAL_ERROR'],
    [503, 503, 'SERVICE_UNAVAILABLE'],
    [502, 502, 'SERVICE_UNAVAILABLE'],
    [418, 418, 'REQUEST_INVALID'],
  ] as const)('%i → statut %i, code %s', (input, status, code) => {
    const problem = problemForStatus(input, 'fr');
    expect(problem).toMatchObject({ status, code });
    expect(problem).not.toHaveProperty('detail');
  });

  it('un statut hors 400–599 devient une 500 sans détail', () => {
    expect(problemForStatus(204, 'fr')).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(problemForStatus(Number.NaN, 'fr')).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });

  it('titre localisé en anglais', () => {
    expect(problemForStatus(404, 'en')).toMatchObject({ title: 'Resource not found' });
  });
});
