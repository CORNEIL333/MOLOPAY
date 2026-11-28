import type { ProtectedPhone } from './phone-key';
import { createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { uuidv7 } from '../ledger/domain';
import { verifyOtpFromStore } from './auth.store';
import {
  createAccount,
  createPinState,
  createSession,
  issueOtp,
  registerSignupDevice,
  type Account,
  type Device,
  type IssuedSession,
  type OtpProof,
} from './domain';
import { verifyPinFromStore } from './pin.store';

type SqlClient = Pick<PoolClient, 'query'>;

/** Objet d'un défi d'appareil : connexion (D71) ou renouvellement de session (SEC-AUTH-005). */
export type DeviceChallengePurpose = 'LOGIN' | 'REFRESH';

/** Contexte signé : une signature de connexion ne vaut jamais pour un renouvellement, et inversement. */
const CHALLENGE_CONTEXT: Readonly<Record<DeviceChallengePurpose, string>> = Object.freeze({
  LOGIN: 'molopay.client-login.v1',
  REFRESH: 'molopay.client-refresh.v1',
});

/** Refus uniforme de connexion : ni l'appareil, ni le défi, ni la signature ne sont distingués. */
function refused(): never {
  throw new BusinessError('IDENTITY_SESSION_INVALID', 'Authentification refusée');
}

async function databaseNow(client: SqlClient): Promise<string> {
  const row = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0];
  return (row?.now ?? new Date()).toISOString();
}

/** Clé publique de l'appareil reçue en SPKI DER (base64), convertie en PEM ; Ed25519 seulement. */
export function devicePublicKeyPem(spkiBase64: string): string {
  if (!/^[A-Za-z0-9+/_-]{40,200}={0,2}$/.test(spkiBase64)) {
    throw new BusinessError('IDENTITY_INVALID_REQUEST', 'Clé publique de l’appareil illisible');
  }
  try {
    const key = createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new Error('type');
    }
    return key.export({ type: 'spki', format: 'pem' }).toString();
  } catch {
    throw new BusinessError('IDENTITY_INVALID_REQUEST', 'Une clé publique Ed25519 (SPKI) est exigée');
  }
}

/**
 * F-ACC-001 : défi OTP d'inscription pour un numéro ; le code est rendu à
 * l'appelant pour envoi par SMS, jamais conservé en clair (empreinte poivrée).
 * La base limite le nombre de défis par numéro (migration 0066).
 */
