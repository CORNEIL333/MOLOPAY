import { timingSafeEqual } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import {
  ACCESS_TOKEN_DEFAULT_TTL_MS,
  createOtpProof,
  issueSessionTokens,
  OTP_PURPOSES,
  otpCodeMatches,
  sessionTokenHash,
  type IssuedSession,
  type OtpChallenge,
  type OtpProof,
  type OtpPurpose,
  type Session,
} from './domain';

const OTP_COLUMNS = `id, phone, purpose, binding, code_hash, expires_at,
  attempts_remaining, consumed_at`;

const SESSION_COLUMNS = `id, account_id, device_id, access_token_hash,
  refresh_token_hash, access_issued_at, access_expires_at,
  refresh_expires_at, created_at, revoked_at`;

type OtpRow = {
  id: string;
  phone: string;
  purpose: string;
  binding: string;
  code_hash: Buffer;
  expires_at: Date;
  attempts_remaining: number;
  consumed_at: Date | null;
};

type SessionRow = {
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
};

type SessionStateRow = {
  refresh_token_hash: Buffer;
  revoked_at: Date | null;
  refresh_expires_at: Date;
  access_issued_at: Date;
  account_status: string;
  device_status: string;
};

function toChallenge(row: OtpRow): OtpChallenge {
  if (!(OTP_PURPOSES as readonly string[]).includes(row.purpose)) {
    throw new BusinessError('IDENTITY_INVALID_REQUEST', 'Objet OTP inconnu');
  }
  return {
    id: row.id,
    phone: row.phone,
    purpose: row.purpose as OtpPurpose,
    binding: row.binding,
    codeHash: row.code_hash,
    expiresAt: row.expires_at.toISOString(),
    attemptsRemaining: row.attempts_remaining,
    consumedAt: row.consumed_at === null ? null : row.consumed_at.toISOString(),
  };
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    accountId: row.account_id,
    deviceId: row.device_id,
    accessTokenHash: row.access_token_hash,
    refreshTokenHash: row.refresh_token_hash,
    accessIssuedAt: row.access_issued_at.toISOString(),
    accessExpiresAt: row.access_expires_at.toISOString(),
    refreshExpiresAt: row.refresh_expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at === null ? null : row.revoked_at.toISOString(),
  };
}

async function databaseNow(client: PoolClient): Promise<Date> {
  const result = await client.query<{ now: Date }>(
    'SELECT clock_timestamp() AS now',
  );
  return result.rows[0]?.now ?? new Date();
}

