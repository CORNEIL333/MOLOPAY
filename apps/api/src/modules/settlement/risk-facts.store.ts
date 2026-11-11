import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

/** SEC-FRD-001 : remises enregistrées depuis `since`, par boutique (une par objectif). */
export async function listHandoversSince(
  client: SqlClient,
  since: Date,
): Promise<readonly { readonly partnerId: string; readonly agreementId: string; readonly usedAt: Date }[]> {
  const result = await client.query<{ partner_id: string; agreement_id: string; used_at: Date }>(
    'SELECT partner_id, agreement_id, used_at FROM settlement.handover WHERE used_at > $1 ORDER BY used_at',
    [since],
  );
  return result.rows.map((row) => ({ partnerId: row.partner_id, agreementId: row.agreement_id, usedAt: row.used_at }));
}