export async function issueSignupOtp(
  client: SqlClient,
  input: { readonly phone: ProtectedPhone; readonly pepper: Uint8Array },
): Promise<{ readonly challengeId: string; readonly code: string; readonly expiresAt: string }> {
  // C14 : seule l'empreinte lie le défi au numéro ; le numéro n'entre que chiffré et masqué.
  const key = input.phone.key;
  const issued = issueOtp({ id: uuidv7(), phone: key, purpose: 'SIGNUP', binding: key, now: await databaseNow(client), pepper: input.pepper });
  const { challenge } = issued;
  await client.query(
    `INSERT INTO identity.otp_challenge (id, phone, purpose, binding, code_hash, expires_at, attempts_remaining, phone_ciphertext, phone_masked)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [challenge.id, challenge.phone, challenge.purpose, challenge.binding, challenge.codeHash, challenge.expiresAt, challenge.attemptsRemaining, input.phone.ciphertext, input.phone.masked],
  );
  return Object.freeze({ challengeId: challenge.id, code: issued.code, expiresAt: challenge.expiresAt });
}

/**
 * Vérifie un code OTP sans lever d'erreur métier OTP : l'appelant VALIDE la
 * transaction (l'essai consommé doit rester décompté), puis refuse.
 */
export async function tryVerifyOtp(
  client: SqlClient,
  input: { readonly challengeId: string; readonly code: string; readonly pepper: Uint8Array },
): Promise<{ readonly ok: true; readonly proof: OtpProof } | { readonly ok: false; readonly error: BusinessError }> {
  try {
    const { proof } = await verifyOtpFromStore(client, { challengeId: input.challengeId, submitted: input.code, pepper: input.pepper });
    return { ok: true, proof };
  } catch (error: unknown) {
    if (error instanceof BusinessError && error.code.startsWith('IDENTITY_OTP_')) {
      return { ok: false, error };
    }
    throw error;
  }
}

async function insertSession(client: SqlClient, issued: IssuedSession): Promise<void> {
  const { session } = issued;
  await client.query(
    `INSERT INTO identity.session (id, account_id, device_id, access_token_hash, refresh_token_hash, access_issued_at, access_expires_at, refresh_expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $6)`,
    [session.id, session.accountId, session.deviceId, session.accessTokenHash, session.refreshTokenHash, session.accessIssuedAt, session.accessExpiresAt, session.refreshExpiresAt],
  );
}

/**
 * F-ACC-001/002/004, SEC-AUTH-001 : compte, premier appareil, PIN, acceptation
 * des conditions et première session, dans une seule transaction, sur la
 * preuve OTP d'inscription. Numéro déjà inscrit : IDENTITY_ACCOUNT_EXISTS
 * (seul le détenteur du numéro, qui vient de recevoir le code, l'apprend).
 */
export async function completeSignup(
  client: SqlClient,
  input: {
    readonly proof: OtpProof;
    readonly otpPepper: Uint8Array;
    readonly pinPepper: Uint8Array;
    readonly devicePublicKeyPem: string;
    readonly deviceName: string;
    readonly pin: string;
    readonly termsVersion: string;
  },
): Promise<{ readonly accountId: string; readonly issued: IssuedSession }> {
  const now = await databaseNow(client);
  const existing = await client.query('SELECT 1 FROM identity.account WHERE phone = $1', [input.proof.phone]);
  if (existing.rowCount !== 0) {
    throw new BusinessError('IDENTITY_ACCOUNT_EXISTS', 'Un compte existe déjà pour ce numéro');
  }
  const account: Account = createAccount({ id: uuidv7(), phone: input.proof.phone, now, otpProof: input.proof, pepper: input.otpPepper });
  const device: Device = registerSignupDevice({
    id: uuidv7(), account, publicKeyPem: input.devicePublicKeyPem, name: input.deviceName, now, otpProof: input.proof, pepper: input.otpPepper,
  });
  const pin = await createPinState({ account, device, pin: input.pin, pepper: input.pinPepper, now });
  // Chiffré et masque recopiés du défi consommé (la base vérifie la recopie, 0076).
  await client.query(
    `INSERT INTO identity.account (id, phone, phone_verified_at, phone_ciphertext, phone_masked)
     SELECT $1, $2, $3, c.phone_ciphertext, c.phone_masked FROM identity.otp_challenge c WHERE c.id = $4`,
    [account.id, account.phone, account.phoneVerifiedAt, input.proof.challengeId],
  );
  await client.query(
    `INSERT INTO identity.device (id, account_id, public_key_pem, fingerprint, name, status, registered_at) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6)`,
    [device.id, device.accountId, device.publicKeyPem, device.fingerprint, device.name, device.registeredAt],
  );
  await client.query(
    `INSERT INTO identity.pin_credential (device_id, account_id, pin_hash, failed_attempts, lockouts, locked_until, updated_at) VALUES ($1, $2, $3, 0, 0, NULL, now())`,
    [pin.deviceId, pin.accountId, pin.hash],
  );
  await client.query('INSERT INTO identity.terms_acceptance (account_id, version, accepted_at) VALUES ($1, $2, now())', [account.id, input.termsVersion]);
  const issued = createSession({ id: uuidv7(), account, device, now: await databaseNow(client) });
  await insertSession(client, issued);
  return Object.freeze({ accountId: account.id, issued });
}

/**
 * D71 / SEC-AUTH-005 : défi pour un appareil (connexion ou renouvellement).
 * Appareil inconnu, révoqué ou compte bloqué : défi aléatoire non enregistré,
 * indiscernable d'un vrai. La base limite les défis en attente par appareil.
 */
export async function issueDeviceLoginChallenge(
  client: SqlClient,
  deviceId: string,
  purpose: DeviceChallengePurpose = 'LOGIN',
): Promise<{ readonly challengeId: string; readonly challenge: string; readonly expiresAt: string }> {
  const challenge = randomBytes(32);
  const id = uuidv7();
  const active = await client.query(
    `SELECT 1 FROM identity.device d JOIN identity.account a ON a.id = d.account_id WHERE d.id = $1 AND d.status = 'ACTIVE' AND a.status = 'ACTIVE'`,
    [deviceId],
  );
  if (active.rowCount === 0) {
    const now = Date.parse(await databaseNow(client));
    return Object.freeze({ challengeId: uuidv7(), challenge: challenge.toString('base64url'), expiresAt: new Date(now + 120_000).toISOString() });
  }
  const row = (await client.query<{ expires_at: Date }>(
    'INSERT INTO identity.device_login_challenge (id, device_id, challenge, issued_at, expires_at, purpose) VALUES ($1, $2, $3, now(), now(), $4) RETURNING expires_at',
    [id, deviceId, challenge, purpose],
  )).rows[0];
  return Object.freeze({ challengeId: id, challenge: challenge.toString('base64url'), expiresAt: (row?.expires_at ?? new Date()).toISOString() });
}

/** Octets signés par l'appareil (contrat : `ClientLoginChallenge`). */
export function challengeMessage(purpose: DeviceChallengePurpose, challengeId: string, deviceId: string, challenge: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${CHALLENGE_CONTEXT[purpose]}\u0000${challengeId}\u0000${deviceId}\u0000`, 'utf8'), challenge]);
}

