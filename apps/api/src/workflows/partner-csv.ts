import type { PartnerOrder } from '../modules/agreements/partner-orders.store';

const COLUMNS = ['orderId', 'offerId', 'offerTitle', 'status', 'targetXaf', 'progressBasisPoints', 'createdAt', 'handedOverAt'] as const;

/**
 * Cellule CSV (RFC 4180). Une valeur commençant par un caractère qu'un
 * tableur interprète comme formule (= + - @, tabulation, retour chariot)
 * est préfixée d'une apostrophe (injection de formules, OWASP).
 */
function cell(value: string | number | null): string {
  if (value === null) {
    return '';
  }
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** F-PRT-004 : export CSV des commandes du partenaire (mêmes données que la liste, sans donnée client). */
export function ordersCsv(orders: readonly PartnerOrder[]): string {
  const lines = [COLUMNS.join(','), ...orders.map((order) => COLUMNS.map((column) => cell(order[column])).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}
