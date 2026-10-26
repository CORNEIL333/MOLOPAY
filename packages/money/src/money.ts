import { MoneyError } from './errors';

export const XAF = 'XAF' as const;
export type Currency = typeof XAF;

export type Money = {
  readonly currency: Currency;
  readonly amount: bigint;
};

export const MIN_AMOUNT = -(2n ** 63n);
export const MAX_AMOUNT = 2n ** 63n - 1n;

function assertInt64(amount: bigint): void {
  if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    throw new MoneyError(
      'AMOUNT_OVERFLOW',
      `Montant hors plage BIGINT: ${amount.toString()}`,
    );
  }
}

export function xaf(amount: bigint): Money {
  if (typeof amount !== 'bigint') {
    throw new MoneyError(
      'INVALID_AMOUNT',
      'Un montant XAF doit être un bigint, jamais un flottant',
    );
  }
  assertInt64(amount);
  return Object.freeze({ currency: XAF, amount });
}

const DECIMAL_PATTERN = /^(?:0|-?[1-9][0-9]*)$/;

export function parseXaf(text: string): Money {
  if (typeof text !== 'string' || !DECIMAL_PATTERN.test(text)) {
    throw new MoneyError(
      'INVALID_AMOUNT',
      'Montant XAF invalide: chaîne décimale entière attendue',
    );
  }
  return xaf(BigInt(text));
}

export function zeroXaf(): Money {
  return xaf(0n);
}

export function fromMinorUnitsForTestsOnly(amount: bigint): Money {
  return xaf(amount);
}

export function add(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return xaf(left.amount + right.amount);
}

export function subtract(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return xaf(left.amount - right.amount);
}

export function negate(value: Money): Money {
  return xaf(-value.amount);
}

export function abs(value: Money): Money {
  return xaf(value.amount < 0n ? -value.amount : value.amount);
}

export function multiplyByInteger(value: Money, factor: bigint): Money {
  if (typeof factor !== 'bigint') {
    throw new MoneyError(
      'INVALID_AMOUNT',
      'Le multiplicateur doit être un bigint',
    );
  }
  return xaf(value.amount * factor);
}

export function compare(left: Money, right: Money): -1 | 0 | 1 {
  assertSameCurrency(left, right);
  if (left.amount < right.amount) {
    return -1;
  }
  if (left.amount > right.amount) {
    return 1;
  }
  return 0;
}

export function equals(left: Money, right: Money): boolean {
  return left.currency === right.currency && left.amount === right.amount;
}

export function isZero(value: Money): boolean {
  return value.amount === 0n;
}

export function isNegative(value: Money): boolean {
  return value.amount < 0n;
}

export function sum(values: readonly Money[]): Money {
  let total = 0n;
  for (const value of values) {
    if (value.currency !== XAF) {
      throw new MoneyError('CURRENCY_MISMATCH', 'Devise non supportée');
    }
    total += value.amount;
    assertInt64(total);
  }
  return xaf(total);
}

export function toCanonicalString(value: Money): string {
  return value.amount.toString();
}

export function toJSON(value: Money): string {
  return toCanonicalString(value);
}

function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new MoneyError('CURRENCY_MISMATCH', 'Devises différentes');
  }
}

/**
 * Répartit un montant en `parts` versements entiers dont la somme est exacte.
 * Le reliquat (0 à parts-1 XAF) est affecté aux premiers versements.
 */
export function splitEvenly(total: Money, parts: number): Money[] {
  if (!Number.isSafeInteger(parts) || parts < 1) {
    throw new MoneyError(
      'INVALID_ALLOCATION',
      'Le nombre de versements doit être un entier >= 1',
    );
  }
  const sign = total.amount < 0n ? -1n : 1n;
  const absolute = total.amount < 0n ? -total.amount : total.amount;
  const divisor = BigInt(parts);
  const base = absolute / divisor;
  const remainder = Number(absolute % divisor);
  const result: Money[] = [];
  for (let index = 0; index < parts; index += 1) {
    const extra = index < remainder ? 1n : 0n;
    result.push(xaf(sign * (base + extra)));
  }
  return result;
}

/**
 * Répartition au plus fort reste, déterministe (égalité tranchée par l'index).
 * La somme des parts est exactement égale au total.
 */
export function allocateByWeights(
  total: Money,
  weights: readonly bigint[],
): Money[] {
  if (weights.length === 0) {
    throw new MoneyError(
      'INVALID_ALLOCATION',
      'Au moins un poids est requis',
    );
  }
  if (total.amount < 0n) {
    throw new MoneyError(
      'INVALID_ALLOCATION',
      'La répartition pondérée exige un montant positif ou nul',
    );
  }
  let weightSum = 0n;
  for (const weight of weights) {
    if (typeof weight !== 'bigint' || weight < 0n) {
      throw new MoneyError(
        'INVALID_ALLOCATION',
        'Les poids doivent être des bigint positifs ou nuls',
      );
    }
    weightSum += weight;
  }
  if (weightSum === 0n) {
    throw new MoneyError(
      'INVALID_ALLOCATION',
      'La somme des poids doit être strictement positive',
    );
  }

  const floors: bigint[] = [];
  const remainders: bigint[] = [];
  let allocated = 0n;
  for (const weight of weights) {
    const product = total.amount * weight;
    const floor = product / weightSum;
    floors.push(floor);
    remainders.push(product % weightSum);
    allocated += floor;
  }

  let leftover = total.amount - allocated;
  const order = weights
    .map((_, index) => index)
    .sort((left, right) => {
      const leftRemainder = remainders[left] ?? 0n;
      const rightRemainder = remainders[right] ?? 0n;
      if (leftRemainder === rightRemainder) {
        return left - right;
      }
      return leftRemainder > rightRemainder ? -1 : 1;
    });

  const result = floors.slice();
  for (const index of order) {
    if (leftover === 0n) {
      break;
    }
    result[index] = (result[index] ?? 0n) + 1n;
    leftover -= 1n;
  }

  return result.map((amount) => xaf(amount));
}

/**
 * Calcule `value * numerator / denominator` arrondi au plus proche,
 * les demi-francs étant arrondis vers le haut. Entrées non négatives.
 */
export function mulDivRoundHalfUp(
  value: Money,
  numerator: bigint,
  denominator: bigint,
): Money {
  if (value.amount < 0n) {
    throw new MoneyError(
      'INVALID_ALLOCATION',
      'Le calcul de prorata exige un montant positif ou nul',
    );
  }
  if (
    typeof numerator !== 'bigint' ||
    typeof denominator !== 'bigint' ||
    numerator < 0n ||
    denominator <= 0n
  ) {
    throw new MoneyError(
      'INVALID_ALLOCATION',
      'Numérateur >= 0 et dénominateur > 0 requis',
    );
  }
  const rounded =
    (value.amount * numerator * 2n + denominator) / (denominator * 2n);
  return xaf(rounded);
}
