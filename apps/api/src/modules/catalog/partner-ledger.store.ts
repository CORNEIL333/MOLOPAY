import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * D42 : identifiant comptable (UUID v7 immuable) attribué par la base à la
 * première validation du partenaire. Null tant que le partenaire n'a jamais
 * été validé.
 */
export async function getPartnerLedgerOwner(client: SqlClient, partnerId: string): Promise<string | null> {
  const result = await client.query<{ owner_id: string }>(
    'SELECT owner_id FROM catalog.partner_ledger_identity WHERE partner_id = $1',
    [partnerId],
  );
  return result.rows[0]?.owner_id ?? null;
}
