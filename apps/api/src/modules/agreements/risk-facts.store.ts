import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

/** SEC-FRD-001 : annulations par le client depuis `since` (une par objectif). */
export async function listCustomerCancellationsSince(
  client: SqlClient,
  since: Date,
): Promise<readonly { readonly customerId: string; readonly agreementId: string; readonly cancelledAt: Date }[]> {
  const result = await client.query<{ customer_id: string; agreement_id: string; created_at: Date }>(
    `SELECT a.customer_id, e.agreement_id, e.created_at
       FROM agreements.status_event e JOIN agreements.agreement a ON a.id = e.agreement_id
      WHERE e.kind = 'TRANSITION' AND e.to_status = 'CANCELLED_BY_CUSTOMER' AND e.created_at > $1
      ORDER BY e.created_at`,
    [since],
  );
  return result.rows.map((row) => ({ customerId: row.customer_id, agreementId: row.agreement_id, cancelledAt: row.created_at }));
}
