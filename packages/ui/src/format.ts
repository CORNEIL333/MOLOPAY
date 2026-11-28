const CANONICAL_AMOUNT = /^(0|[1-9][0-9]*)$/;
const INT64_MAX = 9_223_372_036_854_775_807n;

/**
 * Formate un montant XAF fourni par l'API (« 25000 ») en « 25 000 FCFA ».
 * Aucun calcul : la chaîne est seulement groupée, jamais convertie en flottant.
 */
export function formatXaf(amount: string): string {
  if (typeof amount !== 'string' || !CANONICAL_AMOUNT.test(amount)) {
    throw new RangeError('XAF_AMOUNT_INVALID');
  }
  if (BigInt(amount) > INT64_MAX) {
    throw new RangeError('XAF_AMOUNT_OUT_OF_RANGE');
  }
  const grouped = amount.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${grouped}\u00a0FCFA`;
}

export function isCanonicalXafAmount(amount: string): boolean {
  return typeof amount === 'string' && CANONICAL_AMOUNT.test(amount);
}