type ChallengeCheck =
  | { readonly ok: true; readonly accountId: string; readonly accountActive: boolean }
  | { readonly ok: false; readonly error: BusinessError };

/**
 * Vérifie la signature d'un défi en attente de cet objet pour cet appareil,
 * PUIS le consomme (revue du 20 novembre : une signature fausse ne consomme
 * rien). Verrou sur le défi : deux vérifications simultanées ne le
 * consomment qu'une fois.
 */
async function checkDeviceChallenge(
  client: SqlClient,
  input: { readonly purpose: DeviceChallengePurpose; readonly challengeId: string; readonly deviceId: string; readonly signature: Buffer },
): Promise<ChallengeCheck> {
  const denied: ChallengeCheck = { ok: false, error: new BusinessError('IDENTITY_SESSION_INVALID', 'Authentification refusée') };
  const row = (await client.query<{ challenge: Buffer; account_id: string; public_key_pem: string; account_status: string; device_status: string }>(
    `SELECT c.challenge, d.account_id, d.public_key_pem, a.status AS account_status, d.status AS device_status
       FROM identity.device_login_challenge c
       JOIN identity.device d ON d.id = c.device_id
       JOIN identity.account a ON a.id = d.account_id
      WHERE c.id = $1 AND c.device_id = $2 AND c.purpose = $3
        AND c.consumed_at IS NULL AND c.expires_at >= clock_timestamp()
      FOR UPDATE OF c`,
    [input.challengeId, input.deviceId, input.purpose],
  )).rows[0];
  if (row === undefined || input.signature.length !== 64 || row.device_status !== 'ACTIVE') {
    return denied;
  }
  if (!verifySignature(null, challengeMessage(input.purpose, input.challengeId, input.deviceId, row.challenge), row.public_key_pem, input.signature)) {
    return denied;
  }
  await client.query('UPDATE identity.device_login_challenge SET consumed_at = clock_timestamp() WHERE id = $1', [input.challengeId]);
  return { ok: true, accountId: row.account_id, accountActive: row.account_status === 'ACTIVE' };
}

/**
 * D71 / SEC-AUTH-001, étape 1 (à VALIDER même en cas de refus) : signature du
 * défi par l'appareil, consommation, puis PIN (compteur d'essais écrit).
 * Renvoie le résultat sans lever pour un PIN faux : l'appelant valide la
 * transaction, puis refuse.
 */
