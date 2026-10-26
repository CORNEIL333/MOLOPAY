import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  randomInt,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';
import { hash as argon2Hash, parseOptions, verify as argon2Verify } from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';
import { canonicalize, type JsonValue } from '@achat/chain';
import { BusinessError, type ErrorCode } from '@achat/contracts';
import { MAX_AMOUNT, parseXaf } from '@achat/money';
import type { AuditEventDraft } from '../audit/domain';

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC_MS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const SIX_DIGITS_PATTERN = /^[0-9]{6}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

const OTP_DEFAULT_TTL_MS = 5 * 60_000;
const OTP_MAX_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_PROOF_MAX_AGE_MS = 10 * 60_000;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_BASE_MS = 5 * 60_000;
const PIN_LOCKOUT_MAX_MS = 24 * 60 * 60_000;
const PIN_MIN_MEMORY_KIB = 19_456;
const PIN_MIN_TIME_COST = 2;
const PEPPER_MIN_BYTES = 32;
const PEPPER_MAX_BYTES = 64;
const ACCESS_TOKEN_MAX_TTL_MS = 15 * 60_000;
const REFRESH_TOKEN_DEFAULT_TTL_MS = 30 * 24 * 60 * 60_000;
const REFRESH_TOKEN_MAX_TTL_MS = 90 * 24 * 60 * 60_000;
const TRANSACTION_MAX_AGE_MS = 5 * 60_000;
const TRANSACTION_MAX_TTL_MS = 15 * 60_000;
const RECOVERY_SECURITY_DELAY_MS = 24 * 60 * 60_000;
const MAX_REASON_LENGTH = 500;
// Le journal est chaîné et durable : un motif ne doit jamais y recopier un
// numéro de téléphone ni un code à six chiffres.
const SENSITIVE_REASON_PATTERNS: readonly RegExp[] = [
  /\+[1-9][0-9]{7,14}/u,
  /[0-9]{6,}/u,
];

function fail(code: ErrorCode, message: string): never {
  throw new BusinessError(code, message);
}

function isIsoUtcMs(value: string): boolean {
  return (
    ISO_UTC_MS_PATTERN.test(value) &&
    !Number.isNaN(new Date(value).getTime()) &&
    new Date(value).toISOString() === value
  );
}

function assertIsoUtcMs(value: string, field: string): void {
  if (!isIsoUtcMs(value)) {
    fail(
      'IDENTITY_INVALID_REQUEST',
      `${field} doit être ISO 8601 UTC avec millisecondes`,
    );
  }
}

function assertUuidV7(value: string, field: string): void {
  if (typeof value !== 'string' || !UUID_V7_PATTERN.test(value)) {
    fail('IDENTITY_INVALID_REQUEST', `${field} doit être un UUID v7 minuscule`);
  }
}

function assertLabel(
  value: string,
  field: string,
  maxLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maxLength ||
    /\p{Cc}/u.test(value)
  ) {
    fail(
      'IDENTITY_INVALID_REQUEST',
      `${field} doit être non vide, sans caractère de contrôle, au plus ${maxLength.toString()} caractères`,
    );
  }
  return value.trim();
}

function assertReason(value: string, field: string): string {
  return assertLabel(value, field, MAX_REASON_LENGTH);
}

function assertAuditReason(value: string): string {
  const reason = assertReason(value, 'Motif d’audit');
  if (SENSITIVE_REASON_PATTERNS.some((pattern) => pattern.test(reason))) {
    fail(
      'IDENTITY_INVALID_REQUEST',
      'Le motif d’audit ne doit contenir ni numéro ni code secret',
    );
  }
  return reason;
}

function assertPepper(pepper: Uint8Array): void {
  if (
    pepper.length < PEPPER_MIN_BYTES ||
    pepper.length > PEPPER_MAX_BYTES
  ) {
    fail(
      'IDENTITY_INVALID_REQUEST',
      `Le poivre doit faire entre ${PEPPER_MIN_BYTES.toString()} et ${PEPPER_MAX_BYTES.toString()} octets`,
    );
  }
}

export function normalizePhone(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 32) {
    fail('IDENTITY_INVALID_PHONE', 'Numéro de téléphone invalide');
  }
  const compact = raw.trim().replaceAll(/[\s().-]/gu, '');
  let candidate = compact;
  if (candidate.startsWith('00')) {
    candidate = `+${candidate.slice(2)}`;
  } else if (/^237[0-9]{9}$/u.test(candidate)) {
    candidate = `+${candidate}`;
  }
  if (!E164_PATTERN.test(candidate)) {
    fail(
      'IDENTITY_INVALID_PHONE',
      'Le numéro doit être au format E.164 (par exemple +237612345678)',
    );
  }
  return candidate;
}

export const OTP_PURPOSES = ['SIGNUP', 'NEW_DEVICE', 'RECOVERY'] as const;

export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export type OtpChallenge = {
  readonly id: string;
  readonly phone: string;
  readonly purpose: OtpPurpose;
  readonly binding: string;
  readonly codeHash: Buffer;
  readonly expiresAt: string;
  readonly attemptsRemaining: number;
  readonly consumedAt: string | null;
};

export type OtpProof = {
  readonly challengeId: string;
  readonly phone: string;
  readonly purpose: OtpPurpose;
  readonly binding: string;
  readonly verifiedAt: string;
  // MAC poivré : une preuve forgée à la main ne peut pas ouvrir un compte.
  readonly mac: Buffer;
};

export type OtpIssue = {
  readonly challenge: OtpChallenge;
  readonly code: string;
};

export type OtpVerification =
  | {
      readonly ok: true;
      readonly challenge: OtpChallenge;
      readonly proof: OtpProof;
    }
  | {
      readonly ok: false;
      readonly challenge: OtpChallenge;
      readonly code: ErrorCode;
      readonly message: string;
    };

