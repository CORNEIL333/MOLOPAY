import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_AMOUNT,
  MoneyError,
  abs,
  add,
  allocateByWeights,
  compare,
  equals,
  isNegative,
  isZero,
  mulDivRoundHalfUp,
  multiplyByInteger,
  negate,
  parseXaf,
  splitEvenly,
  subtract,
  sum,
  toCanonicalString,
  xaf,
} from './index';

const PROPERTY_RUNS = Number(process.env['MONEY_PROPERTY_RUNS'] ?? 10_000);

function expectMoneyError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(MoneyError);
    expect((error as MoneyError).code).toBe(code);
    return;
  }
  throw new Error(`MoneyError ${code} attendue, aucune erreur levée`);
}

const amounts = fc.bigInt({ min: 0n, max: 10_000_000_000n });
const signedAmounts = fc.bigInt({
  min: -10_000_000_000n,
  max: 10_000_000_000n,
});

describe('NF-FUN-001 · Money XAF en bigint', () => {
  it('NF-FUN-001 stocke un montant bigint gelé et le sérialise sans flottant', () => {
    const value = xaf(5_000n);
    expect(value.amount).toBe(5_000n);
    expect(Object.isFrozen(value)).toBe(true);
    expect(toCanonicalString(value)).toBe('5000');
  });

  it('NF-FUN-001 refuse un number flottant', () => {
    expectMoneyError(() => xaf(5_000 as unknown as bigint), 'INVALID_AMOUNT');
    expectMoneyError(() => xaf(12.5 as unknown as bigint), 'INVALID_AMOUNT');
  });

  it('NF-FUN-001 refuse les formats décimaux ambigus', () => {
    for (const invalid of ['', '1 000', '12.5', '1e3', '+5', '007', '-0']) {
      expectMoneyError(() => parseXaf(invalid), 'INVALID_AMOUNT');
    }
  });

  it('NF-FUN-001 accepte les entiers décimaux canoniques', () => {
    expect(parseXaf('0').amount).toBe(0n);
    expect(parseXaf('5000').amount).toBe(5_000n);
    expect(parseXaf('-5000').amount).toBe(-5_000n);
  });

  it('NF-FUN-001 refuse un dépassement de BIGINT', () => {
    expectMoneyError(() => xaf(MAX_AMOUNT + 1n), 'AMOUNT_OVERFLOW');
  });

  it('NF-FUN-001 addition et soustraction sont inverses (propriété)', () => {
    fc.assert(
      fc.property(amounts, amounts, (left, right) => {
        const a = xaf(left);
        const b = xaf(right);
        expect(subtract(add(a, b), b)).toEqual(a);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('NF-FUN-001 compare et égalité respectent les bigint', () => {
    expect(compare(xaf(10n), xaf(9n))).toBe(1);
    expect(compare(xaf(9n), xaf(10n))).toBe(-1);
    expect(compare(xaf(10n), xaf(10n))).toBe(0);
    expect(equals(xaf(10n), xaf(10n))).toBe(true);
    expect(isZero(xaf(0n))).toBe(true);
    expect(isNegative(negate(xaf(1n)))).toBe(true);
    expect(abs(negate(xaf(7n))).amount).toBe(7n);
  });

  it('NF-FUN-001 sum conserve la somme exacte (propriété)', () => {
    fc.assert(
      fc.property(fc.array(amounts, { maxLength: 20 }), (values) => {
        const money = values.map((value) => xaf(value));
        const expected = values.reduce((total, value) => total + value, 0n);
        expect(sum(money).amount).toBe(expected);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('NF-FUN-001 multiplyByInteger est distributif (propriété)', () => {
    fc.assert(
      fc.property(amounts, fc.bigInt({ min: 0n, max: 1_000n }), (value, factor) => {
        const money = xaf(value);
        expect(multiplyByInteger(money, factor).amount).toBe(value * factor);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});

describe('NF-FUN-002 · répartition en versements et arrondis', () => {
  it('NF-FUN-002 splitEvenly conserve la somme exacte (propriété)', () => {
    fc.assert(
      fc.property(
        signedAmounts,
        fc.integer({ min: 1, max: 12 }),
        (total, parts) => {
          const result = splitEvenly(xaf(total), parts);
          expect(result).toHaveLength(parts);
          expect(sum(result).amount).toBe(total);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('NF-FUN-002 splitEvenly ne diffère que d’au plus 1 XAF (propriété)', () => {
    fc.assert(
      fc.property(
        amounts,
        fc.integer({ min: 1, max: 12 }),
        (total, parts) => {
          const result = splitEvenly(xaf(total), parts);
          const first = result[0]?.amount ?? 0n;
          for (const money of result) {
            const difference =
              money.amount > first ? money.amount - first : first - money.amount;
            expect(difference <= 1n).toBe(true);
          }
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('NF-FUN-002 refuse un nombre de versements invalide', () => {
    expectMoneyError(() => splitEvenly(xaf(100n), 0), 'INVALID_ALLOCATION');
    expectMoneyError(() => splitEvenly(xaf(100n), 1.5), 'INVALID_ALLOCATION');
  });

  it('NF-FUN-002 allocateByWeights conserve la somme exacte (propriété)', () => {
    fc.assert(
      fc.property(
        amounts,
        fc.array(fc.bigInt({ min: 0n, max: 1_000n }), {
          minLength: 1,
          maxLength: 8,
        }),
        (total, weights) => {
          fc.pre(weights.some((weight) => weight > 0n));
          const result = allocateByWeights(xaf(total), weights);
          expect(result).toHaveLength(weights.length);
          expect(sum(result).amount).toBe(total);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('NF-FUN-002 allocateByWeights est déterministe et au plus fort reste', () => {
    const result = allocateByWeights(xaf(100n), [1n, 1n, 1n]);
    expect(result.map((money) => money.amount)).toEqual([34n, 33n, 33n]);
    expect(result).toEqual(allocateByWeights(xaf(100n), [1n, 1n, 1n]));
    expectMoneyError(() => allocateByWeights(xaf(100n), []), 'INVALID_ALLOCATION');
    expectMoneyError(
      () => allocateByWeights(xaf(100n), [0n, 0n]),
      'INVALID_ALLOCATION',
    );
    expectMoneyError(
      () => allocateByWeights(negate(xaf(100n)), [1n]),
      'INVALID_ALLOCATION',
    );
  });

  it('NF-FUN-002 mulDivRoundHalfUp arrondit au demi-franc supérieur', () => {
    expect(mulDivRoundHalfUp(xaf(5n), 1n, 2n).amount).toBe(3n);
    expect(mulDivRoundHalfUp(xaf(4n), 1n, 3n).amount).toBe(1n);
    expect(mulDivRoundHalfUp(xaf(5n), 1n, 3n).amount).toBe(2n);
    expect(mulDivRoundHalfUp(xaf(1n), 1n, 2n).amount).toBe(1n);
    expect(mulDivRoundHalfUp(xaf(0n), 1n, 2n).amount).toBe(0n);
  });

  it('NF-FUN-002 mulDivRoundHalfUp reste dans l’intervalle attendu (propriété)', () => {
    fc.assert(
      fc.property(
        amounts,
        fc.bigInt({ min: 0n, max: 10_000n }),
        fc.bigInt({ min: 1n, max: 10_000n }),
        (value, numerator, denominator) => {
          const result = mulDivRoundHalfUp(xaf(value), numerator, denominator);
          const exact = value * numerator;
          const twice = 2n * result.amount * denominator;
          const lower = 2n * exact - denominator;
          const upper = 2n * exact + denominator;
          expect(twice >= lower && twice <= upper).toBe(true);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('NF-FUN-002 refuse un prorata négatif ou un dénominateur nul', () => {
    expectMoneyError(
      () => mulDivRoundHalfUp(negate(xaf(1n)), 1n, 2n),
      'INVALID_ALLOCATION',
    );
    expectMoneyError(
      () => mulDivRoundHalfUp(xaf(1n), 1n, 0n),
      'INVALID_ALLOCATION',
    );
  });
});
