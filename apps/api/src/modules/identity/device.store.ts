import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

/** Appareil de signature (clé publique Ed25519 en PEM), lu en base pour vérifier une signature client. */
export type SigningDeviceRecord = {
  readonly id: string;
  readonly accountId: string;
  readonly status: string;
  readonly publicKeyPem: string;
};

export async function getSigningDevice(client: SqlClient, deviceId: string): Promise<SigningDeviceRecord | null> {
  const result = await client.query<{ id: string; account_id: string; status: string; public_key_pem: string }>(
    'SELECT id, account_id, status, public_key_pem FROM identity.device WHERE id = $1',
    [deviceId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : { id: row.id, accountId: row.account_id, status: row.status, publicKeyPem: row.public_key_pem };
}