function otpDigest(
  pepper: Uint8Array,
  challengeId: string,
  purpose: OtpPurpose,
  binding: string,
  code: string,
): Buffer {
  return createHmac('sha256', pepper)
    .update(
      `${challengeId}\u0000${purpose}\u0000${binding}\u0000${code}`,
      'utf8',
    )
    .digest();
}

function otpProofMac(
  pepper: Uint8Array,
  proof: Omit<OtpProof, 'mac'>,
): Buffer {
  return createHmac('sha256', pepper)
    .update(
      `identity.otp-proof.v1\u0000${proof.challengeId}\u0000${proof.phone}\u0000${proof.purpose}\u0000${proof.binding}\u0000${proof.verifiedAt}`,
      'utf8',
    )
    .digest();
}

export function issueOtp(input: {
  readonly id: string;
  readonly phone: string;
  readonly purpose: OtpPurpose;
  readonly binding: string;
  readonly now: string;
  readonly pepper: Uint8Array;
  readonly ttlMs?: number;
}): OtpIssue {
  assertUuidV7(input.id, 'id');
  assertIsoUtcMs(input.now, 'now');
  assertPepper(input.pepper);
  if (!(OTP_PURPOSES as readonly string[]).includes(input.purpose)) {
    fail('IDENTITY_INVALID_REQUEST', `Objet OTP inconnu: ${input.purpose}`);
  }
  const phone = normalizePhone(input.phone);
  const binding = assertLabel(input.binding, 'binding', 200);
  const ttl = input.ttlMs ?? OTP_DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > OTP_MAX_TTL_MS) {
    fail('IDENTITY_INVALID_REQUEST', 'Durée de validité OTP hors bornes');
  }
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  return {
    challenge: {
      id: input.id,
      phone,
      purpose: input.purpose,
      binding,
      codeHash: otpDigest(
        input.pepper,
        input.id,
        input.purpose,
        binding,
        code,
      ),
      expiresAt: new Date(new Date(input.now).getTime() + ttl).toISOString(),
      attemptsRemaining: OTP_MAX_ATTEMPTS,
      consumedAt: null,
    },
    code,
  };
}

export function verifyOtp(
  challenge: OtpChallenge,
  submitted: string,
  now: string,
  pepper: Uint8Array,
): OtpVerification {
  assertIsoUtcMs(now, 'now');
  assertPepper(pepper);
  assertUuidV7(challenge.id, 'challenge.id');
  if (!(OTP_PURPOSES as readonly string[]).includes(challenge.purpose)) {
    fail('IDENTITY_INVALID_REQUEST', 'Objet OTP inconnu');
  }
  assertIsoUtcMs(challenge.expiresAt, 'challenge.expiresAt');
  if (
    !Number.isInteger(challenge.attemptsRemaining) ||
    challenge.attemptsRemaining < 0 ||
    challenge.attemptsRemaining > OTP_MAX_ATTEMPTS
  ) {
    fail('IDENTITY_INVALID_REQUEST', 'Compteur d’essais OTP invalide');
  }
  if (challenge.consumedAt !== null) {
    assertIsoUtcMs(challenge.consumedAt, 'challenge.consumedAt');
    return {
      ok: false,
      challenge,
      code: 'IDENTITY_OTP_REPLAYED',
      message: 'OTP déjà consommé',
    };
  }
  if (new Date(now).getTime() >= new Date(challenge.expiresAt).getTime()) {
    return {
      ok: false,
      challenge,
      code: 'IDENTITY_OTP_EXPIRED',
      message: 'OTP expiré',
    };
  }
  if (challenge.attemptsRemaining <= 0) {
    return {
      ok: false,
      challenge,
      code: 'IDENTITY_OTP_LOCKED',
      message: 'OTP verrouillé après trop d’essais',
    };
  }
  const candidate =
    typeof submitted === 'string' && submitted.length <= 64
      ? submitted
      : '\u0000invalid';
  const expected = otpDigest(
    pepper,
    challenge.id,
    challenge.purpose,
    challenge.binding,
    candidate,
  );
  if (
    expected.length !== challenge.codeHash.length ||
    !timingSafeEqual(expected, challenge.codeHash)
  ) {
    const attemptsRemaining = challenge.attemptsRemaining - 1;
    return {
      ok: false,
      challenge: { ...challenge, attemptsRemaining },
      code:
        attemptsRemaining === 0
          ? 'IDENTITY_OTP_LOCKED'
          : 'IDENTITY_OTP_INVALID',
      message:
        attemptsRemaining === 0
          ? 'OTP verrouillé après trop d’essais'
          : 'Code OTP invalide',
    };
  }
  const consumed = { ...challenge, consumedAt: now };
  const proof: Omit<OtpProof, 'mac'> = {
    challengeId: challenge.id,
    phone: challenge.phone,
    purpose: challenge.purpose,
    binding: challenge.binding,
    verifiedAt: now,
  };
  return {
    ok: true,
    challenge: consumed,
    proof: { ...proof, mac: otpProofMac(pepper, proof) },
  };
}

export function assertOtpProof(
  proof: OtpProof,
  expected: {
    readonly purpose: OtpPurpose;
    readonly binding: string;
    readonly phone?: string;
  },
  now: string,
  pepper: Uint8Array,
): void {
  assertIsoUtcMs(now, 'now');
  assertIsoUtcMs(proof.verifiedAt, 'verifiedAt');
  assertPepper(pepper);
  if (
    !UUID_V7_PATTERN.test(proof.challengeId) ||
    proof.purpose !== expected.purpose ||
    proof.binding !== expected.binding ||
    (expected.phone !== undefined && proof.phone !== expected.phone)
  ) {
    fail('IDENTITY_OTP_INVALID', 'Preuve OTP incompatible avec l’opération');
  }
  const expectedMac = otpProofMac(pepper, {
    challengeId: proof.challengeId,
    phone: proof.phone,
    purpose: proof.purpose,
    binding: proof.binding,
    verifiedAt: proof.verifiedAt,
  });
  if (
    !Buffer.isBuffer(proof.mac) ||
    proof.mac.length !== expectedMac.length ||
    !timingSafeEqual(proof.mac, expectedMac)
  ) {
    fail('IDENTITY_OTP_INVALID', 'Preuve OTP non authentifiée');
  }
  const age = new Date(now).getTime() - new Date(proof.verifiedAt).getTime();
  if (age < 0 || age > OTP_PROOF_MAX_AGE_MS) {
    fail('IDENTITY_OTP_INVALID', 'Preuve OTP expirée');
  }
}

