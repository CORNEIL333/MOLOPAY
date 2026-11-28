import type { PoolClient } from 'pg';

// Code du plan comptable réservé aux fonds de tiers détenus pour un client.
const CLIENT_FUNDS_CODE = '2100';

export type LedgerTotals = {
  readonly debitTotalXaf: bigint;
  readonly creditTotalXaf: bigint;
};

type TotalsRow = {
  debit_total_xaf: string;
  credit_total_xaf: string;
};

/**
 * Lit les totaux dérivés du grand livre pour le compte de fonds client.
 * Le solde n'est jamais stocké : il se recalcule à partir des écritures.
 */
export async function readClientLedgerTotals(
  client: PoolClient,
  accountId: string,
): Promise<LedgerTotals> {
  const result = await client.query<TotalsRow>(
    `SELECT COALESCE(SUM(debit_total_xaf), 0)::text AS debit_total_xaf,
            COALESCE(SUM(credit_total_xaf), 0)::text AS credit_total_xaf
       FROM ledger.account_balance
      WHERE owner_type = 'CLIENT'
        AND owner_id = $1
        AND code = $2
        AND nature = 'LIABILITY'`,
    [accountId, CLIENT_FUNDS_CODE],
  );
  const row = result.rows[0];
  return {
    debitTotalXaf: BigInt(row?.debit_total_xaf ?? '0'),
    creditTotalXaf: BigInt(row?.credit_total_xaf ?? '0'),
  };
}
