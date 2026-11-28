import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import {
  DISCREPANCY_KINDS,
  ESCALATION_DELAY_HOURS,
  isEscalated,
  segregationGap,
} from './domain';

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof BusinessError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

describe('INT-REC-002 invariant de cantonnement', () => {
  it('écart nul quand fonds de tiers = relevé + transit entrant − transit sortant', () => {
    expect(
      segregationGap({
        thirdPartyFundsXaf: 15_000n,
        statementBalanceXaf: 10_000n,
        incomingInTransitXaf: 7_000n,
        outgoingInTransitXaf: 2_000n,
      }),
    ).toBe(0n);
  });

  it('écart positif : plus d’argent que de fonds de tiers', () => {
    expect(
      segregationGap({
        thirdPartyFundsXaf: 5_000n,
        statementBalanceXaf: 5_001n,
        incomingInTransitXaf: 0n,
        outgoingInTransitXaf: 0n,
      }),
    ).toBe(1n);
  });

  it('écart négatif : fonds de tiers non couverts', () => {
    expect(
      segregationGap({
        thirdPartyFundsXaf: 5_000n,
        statementBalanceXaf: 0n,
        incomingInTransitXaf: 4_000n,
        outgoingInTransitXaf: 0n,
      }),
    ).toBe(-1_000n);
  });

  it('NF-FUN-001 refuse un relevé ou un transit négatif (INVALID_AMOUNT)', () => {
    expect(
      codeOf(() =>
        segregationGap({
          thirdPartyFundsXaf: 0n,
          statementBalanceXaf: -1n,
          incomingInTransitXaf: 0n,
          outgoingInTransitXaf: 0n,
        }),
      ),
    ).toBe('INVALID_AMOUNT');
    expect(
      codeOf(() =>
        segregationGap({
          thirdPartyFundsXaf: 0n,
          statementBalanceXaf: 0n,
          incomingInTransitXaf: 0n,
          outgoingInTransitXaf: -1n,
        }),
      ),
    ).toBe('INVALID_AMOUNT');
  });
});

describe('INT-REC-003/004 classement et ancienneté des écarts', () => {
  it('les quatre classes de CDC_04 § 7, dans cet ordre', () => {
    expect(DISCREPANCY_KINDS).toEqual(['IN_TRANSIT', 'FEES', 'DUPLICATE', 'UNKNOWN']);
  });

  it('escalade au-delà de 48 h, pas avant', () => {
    expect(ESCALATION_DELAY_HOURS).toBe(48);
    const opened = '2026-11-01T00:00:00.000Z';
    expect(isEscalated(opened, '2026-11-03T00:00:00.000Z')).toBe(false);
    expect(isEscalated(opened, '2026-11-03T00:00:00.001Z')).toBe(true);
  });

  it('refuse une date invalide (RECONCILIATION_INVALID_REQUEST)', () => {
    expect(codeOf(() => isEscalated('hier', '2026-11-03T00:00:00.000Z'))).toBe(
      'RECONCILIATION_INVALID_REQUEST',
    );
  });
});