export type BlockChannel = 'USSD' | 'SUPPORT' | 'TRUSTED_DEVICE' | 'APP';

export type AccountStatus = 'ACTIVE' | 'BLOCKED';

export type KycLevel = 'NONE' | 'BASIC' | 'STRONG';

export type Account = {
  readonly id: string;
  readonly phone: string;
  readonly status: AccountStatus;
  readonly phoneVerifiedAt: string;
  readonly kycLevel: KycLevel;
  readonly blockedAt: string | null;
  readonly blockChannel: BlockChannel | null;
  readonly blockReason: string | null;
};

export function createAccount(input: {
  readonly id: string;
  readonly phone: string;
  readonly now: string;
  readonly otpProof: OtpProof;
  readonly pepper: Uint8Array;
}): Account {
  assertUuidV7(input.id, 'id');
  assertIsoUtcMs(input.now, 'now');
  const phone = normalizePhone(input.phone);
  assertOtpProof(
    input.otpProof,
    { purpose: 'SIGNUP', binding: phone, phone },
    input.now,
    input.pepper,
  );
  return {
    id: input.id,
    phone,
    status: 'ACTIVE',
    phoneVerifiedAt: input.otpProof.verifiedAt,
    kycLevel: 'NONE',
    blockedAt: null,
    blockChannel: null,
    blockReason: null,
  };
}

export function assertAccountActive(account: Account): void {
  if (account.status === 'BLOCKED') {
    fail('IDENTITY_ACCOUNT_BLOCKED', 'Compte bloqué');
  }
  if (!isIsoUtcMs(account.phoneVerifiedAt)) {
    fail('IDENTITY_ACCOUNT_NOT_VERIFIED', 'Numéro non vérifié');
  }
}

export function blockAccount(
  account: Account,
  input: {
    readonly now: string;
    readonly channel: BlockChannel;
    readonly reason: string;
  },
): Account {
  assertIsoUtcMs(input.now, 'now');
  const channels: readonly string[] = [
    'USSD',
    'SUPPORT',
    'TRUSTED_DEVICE',
    'APP',
  ];
  if (!channels.includes(input.channel)) {
    fail('IDENTITY_INVALID_REQUEST', 'Canal de blocage inconnu');
  }
  const reason = assertReason(input.reason, 'Motif de blocage');
  if (account.status === 'BLOCKED') {
    return account;
  }
  return {
    ...account,
    status: 'BLOCKED',
    blockedAt: input.now,
    blockChannel: input.channel,
    blockReason: reason,
  };
}

export type DeviceStatus = 'ACTIVE' | 'REVOKED';

export type Device = {
  readonly id: string;
  readonly accountId: string;
  readonly publicKeyPem: string;
  readonly fingerprint: Buffer;
  readonly name: string;
  readonly status: DeviceStatus;
  readonly registeredAt: string;
  readonly revokedAt: string | null;
};

function buildPublicKey(publicKeyPem: string): {
  readonly fingerprint: Buffer;
  readonly key: ReturnType<typeof createPublicKey>;
} {
  if (
    typeof publicKeyPem !== 'string' ||
    publicKeyPem.length > 2_000 ||
    publicKeyPem.includes('PRIVATE KEY')
  ) {
    fail('IDENTITY_INVALID_REQUEST', 'Clé publique invalide');
  }
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey({ key: publicKeyPem, format: 'pem' });
  } catch {
    fail('IDENTITY_INVALID_REQUEST', 'Clé publique illisible');
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    fail('IDENTITY_INVALID_REQUEST', 'Une clé publique Ed25519 est exigée');
  }
  const der = key.export({ type: 'spki', format: 'der' });
  return {
    fingerprint: createHash('sha256').update(der).digest(),
    key,
  };
}

export function registerDevice(input: {
  readonly id: string;
  readonly account: Account;
  readonly publicKeyPem: string;
  readonly name: string;
  readonly now: string;
  readonly otpProof: OtpProof;
  readonly pepper: Uint8Array;
}): Device {
  assertUuidV7(input.id, 'id');
  assertIsoUtcMs(input.now, 'now');
  assertAccountActive(input.account);
  const name = assertLabel(input.name, 'Nom d’appareil', 100);
  assertOtpProof(
    input.otpProof,
    { purpose: 'NEW_DEVICE', binding: input.id, phone: input.account.phone },
    input.now,
    input.pepper,
  );
  const { fingerprint } = buildPublicKey(input.publicKeyPem);
  return {
    id: input.id,
    accountId: input.account.id,
    publicKeyPem: input.publicKeyPem,
    fingerprint,
    name,
    status: 'ACTIVE',
    registeredAt: input.now,
    revokedAt: null,
  };
}

export function revokeDevice(
  device: Device,
  input: { readonly now: string; readonly reason: string },
): Device {
  assertIsoUtcMs(input.now, 'now');
  assertReason(input.reason, 'Motif de révocation');
  if (device.status === 'REVOKED') {
    return device;
  }
  return { ...device, status: 'REVOKED', revokedAt: input.now };
}

