import { isNegative, parseXaf, toCanonicalString, type Money } from '@achat/money';

const STRICT_NON_NEGATIVE = /^(0|[1-9][0-9]*)$/;

function canonicalNonNegativeXaf(input: string | bigint | Money): string {
  if (typeof input === 'string') {
    if (!STRICT_NON_NEGATIVE.test(input)) {
      throw new RangeError('XAF_AMOUNT_INVALID');
    }
    try {
      return toCanonicalString(parseXaf(input));
    } catch {
      throw new RangeError('XAF_AMOUNT_OUT_OF_RANGE');
    }
  }
  if (typeof input === 'bigint') {
    if (input < 0n) {
      throw new RangeError('XAF_AMOUNT_INVALID');
    }
    try {
      return toCanonicalString(parseXaf(input.toString()));
    } catch {
      throw new RangeError('XAF_AMOUNT_OUT_OF_RANGE');
    }
  }
  if (isNegative(input)) {
    throw new RangeError('XAF_AMOUNT_INVALID');
  }
  return toCanonicalString(input);
}

/**
 * Formate un montant XAF entier (« 25000 », bigint ou Money) en « 25 000 FCFA »
 * sans jamais passer par un flottant (I-12, NF-FUN-001).
 */
export function formatXaf(
  amount: string | bigint | Money,
  options?: { readonly separator?: '\u00a0' | '\u202f' | ' ' },
): string {
  const digits = canonicalNonNegativeXaf(amount);
  const sep = options?.separator ?? '\u00a0';
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return `${grouped}${sep}FCFA`;
}

/** Variante GSM-7 (SMS et USSD) : espace ASCII ordinaire. */
export function formatXafSms(amount: string | bigint | Money): string {
  return formatXaf(amount, { separator: ' ' });
}

export function isCanonicalXafAmount(amount: string): boolean {
  return typeof amount === 'string' && STRICT_NON_NEGATIVE.test(amount);
}
