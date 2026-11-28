import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { authenticateSession, type Account, type Device, type Session } from './domain';

// Un Client ou un PoolClient suffit : le store n'utilise que `query`.
type SqlClient = Pick<PoolClient, 'query'>;

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Jeton base64url de 32 octets (issueSessionTokens).
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Contenu du cookie `client_session` : `<sessionId>.<jeton d'accès>`.
 * L'identifiant permet une lecture par clé primaire ; le jeton est comparé à
 * son empreinte en temps constant par le domaine.
 */
export function sessionCookieValue(sessionId: string, accessToken: string): string {
  return `${sessionId}.${accessToken}`;
}

export function parseSessionCookie(value: string | undefined): {
  readonly sessionId: string;
  readonly accessToken: string;
} {
  if (typeof value !== 'string' || value.length > 200) {
    throw new BusinessError('IDENTITY_SESSION_INVALID', 'Session absente');
  }
  const separator = value.indexOf('.');
  const sessionId = value.slice(0, separator);
  const accessToken = value.slice(separator + 1);
  if (
    separator < 0 ||
    !UUID_V7_PATTERN.test(sessionId) ||
    !ACCESS_TOKEN_PATTERN.test(accessToken)
  ) {
    throw new BusinessError('IDENTITY_SESSION_INVALID', 'Session illisible');
  }
  return { sessionId, accessToken };
}

export type AuthenticatedCustomer = {
  readonly accountId: string;
  readonly deviceId: string;
  readonly sessionId: string;
};

type AuthRow = {
  id: string;
  account_id: string;
  device_id: string;
  access_token_hash: Buffer;
  refresh_token_hash: Buffer;
  access_issued_at: Date;
  access_expires_at: Date;
  refresh_expires_at: Date;
  created_at: Date;
  revoked_at: Date | null;
  phone: string;
  account_status: string;
  phone_verified_at: Date;
  kyc_level: string;
  device_account_id: string;
  public_key_pem: string;
  fingerprint: Buffer;
  device_name: string;
  device_status: string;
  registered_at: Date;
  device_revoked_at: Date | null;
  now: Date;
};

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * Authentifie le cookie de session contre la base : session non révoquée et
 * non expirée (horloge base), compte actif, appareil actif, jeton exact.
 * Toute anomalie donne IDENTITY_SESSION_INVALID ou IDENTITY_SESSION_EXPIRED,
 * sans distinguer une session inconnue d'un jeton faux.
 */
export async function authenticateSessionCookie(
  client: SqlClient,
  cookieValue: string | undefined,
): Promise<AuthenticatedCustomer> {
  const { sessionId, accessToken } = parseSessionCookie(cookieValue);
  const result = await client.query<AuthRow>(
    `SELECT s.id, s.account_id, s.device_id, s.access_token_hash,
            s.refresh_token_hash, s.access_issued_at, s.access_expires_at,
            s.refresh_expires_at, s.created_at, s.revoked_at,
            a.phone, a.status AS account_status, a.phone_verified_at, a.kyc_level,
            d.account_id AS device_account_id, d.public_key_pem, d.fingerprint,
            d.name AS device_name, d.status AS device_status, d.registered_at,
            d.revoked_at AS device_revoked_at,
            clock_timestamp() AS now
     FROM identity.session s
     JOIN identity.account a ON a.id = s.account_id
     JOIN identity.device d ON d.id = s.device_id
     WHERE s.id = $1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new BusinessError('IDENTITY_SESSION_INVALID', 'Session inconnue');
  }
  const session: Session = {
    id: row.id,
    accountId: row.account_id,
    deviceId: row.device_id,
    accessTokenHash: row.access_token_hash,
    refreshTokenHash: row.refresh_token_hash,
    accessIssuedAt: row.access_issued_at.toISOString(),
    accessExpiresAt: row.access_expires_at.toISOString(),
    refreshExpiresAt: row.refresh_expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    revokedAt: iso(row.revoked_at),
  };
  const account: Account = {
    id: row.account_id,
    phone: row.phone,
    status: row.account_status === 'ACTIVE' ? 'ACTIVE' : 'BLOCKED',
    phoneVerifiedAt: row.phone_verified_at.toISOString(),
    kycLevel: row.kyc_level === 'STRONG' ? 'STRONG' : row.kyc_level === 'BASIC' ? 'BASIC' : 'NONE',
    blockedAt: null,
    blockChannel: null,
    blockReason: null,
  };
  const device: Device = {
    id: row.device_id,
    accountId: row.device_account_id,
    publicKeyPem: row.public_key_pem,
    fingerprint: row.fingerprint,
    name: row.device_name,
    status: row.device_status === 'ACTIVE' ? 'ACTIVE' : 'REVOKED',
    registeredAt: row.registered_at.toISOString(),
    revokedAt: iso(row.device_revoked_at),
  };
  authenticateSession({
    session,
    accessToken,
    account,
    device,
    now: row.now.toISOString(),
  });
  return { accountId: account.id, deviceId: device.id, sessionId: session.id };
}
