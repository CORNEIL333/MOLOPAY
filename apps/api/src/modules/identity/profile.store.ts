import type { PoolClient } from 'pg';
import { BusinessError } from '@achat/contracts';

type SqlClient = Pick<PoolClient, 'query'>;

export type CustomerProfile = {
  readonly accountId: string;
  readonly phoneMasked: string;
  readonly memberSince: string;
  readonly legalNameDeclared: boolean;
};

/** Numéro masqué : indicatif et premier chiffre, puis seulement les deux derniers chiffres. */
export function maskPhone(phone: string): string {
  const digits = phone.slice(1);
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) {
    throw new BusinessError('INTERNAL_ERROR', 'numéro enregistré invalide');
  }
  return `+${digits.slice(0, 3)}${'•'.repeat(digits.length - 5)}${digits.slice(-2)}`;
}

/**
 * C2 / contrat 1.0 : profil du client connecté. Minimal par construction :
 * ni numéro en clair, ni nom légal, ni niveau KYC (D77 : le niveau révélerait
 * indirectement un rapprochement sanctions), seulement le fait qu'un nom a
 * été déclaré (pour proposer l'étape d'identité).
 */
export async function readCustomerProfile(client: SqlClient, accountId: string): Promise<CustomerProfile> {
  const row = (await client.query<{ phone: string; member_since: string; declared: boolean }>(
    `SELECT a.phone, to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS member_since,
            EXISTS (SELECT 1 FROM identity.legal_name_declaration d WHERE d.account_id = a.id) AS declared
       FROM identity.account a WHERE a.id = $1`,
    [accountId],
  )).rows[0];
  if (row === undefined) {
    throw new BusinessError('IDENTITY_SESSION_INVALID', 'Session invalide');
  }
  return Object.freeze({ accountId, phoneMasked: maskPhone(row.phone), memberSince: row.member_since, legalNameDeclared: row.declared });
}
