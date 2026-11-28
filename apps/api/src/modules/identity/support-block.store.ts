import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * C4 / F-ACC-006 : blocage d'un compte client par le support. La base fait
 * tout en une instruction (compte, appareils, sessions) et refuse un compte
 * inconnu ou déjà bloqué (migration 0068). Renvoie l'instant du blocage.
 */
export async function blockAccountBySupport(client: SqlClient, input: { readonly accountId: string; readonly reason: string }): Promise<string> {
  const row = (await client.query<{ blocked_at: Date }>('SELECT identity.block_account_by_support($1, $2) AS blocked_at', [input.accountId, input.reason])).rows[0];
  return (row?.blocked_at ?? new Date(0)).toISOString();
}
