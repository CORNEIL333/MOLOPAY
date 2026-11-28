import { describe, expect, it } from 'vitest';
import { CUSTOMER_QUOTA_ACTIONS, CustomerQuotaExceeded, parseCustomerQuotaAction } from './customer-quota';
import { toProblem } from './problem';

describe('SEC-API-003 · périmètre et erreurs de quotas compte', () => {
  for (const action of CUSTOMER_QUOTA_ACTIONS) {
    it(`accepte uniquement l'action ${action} connue`, () => { expect(parseCustomerQuotaAction(action)).toBe(action); });
  }
  for (const action of [undefined, null, {}, [], '', 'SIGN_OUT', 'BLOCK', 'OTHER', 'security_read']) {
    it('refuse une action non autorisée : REQUEST_INVALID', () => {
      expect(() => parseCustomerQuotaAction(action)).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }));
    });
  }
  it('une limite dépassée est un problème 429 stable sans compteur ni identifiant', () => {
    const error = new CustomerQuotaExceeded(3);
    expect(error.retryAfterSeconds).toBe(3);
    expect(toProblem(error)).toMatchObject({ code: 'REQUEST_RATE_LIMITED', status: 429 });
  });
  for (const delay of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 86401]) {
    it('refuse un Retry-After interne invalide', () => { expect(() => new CustomerQuotaExceeded(delay)).toThrow(expect.objectContaining({ code: 'INTERNAL_ERROR' })); });
  }
});
