import type { PoolClient } from 'pg';
import { BusinessError, CURRENT_TERMS_VERSION } from '@achat/contracts';

type SqlClient = Pick<PoolClient, 'query'>;

export type CustomerProfile = {
  readonly accountId: string;
  readonly phoneMasked: string;
  readonly memberSince: string;
  readonly legalNameDeclared: boolean;
  /** F-ACC-004 : version en vigueur, et son acceptation par le compte (sinon : aucun nouvel engagement). */
  readonly currentTermsVersion: string;
  readonly termsAccepted: boolean;
  /** D121 : langue déclarée par l'application (français par défaut) ; celle des notifications. */
  readonly language: 'fr' | 'en';
};


/**
 * C2 / contrat 1.0 : profil du client connecté. Minimal par construction :
 * ni numéro en clair, ni nom légal, ni niveau KYC (D77 : le niveau révélerait
 * indirectement un rapprochement sanctions), seulement le fait qu'un nom a
 * été déclaré (pour proposer l'étape d'identité).
 */
export async function readCustomerProfile(client: SqlClient, accountId: string): Promise<CustomerProfile> {
  const row = (await client.query<{ phone_masked: string; member_since: string; declared: boolean; accepted: boolean; language: 'fr' | 'en' }>(
    `SELECT a.phone_masked, to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS member_since,
            EXISTS (SELECT 1 FROM identity.legal_name_declaration d WHERE d.account_id = a.id) AS declared,
            identity.has_accepted_terms(a.id, $2) AS accepted,
            identity.preferred_language(a.id) AS language
       FROM identity.account a WHERE a.id = $1`,
    [accountId, CURRENT_TERMS_VERSION],
  )).rows[0];
  if (row === undefined) {
    throw new BusinessError('IDENTITY_SESSION_INVALID', 'Session invalide');
  }
  return Object.freeze({ accountId, phoneMasked: row.phone_masked, memberSince: row.member_since, legalNameDeclared: row.declared, currentTermsVersion: CURRENT_TERMS_VERSION, termsAccepted: row.accepted, language: row.language });
}
