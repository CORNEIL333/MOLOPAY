import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import { statusForCode, toProblem } from './problem';

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
    ['SIGNING_UNCONFIGURED', 503],
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
  ] as const)('%s → %i', (code, status) => {
    expect(statusForCode(code)).toBe(status);
  });

  it('reprend le code et le message d’une erreur métier', () => {
    expect(toProblem(new BusinessError('AGREEMENT_LOCKED', 'Objectif verrouillé'))).toEqual({
      type: 'urn:achat:problem:agreement-locked',
      title: 'Conflit',
      status: 409,
      code: 'AGREEMENT_LOCKED',
      detail: 'Objectif verrouillé',
    });
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