export function assertDeviceActive(device: Device, account: Account): void {
  if (device.accountId !== account.id) {
    fail('IDENTITY_DEVICE_UNKNOWN', 'Appareil inconnu pour ce compte');
  }
  if (device.status !== 'ACTIVE') {
    fail('IDENTITY_DEVICE_REVOKED', 'Appareil révoqué');
  }
}

export function assertStrongPin(pin: string): void {
  if (typeof pin !== 'string' || !SIX_DIGITS_PATTERN.test(pin)) {
    fail('IDENTITY_PIN_WEAK', 'Le PIN doit comporter exactement six chiffres');
  }
  if (/^([0-9])\1{5}$/u.test(pin)) {
    fail('IDENTITY_PIN_WEAK', 'PIN composé d’un seul chiffre répété');
  }
  const digits = [...pin].map((digit) => Number(digit));
  const ascending = digits.every(
    (digit, index) =>
      index === 0 || digit === ((digits[index - 1] ?? 0) + 1) % 10,
  );
  const descending = digits.every(
    (digit, index) =>
      index === 0 || digit === ((digits[index - 1] ?? 0) + 9) % 10,
  );
  if (ascending || descending) {
    fail('IDENTITY_PIN_WEAK', 'PIN formant une suite triviale');
  }
  const pair = pin.slice(0, 2);
  const triple = pin.slice(0, 3);
  if (pin === pair.repeat(3) || pin === triple.repeat(2)) {
    fail('IDENTITY_PIN_WEAK', 'PIN formant une répétition triviale');
  }
}

export type PinState = {
  readonly accountId: string;
  readonly deviceId: string;
  readonly hash: string;
  readonly failedAttempts: number;
  readonly lockouts: number;
  readonly lockedUntil: string | null;
};

export type PinAttempt =
  | { readonly ok: true; readonly state: PinState }
  | {
      readonly ok: false;
      readonly state: PinState;
      readonly code: ErrorCode;
      readonly message: string;
    };

function argon2Options(pepper: Uint8Array): {
  readonly algorithm: Algorithm;
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
  readonly outputLen: number;
  readonly secret: Uint8Array;
} {
  return {
    // Argon2id = 2 ; le const enum du paquet n'existe pas à l'exécution.
    algorithm: 2,
    memoryCost: PIN_MIN_MEMORY_KIB,
    timeCost: PIN_MIN_TIME_COST,
    parallelism: 1,
    outputLen: 32,
    secret: pepper,
  };
}

export async function hashPin(
  pin: string,
  pepper: Uint8Array,
): Promise<string> {
  assertStrongPin(pin);
  assertPepper(pepper);
  const hash = await argon2Hash(pin, argon2Options(pepper));
  if (!hash.startsWith('$argon2id$')) {
    fail('IDENTITY_INVALID_REQUEST', 'Dérivation PIN non Argon2id');
  }
  return hash;
}

export async function verifyPinHash(
  hash: string,
  pin: string,
  pepper: Uint8Array,
): Promise<boolean> {
  if (typeof hash !== 'string' || hash.length > 1_000) {
    return false;
  }
  assertPepper(pepper);
  try {
    const parsed = parseOptions(hash);
    if (
      Number(parsed.algorithm) !== 2 ||
      // Version.V0x13 (Argon2 v19) vaut 1 dans l'énumération du paquet.
      Number(parsed.version) !== 1 ||
      parsed.outputLen !== 32 ||
      parsed.parallelism !== 1 ||
      parsed.memoryCost < PIN_MIN_MEMORY_KIB ||
      parsed.timeCost < PIN_MIN_TIME_COST
    ) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    return await argon2Verify(hash, pin, { secret: pepper });
  } catch {
    return false;
  }
}

export async function createPinState(input: {
  readonly account: Account;
  readonly device: Device;
  readonly pin: string;
  readonly pepper: Uint8Array;
  readonly now: string;
}): Promise<PinState> {
  assertIsoUtcMs(input.now, 'now');
  assertAccountActive(input.account);
  assertDeviceActive(input.device, input.account);
  return {
    accountId: input.account.id,
    deviceId: input.device.id,
    hash: await hashPin(input.pin, input.pepper),
    failedAttempts: 0,
    lockouts: 0,
    lockedUntil: null,
  };
}

function lockoutDelayMs(lockouts: number): number {
  const exponent = Math.min(Math.max(lockouts - 1, 0), 10);
  return Math.min(PIN_LOCKOUT_BASE_MS * 3 ** exponent, PIN_LOCKOUT_MAX_MS);
}

export async function verifyPinAttempt(
  state: PinState,
  pin: string,
  pepper: Uint8Array,
  now: string,
): Promise<PinAttempt> {
  assertIsoUtcMs(now, 'now');
  if (
    !Number.isInteger(state.failedAttempts) ||
    state.failedAttempts < 0 ||
    state.failedAttempts >= PIN_MAX_ATTEMPTS ||
    !Number.isInteger(state.lockouts) ||
    state.lockouts < 0
  ) {
    fail('IDENTITY_INVALID_REQUEST', 'État de verrouillage PIN invalide');
  }
  const nowMs = new Date(now).getTime();
  if (state.lockedUntil !== null) {
    assertIsoUtcMs(state.lockedUntil, 'lockedUntil');
    if (nowMs < new Date(state.lockedUntil).getTime()) {
      return {
        ok: false,
        state,
        code: 'IDENTITY_PIN_LOCKED',
        message: 'PIN temporairement verrouillé',
      };
    }
  }
  // Le verrou expiré est purgé avant tout nouvel échec : la base exige
  // locked_until NULL dès qu'un échec est enregistré.
  const base: PinState =
    state.lockedUntil === null ? state : { ...state, lockedUntil: null };
  const valid =
    typeof pin === 'string' &&
    pin.length <= 64 &&
    (await verifyPinHash(base.hash, pin, pepper));
  if (valid) {
    return {
      ok: true,
      state: {
        ...base,
        failedAttempts: 0,
        lockedUntil: null,
      },
    };
  }
  const failedAttempts = base.failedAttempts + 1;
  if (failedAttempts < PIN_MAX_ATTEMPTS) {
    return {
      ok: false,
      state: { ...base, failedAttempts },
      code: 'IDENTITY_PIN_INVALID',
      message: 'PIN invalide',
    };
  }
  const lockouts = base.lockouts + 1;
  return {
    ok: false,
    state: {
      ...base,
      failedAttempts: 0,
      lockouts,
      lockedUntil: new Date(
        nowMs + lockoutDelayMs(lockouts),
      ).toISOString(),
    },
    code: 'IDENTITY_PIN_LOCKED',
    message: 'PIN temporairement verrouillé après cinq essais',
  };
}

