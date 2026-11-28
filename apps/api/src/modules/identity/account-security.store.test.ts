import { describe, expect, it } from 'vitest';
import { assertSecurityBody, type SecurityAction } from './account-security.store';

describe('SEC-AUTH-005 / F-ACC-006 · commandes de sécurité fermées', () => {
  for (const action of ['REVOKE_OTHERS', 'SIGN_OUT'] as const) {
    it('accepte seulement une commande vide pour la révocation', () => {
      expect(() => assertSecurityBody(action, undefined)).not.toThrow();
      expect(() => assertSecurityBody(action, {})).not.toThrow();
    });
  }
  it('exige le motif de blocage connu', () => {
    expect(() => assertSecurityBody('BLOCK', { reason: 'LOST_OR_STOLEN' })).not.toThrow();
  });
  for (const [action, body] of [
    ['BLOCK', {}], ['BLOCK', null], ['BLOCK', { reason: 'OTHER' }], ['BLOCK', { reason: 'LOST_OR_STOLEN', accountId: 'foreign' }],
    ['SIGN_OUT', { sessionId: 'foreign' }], ['REVOKE_OTHERS', { accountId: 'foreign' }], ['SIGN_OUT', []], ['BLOCK', 'LOST_OR_STOLEN'],
  ] as [SecurityAction, unknown][]) {
    it('refuse la cible client et les champs inconnus avec REQUEST_INVALID', () => {
      expect(() => assertSecurityBody(action, body)).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }));
    });
  }
});
