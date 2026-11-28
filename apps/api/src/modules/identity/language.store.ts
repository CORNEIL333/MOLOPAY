import type { PoolClient } from 'pg';
import { BusinessError } from '@achat/contracts';

type SqlClient = Pick<PoolClient, 'query'>;
export type AppLanguage = 'fr' | 'en';

/** Liste blanche : seules les deux langues de l'application (français de référence, anglais). */
export function parseAppLanguage(value: unknown): AppLanguage {
  if (value !== 'fr' && value !== 'en') throw new BusinessError('IDENTITY_LANGUAGE_INVALID', 'Langue non prise en charge (fr ou en)');
  return value;
}

/**
 * D121 : l'application déclare la langue choisie par le client ; elle sert aux
 * notifications suivantes. La base n'écrit rien si la langue ne change pas et
 * refuse un compte bloqué (IDENTITY_ACCOUNT_BLOCKED).
 */
export async function declareLanguage(client: SqlClient, accountId: string, language: AppLanguage): Promise<AppLanguage> {
  const result = await client.query<{ language: string }>('SELECT identity.declare_language($1, $2) AS language', [accountId, parseAppLanguage(language)]);
  return parseAppLanguage(result.rows[0]?.language);
}
