import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * F-CAT-005 / D57 : unités encore disponibles d'une offre (stock déclaré −
 * réservations − remises depuis la version) ; null si précommande ou non publiée.
 */
export async function availableUnits(client: SqlClient, offerId: string): Promise<number | null> {
  const result = await client.query<{ n: number | null }>('SELECT agreements.available_stock($1) AS n', [offerId]);
  return result.rows[0]?.n ?? null;
}
