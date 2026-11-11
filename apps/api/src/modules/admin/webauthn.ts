import { createHash, createPublicKey, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import { BusinessError } from '@achat/contracts';

/**
 * SEC-AUTH-004 / ADR-0007 (proposé) : vérification serveur de WebAuthn
 * niveau 2 pour le personnel interne. Pures fonctions, sans état : le défi,
 * la clé enregistrée et le compteur sont fournis et conservés par l'appelant.
 * Toute anomalie donne le même code (aucun oracle pour un attaquant).
 */
export type RelyingParty = { readonly rpId: string; readonly origins: ReadonlySet<string> };
export type WebAuthnAlgorithm = 'ES256' | 'EdDSA';

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;
const MIN_CHALLENGE_BYTES = 16;
const AUTH_DATA_MIN = 37;
const CREDENTIAL_ID_MAX = 1023;

function refuse(): never {
  throw new BusinessError('STAFF_AUTH_INVALID', 'Authentification refusée');
}

function sha256(data: Buffer | string): Buffer {
  return createHash('sha256').update(data).digest();
}

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** clientDataJSON : type attendu, défi exact, origine en liste blanche, pas d'appel inter-origines. */
function checkClientData(raw: Buffer, type: 'webauthn.create' | 'webauthn.get', challenge: Buffer, rp: RelyingParty): void {
  if (challenge.length < MIN_CHALLENGE_BYTES) {
    refuse();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    refuse();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    refuse();
  }
  const data = parsed as Record<string, unknown>;
  if (data['type'] !== type || typeof data['challenge'] !== 'string' || typeof data['origin'] !== 'string') {
    refuse();
  }
  if (data['crossOrigin'] === true || !rp.origins.has(data['origin'])) {
    refuse();
  }
  if (!sameBytes(Buffer.from(data['challenge'], 'base64url'), challenge)) {
    refuse();
  }
}

/** Données d'authentificateur : RP ID, présence et vérification de l'utilisateur ; renvoie drapeaux et compteur. */
function checkAuthenticatorData(raw: Buffer, rp: RelyingParty): { readonly flags: number; readonly signCount: number } {
  if (raw.length < AUTH_DATA_MIN || !sameBytes(raw.subarray(0, 32), sha256(rp.rpId))) {
    refuse();
  }
  const flags = raw.readUInt8(32);
  if ((flags & FLAG_UP) === 0 || (flags & FLAG_UV) === 0) {
    refuse();
  }
  return { flags, signCount: raw.readUInt32BE(33) };
}

function publicKeyOf(spki: Buffer): { readonly key: KeyObject; readonly algorithm: WebAuthnAlgorithm } {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  } catch {
    refuse();
  }
  if (key.asymmetricKeyType === 'ed25519') {
    return { key, algorithm: 'EdDSA' };
  }
  if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') {
    return { key, algorithm: 'ES256' };
  }
  refuse();
}

/** Inscription : réponse `webauthn.create`, identifiant de clé présent dans les données attestées. */
export function verifyRegistration(input: {
  readonly rp: RelyingParty;
  readonly expectedChallenge: Buffer;
  readonly clientDataJSON: Buffer;
  readonly authenticatorData: Buffer;
  readonly credentialId: Buffer;
  readonly publicKeySpki: Buffer;
}): { readonly credentialId: Buffer; readonly publicKeySpki: Buffer; readonly algorithm: WebAuthnAlgorithm; readonly signCount: number } {
  checkClientData(input.clientDataJSON, 'webauthn.create', input.expectedChallenge, input.rp);
  const { flags, signCount } = checkAuthenticatorData(input.authenticatorData, input.rp);
  if ((flags & FLAG_AT) === 0 || input.authenticatorData.length < AUTH_DATA_MIN + 18) {
    refuse();
  }
  const length = input.authenticatorData.readUInt16BE(AUTH_DATA_MIN + 16);
  const start = AUTH_DATA_MIN + 18;
  if (length < 16 || length > CREDENTIAL_ID_MAX || input.authenticatorData.length < start + length) {
    refuse();
  }
  if (!sameBytes(input.authenticatorData.subarray(start, start + length), input.credentialId)) {
    refuse();
  }
  const { algorithm } = publicKeyOf(input.publicKeySpki);
  return Object.freeze({ credentialId: input.credentialId, publicKeySpki: input.publicKeySpki, algorithm, signCount });
}

/**
 * Assertion `webauthn.get` : signature sur authData ‖ SHA-256(clientDataJSON)
 * par la clé enregistrée ; compteur strictement croissant si l'un des deux
 * compteurs est non nul (détection de clone).
 */
export function verifyAssertion(input: {
  readonly rp: RelyingParty;
  readonly expectedChallenge: Buffer;
  readonly credential: { readonly publicKeySpki: Buffer; readonly signCount: number };
  readonly clientDataJSON: Buffer;
  readonly authenticatorData: Buffer;
  readonly signature: Buffer;
}): { readonly signCount: number } {
  checkClientData(input.clientDataJSON, 'webauthn.get', input.expectedChallenge, input.rp);
  const { signCount } = checkAuthenticatorData(input.authenticatorData, input.rp);
  const { key, algorithm } = publicKeyOf(input.credential.publicKeySpki);
  const signed = Buffer.concat([input.authenticatorData, sha256(input.clientDataJSON)]);
  let valid: boolean;
  try {
    valid = verify(algorithm === 'ES256' ? 'sha256' : null, signed, key, input.signature);
  } catch {
    valid = false;
  }
  if (!valid) {
    refuse();
  }
  if ((signCount !== 0 || input.credential.signCount !== 0) && signCount <= input.credential.signCount) {
    refuse();
  }
  return Object.freeze({ signCount });
}
