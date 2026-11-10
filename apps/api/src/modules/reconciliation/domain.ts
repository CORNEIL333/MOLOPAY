import { BusinessError } from '@achat/contracts';
import { xaf } from '@achat/money';

// CDC_04 § 7, INT-REC-003 : classes d'écart.
export const DISCREPANCY_KINDS = ['IN_TRANSIT', 'FEES', 'DUPLICATE', 'UNKNOWN'] as const;
export type DiscrepancyKind = (typeof DISCREPANCY_KINDS)[number];

// INT-REC-004 : tout écart de plus de 48 h est escaladé.
export const ESCALATION_DELAY_HOURS = 48;

const ISO_UTC_MS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type SegregationInputs = {
  /** Σ soldes 2100-* + 2200-* + 2300-* (dérivés du grand livre). */
  readonly thirdPartyFundsXaf: bigint;
  /** Solde du relevé du compte cantonné. */
  readonly statementBalanceXaf: bigint;
  /** Encaissements en transit identifiés (créance 1200 sur l'agrégateur). */
  readonly incomingInTransitXaf: bigint;
  /** Règlements en transit identifiés. */
  readonly outgoingInTransitXaf: bigint;
};

function nonNegative(value: bigint, field: string): bigint {
  const amount = xaf(value).amount;
  if (amount < 0n) {
    throw new BusinessError('INVALID_AMOUNT', `${field} ne peut pas être négatif`);
  }
  return amount;
}

/**
 * INT-REC-002 : écart = (relevé + transit entrant − transit sortant) − fonds
 * de tiers. Nul quand l'invariant de cantonnement tient ; tout écart non
 * expliqué différent de 0 FCFA ouvre un incident.
 */
export function segregationGap(input: SegregationInputs): bigint {
  const statement = nonNegative(input.statementBalanceXaf, 'relevé');
  const incoming = nonNegative(input.incomingInTransitXaf, 'transit entrant');
  const outgoing = nonNegative(input.outgoingInTransitXaf, 'transit sortant');
  const funds = xaf(input.thirdPartyFundsXaf).amount;
  return xaf(statement + incoming - outgoing - funds).amount;
}

function parseInstant(value: string): number {
  if (!ISO_UTC_MS_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new BusinessError('RECONCILIATION_INVALID_REQUEST', 'date ISO 8601 UTC attendue');
  }
  return Date.parse(value);
}

/** INT-REC-004 : un incident ouvert depuis plus de 48 h est escaladé. */
export function isEscalated(openedAt: string, now: string): boolean {
  return parseInstant(now) - parseInstant(openedAt) > ESCALATION_DELAY_HOURS * 3_600_000;
}
