import type { PoolClient } from 'pg';
import { CURRENT_TERMS_VERSION } from '@achat/contracts';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * F-ACC-004 : acceptation par le client de la version courante des conditions
 * (horodatée par la base, en ajout seul). Une seconde acceptation de la même
 * version ne crée rien et rend l'horodatage d'origine.
 */
export async function acceptCurrentTerms(client: SqlClient, accountId: string): Promise<{ readonly version: string; readonly acceptedAt: string }> {
  await client.query(
    'INSERT INTO identity.terms_acceptance (account_id, version, accepted_at) VALUES ($1, $2, now()) ON CONFLICT (account_id, version) DO NOTHING',
    [accountId, CURRENT_TERMS_VERSION],
  );
  const row = (await client.query<{ accepted_at: Date }>(
    'SELECT accepted_at FROM identity.terms_acceptance WHERE account_id = $1 AND version = $2',
    [accountId, CURRENT_TERMS_VERSION],
  )).rows[0];
  if (row === undefined) throw new Error('acceptation introuvable après enregistrement');
  return { version: CURRENT_TERMS_VERSION, acceptedAt: row.accepted_at.toISOString() };
}

export async function currentTermsAccepted(client: SqlClient, accountId: string): Promise<boolean> {
  const row = (await client.query<{ accepted: boolean }>('SELECT identity.has_accepted_terms($1, $2) AS accepted', [accountId, CURRENT_TERMS_VERSION])).rows[0];
  return row?.accepted === true;
}