async function otpFailure(
  client: PoolClient,
  challengeId: string,
): Promise<BusinessError> {
  const result = await client.query<OtpRow>(
    `SELECT ${OTP_COLUMNS} FROM identity.otp_challenge WHERE id = $1`,
    [challengeId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return new BusinessError('IDENTITY_OTP_INVALID', 'Défi OTP inconnu');
  }
  if (row.consumed_at !== null) {
    return new BusinessError('IDENTITY_OTP_REPLAYED', 'OTP déjà consommé');
  }
  if (row.expires_at.getTime() <= (await databaseNow(client)).getTime()) {
    return new BusinessError('IDENTITY_OTP_EXPIRED', 'OTP expiré');
  }
  return new BusinessError(
    'IDENTITY_OTP_LOCKED',
    'OTP verrouillé après trop d’essais',
  );
}

/**
 * Vérifie un OTP et décrémente son compteur dans une seule requête : deux
 * tentatives concurrentes ne peuvent pas réutiliser le même essai restant.
 */
export async function verifyOtpFromStore(
  client: PoolClient,
  input: {
    readonly challengeId: string;
    readonly submitted: string;
    readonly pepper: Uint8Array;
  },
): Promise<{ readonly challenge: OtpChallenge; readonly proof: OtpProof }> {
  const read = await client.query<OtpRow>(
    `SELECT ${OTP_COLUMNS} FROM identity.otp_challenge WHERE id = $1`,
    [input.challengeId],
  );
  const row = read.rows[0];
  if (row === undefined) {
    throw new BusinessError('IDENTITY_OTP_INVALID', 'Défi OTP inconnu');
  }
  const challenge = toChallenge(row);
  const matched = otpCodeMatches(challenge, input.submitted, input.pepper);

  const update = await client.query<OtpRow>(
    `UPDATE identity.otp_challenge
        SET attempts_remaining = attempts_remaining - 1,
            consumed_at = CASE
              WHEN $2 THEN clock_timestamp()
              ELSE consumed_at
            END
      WHERE id = $1
        AND consumed_at IS NULL
        AND attempts_remaining > 0
        AND expires_at > clock_timestamp()
      RETURNING ${OTP_COLUMNS}`,
    [input.challengeId, matched],
  );
  const updated = update.rows[0];
  if (updated === undefined) {
    throw await otpFailure(client, input.challengeId);
  }
  const next = toChallenge(updated);
  if (!matched) {
    throw new BusinessError(
      next.attemptsRemaining === 0
        ? 'IDENTITY_OTP_LOCKED'
        : 'IDENTITY_OTP_INVALID',
      next.attemptsRemaining === 0
        ? 'OTP verrouillé après trop d’essais'
        : 'Code OTP invalide',
    );
  }
  if (next.consumedAt === null) {
    throw new BusinessError(
      'IDENTITY_OTP_INVALID',
      'Consommation OTP non enregistrée',
    );
  }
  return {
    challenge: next,
    proof: createOtpProof(next, next.consumedAt, input.pepper),
  };
}

async function sessionFailure(
  client: PoolClient,
  sessionId: string,
  refreshTokenHash: Buffer,
): Promise<BusinessError> {
  const result = await client.query<SessionStateRow>(
    `SELECT s.refresh_token_hash, s.revoked_at, s.refresh_expires_at,
            s.access_issued_at, a.status AS account_status,
            d.status AS device_status
       FROM identity.session s
       JOIN identity.account a ON a.id = s.account_id
       JOIN identity.device d ON d.id = s.device_id
      WHERE s.id = $1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return new BusinessError('IDENTITY_SESSION_INVALID', 'Session inconnue');
  }
  if (row.account_status !== 'ACTIVE') {
    return new BusinessError('IDENTITY_ACCOUNT_BLOCKED', 'Compte bloqué');
  }
  if (row.device_status !== 'ACTIVE') {
    return new BusinessError('IDENTITY_DEVICE_REVOKED', 'Appareil révoqué');
  }
  if (row.revoked_at !== null) {
    return new BusinessError('IDENTITY_SESSION_INVALID', 'Session révoquée');
  }
  if (
    row.refresh_expires_at.getTime() <= (await databaseNow(client)).getTime()
  ) {
    return new BusinessError(
      'IDENTITY_SESSION_EXPIRED',
      'Jeton de rafraîchissement expiré',
    );
  }
  if (
    row.refresh_token_hash.length !== refreshTokenHash.length ||
    !timingSafeEqual(row.refresh_token_hash, refreshTokenHash)
  ) {
    return new BusinessError(
      'IDENTITY_SESSION_INVALID',
      'Jeton de rafraîchissement invalide',
    );
  }
  return new BusinessError('IDENTITY_SESSION_INVALID', 'Rotation refusée');
}

/**
 * Fait tourner le jeton de rafraîchissement en une seule requête : l'ancien
 * jeton ne peut servir qu'une fois, la fenêtre et l'appareil sont vérifiés
 * par la base sur son horloge.
 */
export async function rotateSessionFromStore(
  client: PoolClient,
  input: {
    readonly sessionId: string;
    readonly refreshToken: string;
    readonly accessTtlMs?: number;
  },
): Promise<IssuedSession> {
  const accessTtl = input.accessTtlMs ?? ACCESS_TOKEN_DEFAULT_TTL_MS;
  if (
    !Number.isSafeInteger(accessTtl) ||
    accessTtl <= 0 ||
    accessTtl > ACCESS_TOKEN_DEFAULT_TTL_MS
  ) {
    throw new BusinessError(
      'IDENTITY_INVALID_REQUEST',
      'Durée d’accès hors bornes',
    );
  }
  const previousHash = sessionTokenHash(input.refreshToken);
  const tokens = issueSessionTokens();
  const update = await client.query<SessionRow>(
    `UPDATE identity.session s
        SET access_token_hash = $2,
            refresh_token_hash = $3,
            access_issued_at = clock_timestamp(),
            access_expires_at = clock_timestamp()
              + make_interval(secs => $4::double precision / 1000)
      WHERE s.id = $1
        AND s.refresh_token_hash = $5
        AND s.revoked_at IS NULL
        AND s.access_issued_at <= clock_timestamp()
        AND s.refresh_expires_at > clock_timestamp()
        AND clock_timestamp()
              + make_interval(secs => $4::double precision / 1000)
            < s.refresh_expires_at
        AND EXISTS (
          SELECT 1 FROM identity.account a
           WHERE a.id = s.account_id AND a.status = 'ACTIVE'
        )
        AND EXISTS (
          SELECT 1 FROM identity.device d
           WHERE d.id = s.device_id
             AND d.account_id = s.account_id
             AND d.status = 'ACTIVE'
        )
      RETURNING ${SESSION_COLUMNS}`,
    [
      input.sessionId,
      tokens.accessTokenHash,
      tokens.refreshTokenHash,
      accessTtl,
      previousHash,
    ],
  );
  const updated = update.rows[0];
  if (updated === undefined) {
    throw await sessionFailure(client, input.sessionId, previousHash);
  }
  return {
    session: toSession(updated),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}
