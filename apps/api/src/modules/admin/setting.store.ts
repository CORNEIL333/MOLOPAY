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

/**
 * Publie la version suivante d'un paramètre depuis une demande
 * FINANCIAL_SETTING approuvée ; la base vérifie que clé et valeur sont celles
 * de la demande et que l'auteur est son préparateur (0003).
 */
export async function publishApprovedSetting(
  client: SqlClient,
  input: { readonly key: string; readonly value: JsonValue; readonly approvalRequestId: string; readonly actorId: string },
): Promise<{ readonly version: number }> {
  const result = await client.query<{ version: number }>(
    `INSERT INTO admin.setting_version (key, version, value, created_by, created_at, approval_request_id)
     SELECT $1, COALESCE(max(version), 0) + 1, $2::jsonb, $3, now(), $4 FROM admin.setting_version WHERE key = $1
     RETURNING version`,
    [input.key, JSON.stringify(input.value), input.actorId, input.approvalRequestId],
  );
  return Object.freeze({ version: result.rows[0]?.version ?? 0 });
}
