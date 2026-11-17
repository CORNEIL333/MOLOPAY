import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * REG-LBC-001 / D68 : déclaration du nom légal par le client (versions en
 * ajout seul). Le nom est une donnée personnelle exigée par le niveau 1 :
 * jamais journalisé, jamais renvoyé ailleurs qu'au client lui-même.
 */
export function parseLegalName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BusinessError('KYC_INVALID_REQUEST', 'nom légal attendu');
  }
  const name = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 200 || /\p{Cc}/u.test(value) || !/\p{L}/u.test(name)) {
    throw new BusinessError('KYC_INVALID_REQUEST', 'nom légal invalide (2 à 200 caractères, lettres)');
  }
  return name;
}

export async function insertLegalNameDeclaration(client: SqlClient, input: { readonly id: string; readonly accountId: string; readonly legalName: string }): Promise<void> {
  await client.query(
    'INSERT INTO identity.legal_name_declaration (id, account_id, legal_name, declared_at) VALUES ($1, $2, $3, now())',
    [input.id, input.accountId, parseLegalName(input.legalName)],
  );
}
