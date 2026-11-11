import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

/** SEC-FRD-001 : versements confirmés depuis `since` (faits pour la règle de vélocité). */
export async function listConfirmedContributionsSince(
  client: SqlClient,
  since: Date,
): Promise<readonly { readonly customerId: string; readonly contributionId: string; readonly confirmedAt: Date }[]> {
  const result = await client.query<{ customer_id: string; id: string; confirmed_at: Date }>(
    'SELECT customer_id, id, confirmed_at FROM payments.contribution WHERE confirmed_at > $1 ORDER BY confirmed_at',
    [since],
  );
  return result.rows.map((row) => ({ customerId: row.customer_id, contributionId: row.id, confirmedAt: row.confirmed_at }));
}
