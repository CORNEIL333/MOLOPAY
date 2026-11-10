import fc from 'fast-check';
import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import { computeQuote, type QuotePlan } from './quote';

const MONTHLY: QuotePlan = { planId: 'plan-c', model: 'PLANNED_EXPENSE', rhythm: 'MONTHLY', minAmountXaf: 10_000n, maxDurationMonths: 12 };

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error: unknown) {
    return error instanceof BusinessError ? error.code : 'AUTRE';
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

describe('F-CAT-004 devis : coût total et échéancier simulés', () => {
  it('mensuel : une échéance par mois, sans frais, somme exacte, fin de mois respectée', () => {
    const quote = computeQuote({ plan: MONTHLY, totalXaf: 100_000n, durationMonths: 3, startDate: '2026-01-31' });
    expect(quote).toEqual({
      totalXaf: 100_000n,
      feesXaf: 0n,
      installments: [
        { dueDate: '2026-02-28', amountXaf: 33_334n },
        { dueDate: '2026-03-31', amountXaf: 33_333n },
        { dueDate: '2026-04-30', amountXaf: 33_333n },
      ],
    });
  });

  it('hebdomadaire : une échéance par semaine pleine de la période', () => {
    const quote = computeQuote({
      plan: { ...MONTHLY, rhythm: 'WEEKLY', minAmountXaf: 1_000n },
      totalXaf: 40_000n,
      durationMonths: 1,
      startDate: '2026-02-01',
    });
    expect(quote.installments.map((i) => i.dueDate)).toEqual(['2026-02-08', '2026-02-15', '2026-02-22', '2026-03-01']);
  });

  it('libre : une seule échéance, à la fin de la durée', () => {
    const quote = computeQuote({ plan: { ...MONTHLY, rhythm: 'FREE' }, totalXaf: 50_000n, durationMonths: 2, startDate: '2026-11-10' });
    expect(quote.installments).toEqual([{ dueDate: '2027-01-10', amountXaf: 50_000n }]);
  });

  it('refuse une durée au-delà du plan (CATALOG_PLAN_NOT_APPROVED)', () => {
    expect(codeOf(() => computeQuote({ plan: MONTHLY, totalXaf: 100_000n, durationMonths: 13, startDate: '2026-01-01' }))).toBe(
      'CATALOG_PLAN_NOT_APPROVED',
    );
  });

  it('refuse une échéance sous le minimum du plan (CATALOG_QUOTE_BELOW_MINIMUM)', () => {
    expect(codeOf(() => computeQuote({ plan: MONTHLY, totalXaf: 29_999n, durationMonths: 3, startDate: '2026-01-01' }))).toBe(
      'CATALOG_QUOTE_BELOW_MINIMUM',
    );
  });

  it('refuse une date de départ invalide (CATALOG_INVALID_REQUEST)', () => {
    expect(codeOf(() => computeQuote({ plan: MONTHLY, totalXaf: 100_000n, durationMonths: 3, startDate: '2026-02-30' }))).toBe(
      'CATALOG_INVALID_REQUEST',
    );
  });

  it('propriétés : somme exacte, aucune échéance sous le minimum, dates strictement croissantes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('DAILY', 'WEEKLY', 'MONTHLY', 'FREE' as const),
        fc.integer({ min: 1, max: 12 }),
        fc.bigInt({ min: 1n, max: 50_000_000n }),
        fc.date({ min: new Date('2026-01-01T00:00:00Z'), max: new Date('2030-12-31T00:00:00Z'), noInvalidDate: true }),
        (rhythm, months, total, start) => {
          const plan: QuotePlan = { ...MONTHLY, rhythm, minAmountXaf: 1n, maxDurationMonths: 12 };
          let quote;
          try {
            quote = computeQuote({ plan, totalXaf: total, durationMonths: months, startDate: start.toISOString().slice(0, 10) });
          } catch (error: unknown) {
            // Seul refus admissible : un total trop petit pour le nombre d'échéances.
            expect(error instanceof BusinessError && error.code === 'CATALOG_QUOTE_BELOW_MINIMUM').toBe(true);
            return;
          }
          expect(quote.installments.reduce((sum, i) => sum + i.amountXaf, 0n)).toBe(total);
          expect(quote.installments.every((i) => i.amountXaf >= 1n)).toBe(true);
          const dates = quote.installments.map((i) => i.dueDate);
          expect([...dates].sort()).toEqual(dates);
          expect(new Set(dates).size).toBe(dates.length);
        },
      ),
      { numRuns: 300 },
    );
  });
});