export const TRANSACTION_ACTIONS = [
  'WITHDRAWAL',
  'SETTLEMENT',
  'REFUND',
  'TRANSFER',
] as const;

export type TransactionAction = (typeof TRANSACTION_ACTIONS)[number];

export type TransactionRequest = {
  readonly operationId: string;
  readonly accountId: string;
  readonly deviceId: string;
  readonly action: TransactionAction;
  readonly amountXaf: string;
  readonly cityId: string | null;
  readonly partnerId: string | null;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
};

export type AuthorizedTransaction = TransactionRequest & {
  readonly payloadHash: Buffer;
  readonly signature: Buffer;
  readonly authorizedAt: string;
};

function parseAmountXaf(value: string): bigint {
  try {
    return parseXaf(value).amount;
  } catch {
    return fail(
      'IDENTITY_INVALID_REQUEST',
      'amountXaf doit être un entier XAF dans la plage BIGINT',
    );
  }
}

function optionalLabel(value: string | null, field: string): string | null {
  if (value === null) {
    return null;
  }
  return assertLabel(value, field, 100);
}

export function canonicalTransaction(
  transaction: TransactionRequest,
): string {
  assertUuidV7(transaction.operationId, 'operationId');
  assertUuidV7(transaction.accountId, 'accountId');
  assertUuidV7(transaction.deviceId, 'deviceId');
  assertUuidV7(transaction.nonce, 'nonce');
  if (!(TRANSACTION_ACTIONS as readonly string[]).includes(transaction.action)) {
    fail(
      'IDENTITY_INVALID_REQUEST',
      `Action de transaction inconnue: ${transaction.action}`,
    );
  }
  if (
    typeof transaction.amountXaf !== 'string' ||
    !POSITIVE_INTEGER_PATTERN.test(transaction.amountXaf)
  ) {
    fail(
      'IDENTITY_INVALID_REQUEST',
      'amountXaf doit être un entier XAF positif sous forme de chaîne',
    );
  }
  const amount = parseAmountXaf(transaction.amountXaf);
  if (amount <= 0n) {
    fail('IDENTITY_INVALID_REQUEST', 'amountXaf doit être strictement positif');
  }
  assertIsoUtcMs(transaction.issuedAt, 'issuedAt');
  assertIsoUtcMs(transaction.expiresAt, 'expiresAt');
  const issuedMs = new Date(transaction.issuedAt).getTime();
  const expiresMs = new Date(transaction.expiresAt).getTime();
  if (
    expiresMs <= issuedMs ||
    expiresMs - issuedMs > TRANSACTION_MAX_TTL_MS
  ) {
    fail(
      'IDENTITY_INVALID_REQUEST',
      'La signature de transaction doit expirer dans les quinze minutes',
    );
  }
  const content: Record<string, JsonValue> = {
    version: 'v1',
    operation_id: transaction.operationId,
    account_id: transaction.accountId,
    device_id: transaction.deviceId,
    action: transaction.action,
    amount_xaf: transaction.amountXaf,
    city_id: optionalLabel(transaction.cityId, 'cityId'),
    partner_id: optionalLabel(transaction.partnerId, 'partnerId'),
    nonce: transaction.nonce,
    issued_at: transaction.issuedAt,
    expires_at: transaction.expiresAt,
  };
  try {
    return canonicalize(content);
  } catch (error: unknown) {
    fail(
      'IDENTITY_INVALID_REQUEST',
      `Transaction non canonisable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export type TransactionAuthorization =
  | {
      readonly authorized: true;
      readonly transaction: AuthorizedTransaction;
      readonly pinState: PinState;
    }
  | {
      readonly authorized: false;
      readonly code: ErrorCode;
      readonly message: string;
      readonly pinState: PinState;
    };

export async function authorizeTransaction(input: {
  readonly account: Account;
  readonly device: Device;
  readonly pinState: PinState;
  readonly pin: string;
  readonly pepper: Uint8Array;
  readonly transaction: TransactionRequest;
  readonly signature: Uint8Array;
  readonly now: string;
  readonly seenNonces?: readonly string[];
  readonly seenOperationIds?: readonly string[];
}): Promise<TransactionAuthorization> {
  assertIsoUtcMs(input.now, 'now');
  const canonical = canonicalTransaction(input.transaction);
  if (
    input.transaction.accountId !== input.account.id ||
    input.transaction.deviceId !== input.device.id ||
    input.pinState.accountId !== input.account.id ||
    input.pinState.deviceId !== input.device.id
  ) {
    fail('IDENTITY_DEVICE_UNKNOWN', 'Transaction liée à un autre compte ou appareil');
  }
  assertAccountActive(input.account);
  assertDeviceActive(input.device, input.account);
  if (input.seenNonces?.includes(input.transaction.nonce) === true) {
    fail('IDENTITY_NONCE_REUSED', 'Nonce de transaction déjà utilisé');
  }
  if (
    input.seenOperationIds?.includes(input.transaction.operationId) === true
  ) {
    fail('IDENTITY_NONCE_REUSED', 'Opération déjà autorisée');
  }
  const nowMs = new Date(input.now).getTime();
  const issuedMs = new Date(input.transaction.issuedAt).getTime();
  const expiresMs = new Date(input.transaction.expiresAt).getTime();
  // La base exige authorized_at >= issued_at et authorized_at = now() :
  // toute tolérance sur une date future ferait échouer l'insertion.
  if (issuedMs > nowMs) {
    fail('IDENTITY_INVALID_REQUEST', 'Transaction datée dans le futur');
  }
  if (nowMs - issuedMs > TRANSACTION_MAX_AGE_MS) {
    fail('IDENTITY_TRANSACTION_EXPIRED', 'Transaction trop ancienne');
  }
  if (nowMs >= expiresMs) {
    fail('IDENTITY_TRANSACTION_EXPIRED', 'Transaction expirée');
  }
  if (
    !(input.signature instanceof Uint8Array) ||
    input.signature.length !== 64
  ) {
    fail('IDENTITY_SIGNATURE_INVALID', 'Signature Ed25519 invalide');
  }
  const { key, fingerprint } = buildPublicKey(input.device.publicKeyPem);
  if (
    !Buffer.isBuffer(input.device.fingerprint) ||
    fingerprint.length !== input.device.fingerprint.length ||
    !timingSafeEqual(fingerprint, input.device.fingerprint)
  ) {
    fail(
      'IDENTITY_DEVICE_UNKNOWN',
      'Empreinte d’appareil incohérente avec sa clé publique',
    );
  }
  if (
    !verifySignature(
      null,
      Buffer.from(canonical, 'utf8'),
      key,
      input.signature,
    )
  ) {
    fail('IDENTITY_SIGNATURE_INVALID', 'Signature de transaction invalide');
  }
  const attempt = await verifyPinAttempt(
    input.pinState,
    input.pin,
    input.pepper,
    input.now,
  );
  if (!attempt.ok) {
    return {
      authorized: false,
      code: attempt.code,
      message: attempt.message,
      pinState: attempt.state,
    };
  }
  return {
    authorized: true,
    pinState: attempt.state,
    transaction: {
      ...input.transaction,
      payloadHash: createHash('sha256')
        .update(canonical, 'utf8')
        .digest(),
      signature: Buffer.from(input.signature),
      authorizedAt: input.now,
    },
  };
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export type Session = {
  readonly id: string;
  readonly accountId: string;
  readonly deviceId: string;
  readonly accessTokenHash: Buffer;
  readonly refreshTokenHash: Buffer;
  readonly accessIssuedAt: string;
  readonly accessExpiresAt: string;
  readonly refreshExpiresAt: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
};

export type IssuedSession = {
  readonly session: Session;
  readonly accessToken: string;
  readonly refreshToken: string;
};

export function createSession(input: {
  readonly id: string;
  readonly account: Account;
  readonly device: Device;
  readonly now: string;
  readonly accessTtlMs?: number;
  readonly refreshTtlMs?: number;
}): IssuedSession {
  assertUuidV7(input.id, 'id');
  assertIsoUtcMs(input.now, 'now');
  assertAccountActive(input.account);
  assertDeviceActive(input.device, input.account);
  const accessTtl = input.accessTtlMs ?? ACCESS_TOKEN_MAX_TTL_MS;
  if (
    !Number.isSafeInteger(accessTtl) ||
    accessTtl <= 0 ||
    accessTtl > ACCESS_TOKEN_MAX_TTL_MS
  ) {
    fail(
      'IDENTITY_INVALID_REQUEST',
      'Le jeton d’accès doit expirer en quinze minutes au plus',
    );
  }
  const refreshTtl = input.refreshTtlMs ?? REFRESH_TOKEN_DEFAULT_TTL_MS;
  if (
    !Number.isSafeInteger(refreshTtl) ||
    refreshTtl <= accessTtl ||
    refreshTtl > REFRESH_TOKEN_MAX_TTL_MS
  ) {
    fail('IDENTITY_INVALID_REQUEST', 'Durée de rafraîchissement hors bornes');
  }
  const accessToken = randomBytes(32).toString('base64url');
  const refreshToken = randomBytes(32).toString('base64url');
  const nowMs = new Date(input.now).getTime();
  return {
    session: {
      id: input.id,
      accountId: input.account.id,
      deviceId: input.device.id,
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      accessIssuedAt: input.now,
      accessExpiresAt: new Date(nowMs + accessTtl).toISOString(),
      refreshExpiresAt: new Date(nowMs + refreshTtl).toISOString(),
      createdAt: input.now,
      revokedAt: null,
    },
    accessToken,
    refreshToken,
  };
}

function tokenMatches(hash: Buffer, token: string): boolean {
  if (typeof token !== 'string' || token.length > 512) {
    return false;
  }
  const candidate = hashToken(token);
  return (
    candidate.length === hash.length && timingSafeEqual(candidate, hash)
  );
}

export function authenticateSession(input: {
  readonly session: Session;
  readonly accessToken: string;
  readonly account: Account;
  readonly device: Device;
  readonly now: string;
}): Session {
  assertIsoUtcMs(input.now, 'now');
  if (
    input.session.accountId !== input.account.id ||
    input.session.deviceId !== input.device.id
  ) {
    fail('IDENTITY_SESSION_INVALID', 'Session liée à un autre compte ou appareil');
  }
  if (input.session.revokedAt !== null) {
    fail('IDENTITY_SESSION_INVALID', 'Session révoquée');
  }
  if (new Date(input.now).getTime() >= new Date(input.session.accessExpiresAt).getTime()) {
    fail('IDENTITY_SESSION_EXPIRED', 'Jeton d’accès expiré');
  }
  assertAccountActive(input.account);
  assertDeviceActive(input.device, input.account);
  if (!tokenMatches(input.session.accessTokenHash, input.accessToken)) {
    fail('IDENTITY_SESSION_INVALID', 'Jeton d’accès invalide');
  }
  return input.session;
}

export function refreshSession(input: {
  readonly session: Session;
  readonly refreshToken: string;
  readonly account: Account;
  readonly device: Device;
  readonly now: string;
  readonly accessTtlMs?: number;
}): IssuedSession {
  assertIsoUtcMs(input.now, 'now');
  if (
    input.session.accountId !== input.account.id ||
    input.session.deviceId !== input.device.id
  ) {
    fail('IDENTITY_SESSION_INVALID', 'Rafraîchissement lié à un autre appareil');
  }
  if (input.session.revokedAt !== null) {
    fail('IDENTITY_SESSION_INVALID', 'Session révoquée');
  }
  assertAccountActive(input.account);
  assertDeviceActive(input.device, input.account);
  if (new Date(input.now).getTime() >= new Date(input.session.refreshExpiresAt).getTime()) {
    fail('IDENTITY_SESSION_EXPIRED', 'Jeton de rafraîchissement expiré');
  }
  if (!tokenMatches(input.session.refreshTokenHash, input.refreshToken)) {
    fail('IDENTITY_SESSION_INVALID', 'Jeton de rafraîchissement invalide');
  }
  const accessTtl = input.accessTtlMs ?? ACCESS_TOKEN_MAX_TTL_MS;
  if (
    !Number.isSafeInteger(accessTtl) ||
    accessTtl <= 0 ||
    accessTtl > ACCESS_TOKEN_MAX_TTL_MS
  ) {
    fail(
      'IDENTITY_INVALID_REQUEST',
      'Le jeton d’accès doit expirer en quinze minutes au plus',
    );
  }
  const accessExpiresAt = new Date(
    new Date(input.now).getTime() + accessTtl,
  ).toISOString();
  if (
    new Date(accessExpiresAt).getTime() >
    new Date(input.session.refreshExpiresAt).getTime()
  ) {
    fail('IDENTITY_SESSION_EXPIRED', 'Session trop proche de son expiration');
  }
  const accessToken = randomBytes(32).toString('base64url');
  const refreshToken = randomBytes(32).toString('base64url');
  return {
    session: {
      ...input.session,
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      accessIssuedAt: input.now,
      accessExpiresAt,
    },
    accessToken,
    refreshToken,
  };
}

export function revokeSession(session: Session, now: string): Session {
  assertIsoUtcMs(now, 'now');
  if (session.revokedAt !== null) {
    return session;
  }
  return { ...session, revokedAt: now };
}

// La récupération par appareil de confiance reste interdite tant qu'une
// attestation d'appareil réelle n'est pas livrée : seul le KYC renforcé ouvre.
export type RecoveryMethod = 'KYC_STRONG';

// Refus par défaut : le solde n'est jamais un paramètre libre. Seuls les
// totaux lus dans `ledger.account_balance` peuvent construire cet objet, et
// le constructeur privé interdit de le forger depuis l'extérieur.
export class ClientBalance {
  readonly #netCreditXaf: bigint;

  private constructor(netCreditXaf: bigint) {
    this.#netCreditXaf = netCreditXaf;
  }

  public static fromLedgerTotals(totals: {
    readonly debitTotalXaf: bigint;
    readonly creditTotalXaf: bigint;
  }): ClientBalance {
    if (
      typeof totals.debitTotalXaf !== 'bigint' ||
      typeof totals.creditTotalXaf !== 'bigint' ||
      totals.debitTotalXaf < 0n ||
      totals.creditTotalXaf < 0n
    ) {
      fail('IDENTITY_INVALID_REQUEST', 'Totaux de solde invalides');
    }
    const netCreditXaf = totals.creditTotalXaf - totals.debitTotalXaf;
    if (netCreditXaf < 0n || netCreditXaf > MAX_AMOUNT) {
      fail('IDENTITY_INVALID_REQUEST', 'Solde client incohérent');
    }
    return new ClientBalance(netCreditXaf);
  }

  public get xaf(): bigint {
    return this.#netCreditXaf;
  }
}

export type RecoveryStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';

export type RecoveryRequest = {
  readonly id: string;
  readonly accountId: string;
  readonly oldPhone: string;
  readonly newPhone: string;
  readonly method: RecoveryMethod;
  readonly requestedAt: string;
  readonly availableAt: string;
  readonly hadBalance: boolean;
  readonly status: RecoveryStatus;
  readonly completedAt: string | null;
};

export function requestRecovery(input: {
  readonly id: string;
  readonly account: Account;
  readonly newPhone: string;
  readonly method: RecoveryMethod;
  readonly balance: ClientBalance;
  readonly now: string;
}): RecoveryRequest {
  assertUuidV7(input.id, 'id');
  assertIsoUtcMs(input.now, 'now');
  assertAccountActive(input.account);
  if (input.method !== 'KYC_STRONG') {
    fail(
      'IDENTITY_RECOVERY_FORBIDDEN',
      'Seul un KYC renforcé ouvre la récupération',
    );
  }
  if (input.account.kycLevel !== 'STRONG') {
    fail(
      'IDENTITY_RECOVERY_FORBIDDEN',
      'Une vérification KYC renforcée est exigée',
    );
  }
  const newPhone = normalizePhone(input.newPhone);
  if (newPhone === input.account.phone) {
    fail(
      'IDENTITY_RECOVERY_FORBIDDEN',
      'Le nouveau numéro doit différer du numéro actuel',
    );
  }
  if (!(input.balance instanceof ClientBalance)) {
    fail('IDENTITY_INVALID_REQUEST', 'Solde dérivé du grand livre requis');
  }
  const hadBalance = input.balance.xaf > 0n;
  return {
    id: input.id,
    accountId: input.account.id,
    oldPhone: input.account.phone,
    newPhone,
    method: input.method,
    requestedAt: input.now,
    availableAt: new Date(
      new Date(input.now).getTime() +
        (hadBalance ? RECOVERY_SECURITY_DELAY_MS : 0),
    ).toISOString(),
    hadBalance,
    status: 'PENDING',
    completedAt: null,
  };
}

export function confirmRecovery(input: {
  readonly recovery: RecoveryRequest;
  readonly account: Account;
  readonly otpProof: OtpProof;
  readonly now: string;
  readonly pepper: Uint8Array;
}): RecoveryRequest {
  assertIsoUtcMs(input.now, 'now');
  if (input.recovery.status !== 'PENDING') {
    fail('IDENTITY_RECOVERY_FORBIDDEN', 'Récupération déjà traitée');
  }
  if (input.account.id !== input.recovery.accountId) {
    fail(
      'IDENTITY_RECOVERY_FORBIDDEN',
      'Récupération liée à un autre compte',
    );
  }
  if (input.account.phone !== input.recovery.oldPhone) {
    fail(
      'IDENTITY_RECOVERY_FORBIDDEN',
      'Le numéro du compte a changé depuis la demande',
    );
  }
  assertAccountActive(input.account);
  if (new Date(input.now).getTime() < new Date(input.recovery.availableAt).getTime()) {
    fail(
      'IDENTITY_RECOVERY_NOT_DUE',
      'Le délai de sécurité de vingt-quatre heures n’est pas écoulé',
    );
  }
  if (input.account.kycLevel !== 'STRONG') {
    fail(
      'IDENTITY_RECOVERY_FORBIDDEN',
      'Une vérification KYC renforcée est exigée',
    );
  }
  assertOtpProof(
    input.otpProof,
    {
      purpose: 'RECOVERY',
      binding: input.recovery.accountId,
      phone: input.recovery.newPhone,
    },
    input.now,
    input.pepper,
  );
  return {
    ...input.recovery,
    status: 'COMPLETED',
    completedAt: input.now,
  };
}

export function cancelRecovery(
  recovery: RecoveryRequest,
  now: string,
): RecoveryRequest {
  assertIsoUtcMs(now, 'now');
  if (recovery.status !== 'PENDING') {
    return recovery;
  }
  return { ...recovery, status: 'CANCELLED' };
}

export const IDENTITY_AUDIT_ACTIONS = [
  'OTP_ISSUED',
  'OTP_VERIFIED',
  'OTP_FAILED',
  'PIN_SET',
  'PIN_VERIFIED',
  'PIN_FAILED',
  'PIN_LOCKED',
  'DEVICE_REGISTERED',
  'DEVICE_REVOKED',
  'ACCOUNT_BLOCKED',
  'SESSION_CREATED',
  'SESSION_REVOKED',
  'TRANSACTION_AUTHORIZED',
  'TRANSACTION_DENIED',
  'RECOVERY_REQUESTED',
  'RECOVERY_COMPLETED',
] as const;

export type IdentityAuditAction = (typeof IDENTITY_AUDIT_ACTIONS)[number];

const AUDIT_OUTCOME_BY_ACTION: Readonly<
  Record<IdentityAuditAction, 'SUCCESS' | 'DENIED'>
> = {
  OTP_ISSUED: 'SUCCESS',
  OTP_VERIFIED: 'SUCCESS',
  OTP_FAILED: 'DENIED',
  PIN_SET: 'SUCCESS',
  PIN_VERIFIED: 'SUCCESS',
  PIN_FAILED: 'DENIED',
  PIN_LOCKED: 'DENIED',
  DEVICE_REGISTERED: 'SUCCESS',
  DEVICE_REVOKED: 'SUCCESS',
  ACCOUNT_BLOCKED: 'SUCCESS',
  SESSION_CREATED: 'SUCCESS',
  SESSION_REVOKED: 'SUCCESS',
  TRANSACTION_AUTHORIZED: 'SUCCESS',
  TRANSACTION_DENIED: 'DENIED',
  RECOVERY_REQUESTED: 'SUCCESS',
  RECOVERY_COMPLETED: 'SUCCESS',
};

export function identityAuditEvent(input: {
  readonly id: string;
  readonly ts: string;
  readonly action: IdentityAuditAction;
  readonly actorId: string;
  readonly accountId: string;
  readonly deviceId?: string;
  readonly challengeId?: string;
  readonly operationId?: string;
  readonly reason?: string;
}): AuditEventDraft {
  if (!(IDENTITY_AUDIT_ACTIONS as readonly string[]).includes(input.action)) {
    fail('IDENTITY_INVALID_REQUEST', `Action d’audit inconnue: ${input.action}`);
  }
  assertUuidV7(input.id, 'id');
  assertIsoUtcMs(input.ts, 'ts');
  const actorId = assertLabel(input.actorId, 'actorId', 200);
  assertUuidV7(input.accountId, 'accountId');
  const refs: Record<string, JsonValue> = { account_id: input.accountId };
  if (input.deviceId !== undefined) {
    assertUuidV7(input.deviceId, 'deviceId');
    refs['device_id'] = input.deviceId;
  }
  if (input.challengeId !== undefined) {
    assertUuidV7(input.challengeId, 'challengeId');
    refs['challenge_id'] = input.challengeId;
  }
  if (input.operationId !== undefined) {
    assertUuidV7(input.operationId, 'operationId');
    refs['operation_id'] = input.operationId;
  }
  const draft: AuditEventDraft = {
    id: input.id,
    ts: input.ts,
    eventType: 'IDENTITY_ACTION',
    actorId,
    action: input.action,
    targetType: 'ACCOUNT',
    targetId: input.accountId,
    // L'issue est dérivée de l'action : un appelant ne peut pas déclarer
    // « SUCCESS » un échec d'OTP.
    outcome: AUDIT_OUTCOME_BY_ACTION[input.action],
    refs,
  };
  return input.reason === undefined
    ? draft
    : { ...draft, reason: assertAuditReason(input.reason) };
}
