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
  normalizePhone,
  registerSignupDevice,
  type Account,
  type Device,
  type IssuedSession,
  type OtpProof,
} from './domain';
import { verifyPinFromStore } from './pin.store';

type SqlClient = Pick<PoolClient, 'query'>;

/** Rôle du message signé par l'appareil pour se connecter (D71) ; toute autre signature est refusée. */
const LOGIN_CONTEXT = 'molopay.client-login.v1';

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
  input: { readonly phone: string; readonly pepper: Uint8Array },
): Promise<{ readonly challengeId: string; readonly phone: string; readonly code: string; readonly expiresAt: string }> {
  const phone = normalizePhone(input.phone);
  const issued = issueOtp({ id: uuidv7(), phone, purpose: 'SIGNUP', binding: phone, now: await databaseNow(client), pepper: input.pepper });
  const { challenge } = issued;
  await client.query(
    `INSERT INTO identity.otp_challenge (id, phone, purpose, binding, code_hash, expires_at, attempts_remaining)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [challenge.id, challenge.phone, challenge.purpose, challenge.binding, challenge.codeHash, challenge.expiresAt, challenge.attemptsRemaining],
  );
  return Object.freeze({ challengeId: challenge.id, phone, code: issued.code, expiresAt: challenge.expiresAt });
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
  await client.query('INSERT INTO identity.account (id, phone, phone_verified_at) VALUES ($1, $2, $3)', [account.id, account.phone, account.phoneVerifiedAt]);
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
 * D71 : défi de connexion pour un appareil. Appareil inconnu, révoqué ou
 * compte bloqué : défi aléatoire non enregistré, indiscernable d'un vrai.
 */
export async function issueDeviceLoginChallenge(
  client: SqlClient,
  deviceId: string,
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
    'INSERT INTO identity.device_login_challenge (id, device_id, challenge, issued_at, expires_at) VALUES ($1, $2, $3, now(), now()) RETURNING expires_at',
    [id, deviceId, challenge],
  )).rows[0];
  return Object.freeze({ challengeId: id, challenge: challenge.toString('base64url'), expiresAt: (row?.expires_at ?? new Date()).toISOString() });
}

/** Octets signés par l'appareil pour se connecter (contrat : `ClientLoginChallenge`). */
export function loginMessage(challengeId: string, deviceId: string, challenge: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${LOGIN_CONTEXT}\u0000${challengeId}\u0000${deviceId}\u0000`, 'utf8'), challenge]);
}

/**
 * D71 / SEC-AUTH-001, étape 1 (à VALIDER même en cas de refus) : consomme le
 * défi, vérifie la signature de l'appareil, puis le PIN (compteur d'essais
 * écrit). Renvoie le résultat sans lever pour un PIN faux : l'appelant valide
 * la transaction, puis refuse.
 */
export async function verifyDeviceLogin(
  client: SqlClient,
  input: { readonly challengeId: string; readonly deviceId: string; readonly signature: Buffer; readonly pin: string; readonly pinPepper: Uint8Array },
): Promise<{ readonly ok: true; readonly accountId: string } | { readonly ok: false; readonly error: BusinessError }> {
  const row = (await client.query<{ challenge: Buffer; account_id: string; public_key_pem: string; account_status: string; device_status: string }>(
    `UPDATE identity.device_login_challenge c SET consumed_at = clock_timestamp()
       FROM identity.device d JOIN identity.account a ON a.id = d.account_id
      WHERE c.id = $1 AND c.device_id = $2 AND d.id = c.device_id
        AND c.consumed_at IS NULL AND c.expires_at >= clock_timestamp()
      RETURNING c.challenge, d.account_id, d.public_key_pem, a.status AS account_status, d.status AS device_status`,
    [input.challengeId, input.deviceId],
  )).rows[0];
  if (row === undefined || input.signature.length !== 64) {
    return { ok: false, error: new BusinessError('IDENTITY_SESSION_INVALID', 'Authentification refusée') };
  }
  const signed = verifySignature(null, loginMessage(input.challengeId, input.deviceId, row.challenge), row.public_key_pem, input.signature);
  if (!signed || row.device_status !== 'ACTIVE') {
    return { ok: false, error: new BusinessError('IDENTITY_SESSION_INVALID', 'Authentification refusée') };
  }
  if (row.account_status !== 'ACTIVE') {
    return { ok: false, error: new BusinessError('IDENTITY_ACCOUNT_BLOCKED', 'Compte bloqué') };
  }
  const pin = await verifyPinFromStore(client, { accountId: row.account_id, deviceId: input.deviceId, pin: input.pin, pepper: input.pinPepper });
  if (!pin.ok) {
    return { ok: false, error: new BusinessError(pin.code, 'PIN refusé') };
  }
  return { ok: true, accountId: row.account_id };
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
