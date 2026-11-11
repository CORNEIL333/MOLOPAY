import type { JsonValue } from '@achat/chain';
import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

/** Dernière version publiée d'un paramètre (maker-checker en amont) ; null si jamais publié. */
export async function getLatestSettingValue(client: SqlClient, key: string): Promise<JsonValue | null> {
  const result = await client.query<{ value: JsonValue }>(
    'SELECT value FROM admin.setting_version WHERE key = $1 ORDER BY version DESC LIMIT 1',
    [key],
  );
  return result.rows[0]?.value ?? null;
}
