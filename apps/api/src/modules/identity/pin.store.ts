import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { verifyPinAttempt, type PinAttempt, type PinState } from './domain';

// Un Client ou un PoolClient suffit : le store n'utilise que `query`.
type SqlClient = Pick<PoolClient, 'query'>;

type PinRow = {
  account_id: string;
  device_id: string;
  pin_hash: string;
  failed_attempts: number;
  lockouts: number;
  locked_until: Date | null;
  now: Date;
};

export type PinVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'IDENTITY_PIN_INVALID' | 'IDENTITY_PIN_LOCKED' };

/**
 * Vérifie un PIN et enregistre le résultat (SEC-AUTH-002). La ligne est
 * verrouillée (`FOR UPDATE`) pendant toute la vérification : deux essais
 * simultanés sont décomptés l'un après l'autre, jamais en parallèle.
 *
 * Le résultat est ÉCRIT même en cas d'échec : l'appelant doit valider la
 * transaction avant de refuser l'opération (sinon l'échec serait effacé par
 * l'annulation). Un verrouillage actif est renvoyé sans évaluer le PIN. La
 * base (migration 0016) refuse toute écriture incohérente des compteurs.
 */
export async function verifyPinFromStore(
  client: SqlClient,
  input: {
    readonly accountId: string;
    readonly deviceId: string;
    readonly pin: string;
    readonly pepper: Uint8Array;
  },
): Promise<PinVerification> {
  const result = await client.query<PinRow>(
    `SELECT account_id, device_id, pin_hash, failed_attempts, lockouts,
            locked_until, clock_timestamp() AS now
     FROM identity.pin_credential
     WHERE device_id = $1 AND account_id = $2
     FOR UPDATE`,
    [input.deviceId, input.accountId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new BusinessError('IDENTITY_DEVICE_UNKNOWN', 'Aucun PIN pour cet appareil');
  }
  const state: PinState = {
    accountId: row.account_id,
    deviceId: row.device_id,
    hash: row.pin_hash,
    failedAttempts: row.failed_attempts,
    lockouts: row.lockouts,
    lockedUntil: row.locked_until === null ? null : row.locked_until.toISOString(),
  };
  const attempt: PinAttempt = await verifyPinAttempt(
    state,
    input.pin,
    input.pepper,
    row.now.toISOString(),
  );
  const unchanged =
    attempt.state.failedAttempts === state.failedAttempts &&
    attempt.state.lockouts === state.lockouts &&
    attempt.state.lockedUntil === state.lockedUntil;
  if (!unchanged) {
    await client.query(
      `UPDATE identity.pin_credential
       SET failed_attempts = $3, lockouts = $4, locked_until = $5, updated_at = now()
       WHERE device_id = $1 AND account_id = $2`,
      [
        input.deviceId,
        input.accountId,
        attempt.state.failedAttempts,
        attempt.state.lockouts,
        attempt.state.lockedUntil,
      ],
    );
  }
  if (attempt.ok) {
    return { ok: true };
  }
  return {
    ok: false,
    code: attempt.code === 'IDENTITY_PIN_LOCKED' ? 'IDENTITY_PIN_LOCKED' : 'IDENTITY_PIN_INVALID',
  };
}

/** Poivre PIN lu dans l'environnement (base64, 32 à 64 octets) ; aucun défaut. */
export function pinPepperFromEnv(env: NodeJS.ProcessEnv): Uint8Array {
  const raw = env['PIN_PEPPER']?.trim() ?? '';
  const pepper = Buffer.from(raw, 'base64');
  if (raw === '' || pepper.length < 32 || pepper.length > 64) {
    throw new Error('CONFIG_INVALID: PIN_PEPPER doit être du base64 de 32 à 64 octets');
  }
  return pepper;
}
