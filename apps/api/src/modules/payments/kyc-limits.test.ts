import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import { D43_KYC_LIMITS, kycLimitsSettingValue } from './kyc-limits';

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error: unknown) {
    return error instanceof BusinessError ? error.code : 'AUTRE';
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

describe('D43 paramètre kyc_limits', () => {
  it('reprend les valeurs décidées, montants en texte décimal', () => {
    expect(kycLimitsSettingValue(D43_KYC_LIMITS)).toEqual({
      levels: {
        BASIC: { holding_xaf: '200000', monthly_xaf: '500000' },
        STRONG: { holding_xaf: '2000000', monthly_xaf: '2000000' },
      },
    });
  });

  it('refuse un niveau 2 moins généreux que le niveau 1 (PAYMENT_INVALID_REQUEST)', () => {
    expect(
      codeOf(() =>
        kycLimitsSettingValue({
          BASIC: { holdingXaf: 200_000n, monthlyXaf: 500_000n },
          STRONG: { holdingXaf: 100_000n, monthlyXaf: 500_000n },
        }),
      ),
    ).toBe('PAYMENT_INVALID_REQUEST');
  });

  it('refuse un plafond nul (INVALID_AMOUNT)', () => {
    expect(
      codeOf(() =>
        kycLimitsSettingValue({
          BASIC: { holdingXaf: 0n, monthlyXaf: 0n },
          STRONG: { holdingXaf: 1n, monthlyXaf: 1n },
        }),
      ),
    ).toBe('INVALID_AMOUNT');
  });
});
