import { parseXaf } from '@achat/money';
import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

export type OrphanPaymentEntry = {
  readonly entryId: string;
  readonly seq: number;
  readonly recordedAt: string;
};

/**
 * INT-LED-008 : écritures PAYMENT_CONFIRMED sans contribution. Toute ligne
 * renvoyée est un écart à classer (INT-REC-003), jamais corrigé en place.
 */
export async function listOrphanPaymentEntries(client: SqlClient): Promise<OrphanPaymentEntry[]> {
  const result = await client.query<{ entry_id: string; seq: string; recorded_at: Date }>(
    'SELECT entry_id, seq::text, recorded_at FROM reconciliation.orphan_payment_entries()',
  );
  return result.rows.map((row) => ({
    entryId: row.entry_id,
    seq: Number(row.seq),
    recordedAt: row.recorded_at.toISOString(),
  }));
}

/** INT-REC-005 : solde du compte de suspens 2900, à solder ou justifier en fin de mois. */
export async function readSuspenseBalance(client: SqlClient): Promise<bigint> {
  const result = await client.query<{ balance: string }>(
    'SELECT reconciliation.suspense_balance_xaf()::text AS balance',
  );
  return parseXaf(result.rows[0]?.balance ?? '0').amount;
}