export async function verifyDeviceLogin(
  client: SqlClient,
  input: { readonly challengeId: string; readonly deviceId: string; readonly signature: Buffer; readonly pin: string; readonly pinPepper: Uint8Array },
): Promise<{ readonly ok: true; readonly accountId: string } | { readonly ok: false; readonly error: BusinessError }> {
  const checked = await checkDeviceChallenge(client, { purpose: 'LOGIN', challengeId: input.challengeId, deviceId: input.deviceId, signature: input.signature });
  if (!checked.ok) return checked;
  if (!checked.accountActive) {
    return { ok: false, error: new BusinessError('IDENTITY_ACCOUNT_BLOCKED', 'Compte bloqué') };
  }
  const pin = await verifyPinFromStore(client, { accountId: checked.accountId, deviceId: input.deviceId, pin: input.pin, pepper: input.pinPepper });
  if (!pin.ok) {
    return { ok: false, error: new BusinessError(pin.code, 'PIN refusé') };
  }
  return { ok: true, accountId: checked.accountId };
}

/**
 * SEC-AUTH-005 : le renouvellement d'une session exige la signature d'un
 * défi REFRESH par l'appareil de cette session (un cookie volé seul ne suffit
 * pas). Étape à valider même en cas de refus (défi consommé).
 */
export async function verifyDeviceRefresh(
  client: SqlClient,
  input: { readonly sessionId: string; readonly challengeId: string; readonly signature: Buffer },
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: BusinessError }> {
  const session = (await client.query<{ device_id: string }>('SELECT device_id FROM identity.session WHERE id = $1 AND revoked_at IS NULL', [input.sessionId])).rows[0];
  if (session === undefined) {
    return { ok: false, error: new BusinessError('IDENTITY_SESSION_INVALID', 'Authentification refusée') };
  }
  const checked = await checkDeviceChallenge(client, { purpose: 'REFRESH', challengeId: input.challengeId, deviceId: session.device_id, signature: input.signature });
  if (!checked.ok) return checked;
  if (!checked.accountActive) {
    return { ok: false, error: new BusinessError('IDENTITY_ACCOUNT_BLOCKED', 'Compte bloqué') };
  }
  return { ok: true };
}

/**
 * Réutilisation d'un ancien jeton de rafraîchissement par l'appareil légitime
 * (signature valable) : un tiers a déjà renouvelé la session avec le jeton
 * volé. La session est révoquée. Renvoie vrai si une révocation a eu lieu.
 */
export async function revokeOnRefreshReuse(client: SqlClient, input: { readonly sessionId: string; readonly refreshTokenHash: Buffer }): Promise<boolean> {
  const revoked = await client.query(
    'UPDATE identity.session SET revoked_at = clock_timestamp() WHERE id = $1 AND revoked_at IS NULL AND refresh_token_hash <> $2',
    [input.sessionId, input.refreshTokenHash],
  );
  return revoked.rowCount === 1;
}

/** D71, étape 2 : ouvre la session (la base exige le défi consommé, migration 0066). */
export async function openDeviceSession(client: SqlClient, input: { readonly accountId: string; readonly deviceId: string }): Promise<IssuedSession> {
  const row = (await client.query<{ phone: string; phone_verified_at: Date; kyc_level: string; status: string; public_key_pem: string; fingerprint: Buffer; name: string; device_status: string; registered_at: Date }>(
    `SELECT a.phone, a.phone_verified_at, a.kyc_level, a.status, d.public_key_pem, d.fingerprint, d.name, d.status AS device_status, d.registered_at
       FROM identity.account a JOIN identity.device d ON d.account_id = a.id WHERE a.id = $1 AND d.id = $2`,
    [input.accountId, input.deviceId],
  )).rows[0];
  if (row === undefined) refused();
  const account: Account = {
    id: input.accountId, phone: row.phone, status: row.status === 'ACTIVE' ? 'ACTIVE' : 'BLOCKED', phoneVerifiedAt: row.phone_verified_at.toISOString(),
    kycLevel: row.kyc_level === 'STRONG' ? 'STRONG' : row.kyc_level === 'BASIC' ? 'BASIC' : 'NONE', blockedAt: null, blockChannel: null, blockReason: null,
  };
  const device: Device = {
    id: input.deviceId, accountId: input.accountId, publicKeyPem: row.public_key_pem, fingerprint: row.fingerprint, name: row.name,
    status: row.device_status === 'ACTIVE' ? 'ACTIVE' : 'REVOKED', registeredAt: row.registered_at.toISOString(), revokedAt: null,
  };
  const issued = createSession({ id: uuidv7(), account, device, now: await databaseNow(client) });
  await insertSession(client, issued);
  return issued;
}
