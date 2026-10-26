import {
  generateKeyPairSync,
  KeyObject,
  randomBytes,
  sign,
} from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorCode } from '@achat/contracts';
import {
  assertAccountActive,
  assertOtpProof,
  assertStrongPin,
  authenticateSession,
  authorizeTransaction,
  blockAccount,
  cancelRecovery,
  canonicalTransaction,
  confirmRecovery,
  createAccount,
  createPinState,
  createSession,
  hashPin,
  identityAuditEvent,
  issueOtp,
  normalizePhone,
  refreshSession,
  registerDevice,
  requestRecovery,
  revokeDevice,
  revokeSession,
  verifyOtp,
  verifyPinAttempt,
  verifyPinHash,
  type Account,
  type Device,
  type OtpIssue,
  type OtpProof,
  type TransactionRequest,
} from './domain';

const PHONE = '+237612345678';
const NOW = '2026-10-26T09:00:00.000Z';
const LATER = '2026-10-26T09:01:00.000Z';

const ACCOUNT_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789ab';
const DEVICE_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789ac';
const OTHER_DEVICE_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789b3';
const CHALLENGE_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789ad';
const DEVICE_CHALLENGE_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789ae';
const OTHER_DEVICE_CHALLENGE_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789af';
const RECOVERY_CHALLENGE_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789b0';
const OPERATION_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789b1';
const NONCE = '019a0c2e-7b3a-7c4d-8e5f-0123456789b2';
const SESSION_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789b4';
const RECOVERY_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789b5';
const AUDIT_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789b6';
const STRONG_PIN = '284917';

let pepper: Uint8Array;
let otherPepper: Uint8Array;
let privateKey: KeyObject;
let publicKeyPem: string;
let otherPrivateKey: KeyObject;
let ecPublicKeyPem: string;

function generateEd25519(): {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
} {
  const pair = generateKeyPairSync('ed25519');
  if (
    !(pair.privateKey instanceof KeyObject) ||
    !(pair.publicKey instanceof KeyObject)
  ) {
    throw new Error('Paire Ed25519 attendue');
  }
  return { privateKey: pair.privateKey, publicKey: pair.publicKey };
}

beforeAll(() => {
  pepper = randomBytes(32);
  otherPepper = randomBytes(32);
  const pair = generateEd25519();
  privateKey = pair.privateKey;
  publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  otherPrivateKey = generateEd25519().privateKey;
  ecPublicKeyPem = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .publicKey.export({ type: 'spki', format: 'pem' })
    .toString();
});

function verify(issued: OtpIssue, now = NOW): OtpProof {
  const result = verifyOtp(issued.challenge, issued.code, now, pepper);
  if (!result.ok) {
    throw new Error(`OTP refusé: ${result.code}`);
  }
  return result.proof;
}

function signup(now = NOW): Account {
  const issued = issueOtp({
    id: CHALLENGE_ID,
    phone: PHONE,
    purpose: 'SIGNUP',
    binding: PHONE,
    now,
    pepper,
  });
  return createAccount({
    id: ACCOUNT_ID,
    phone: PHONE,
    now,
    otpProof: verify(issued, now),
    pepper,
  });
}

function register(
  account: Account,
  input?: {
    readonly id?: string;
    readonly challengeId?: string;
    readonly publicKeyPem?: string;
    readonly now?: string;
  },
): Device {
  const id = input?.id ?? DEVICE_ID;
  const now = input?.now ?? NOW;
  const issued = issueOtp({
    id: input?.challengeId ?? DEVICE_CHALLENGE_ID,
    phone: account.phone,
    purpose: 'NEW_DEVICE',
    binding: id,
    now,
    pepper,
  });
  return registerDevice({
    id,
    account,
    publicKeyPem: input?.publicKeyPem ?? publicKeyPem,
    name: 'Téléphone principal',
    now,
    otpProof: verify(issued, now),
    pepper,
  });
}

function transaction(overrides: Partial<TransactionRequest> = {}): TransactionRequest {
  return {
    operationId: OPERATION_ID,
    accountId: ACCOUNT_ID,
    deviceId: DEVICE_ID,
    action: 'WITHDRAWAL',
    amountXaf: '25000',
    cityId: 'douala',
    partnerId: null,
    nonce: NONCE,
    issuedAt: NOW,
    expiresAt: '2026-10-26T09:05:00.000Z',
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: ErrorCode): void {
  expect(action).toThrow(expect.objectContaining({ code }));
}

async function expectAsyncCode(
  action: Promise<unknown>,
  code: ErrorCode,
): Promise<void> {
  await expect(action).rejects.toMatchObject({ code });
}

describe('F-ACC-001 · inscription et OTP', () => {
  it('normalise les formats E.164 usuels et refuse le reste', () => {
    expect(normalizePhone('+237 612 34 56 78')).toBe(PHONE);
    expect(normalizePhone('00237 612-34-56-78')).toBe(PHONE);
    expect(normalizePhone('237612345678')).toBe(PHONE);
    expect(() => normalizePhone('612345678')).toThrow(
      expect.objectContaining({ code: 'IDENTITY_INVALID_PHONE' }),
    );
    expect(() => normalizePhone('+237ABC45678')).toThrow(
      expect.objectContaining({ code: 'IDENTITY_INVALID_PHONE' }),
    );
  });

  it('émet un code à usage unique et vérifie sa preuve', () => {
    const issued = issueOtp({
      id: CHALLENGE_ID,
      phone: PHONE,
      purpose: 'SIGNUP',
      binding: PHONE,
      now: NOW,
      pepper,
    });
    expect(issued.code).toMatch(/^[0-9]{6}$/u);
    expect(issued.challenge.codeHash).toHaveLength(32);
    expect(issued.challenge.codeHash.toString('hex')).not.toContain(issued.code);

    const result = verifyOtp(issued.challenge, issued.code, NOW, pepper);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('OTP attendu valide');
    }
    expect(result.challenge.consumedAt).toBe(NOW);
    expect(result.proof).toMatchObject({
      phone: PHONE,
      purpose: 'SIGNUP',
      binding: PHONE,
    });
    assertOtpProof(
      result.proof,
      { purpose: 'SIGNUP', binding: PHONE },
      NOW,
      pepper,
    );
  });

  it('refuse le rejeu, l’expiration et cinq mauvais codes', () => {
    const issued = issueOtp({
      id: CHALLENGE_ID,
      phone: PHONE,
      purpose: 'SIGNUP',
      binding: PHONE,
      now: NOW,
      pepper,
    });
    const valid = verifyOtp(issued.challenge, issued.code, NOW, pepper);
    if (!valid.ok) {
      throw new Error('OTP attendu valide');
    }
    expect(
      verifyOtp(valid.challenge, issued.code, NOW, pepper),
    ).toMatchObject({ ok: false, code: 'IDENTITY_OTP_REPLAYED' });

    const expired = issueOtp({
      id: DEVICE_CHALLENGE_ID,
      phone: PHONE,
      purpose: 'SIGNUP',
      binding: PHONE,
      now: NOW,
      pepper,
    });
    expect(
      verifyOtp(expired.challenge, expired.code, '2026-10-26T09:06:00.000Z', pepper),
    ).toMatchObject({ ok: false, code: 'IDENTITY_OTP_EXPIRED' });

    let challenge = issueOtp({
      id: OTHER_DEVICE_CHALLENGE_ID,
      phone: PHONE,
      purpose: 'SIGNUP',
      binding: PHONE,
      now: NOW,
      pepper,
    }).challenge;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = verifyOtp(challenge, '000000', NOW, pepper);
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error('Code invalide accepté');
      }
      expect(result.code).toBe('IDENTITY_OTP_INVALID');
      expect(result.challenge.attemptsRemaining).toBe(5 - attempt);
      challenge = result.challenge;
    }
    const locked = verifyOtp(challenge, '000000', NOW, pepper);
    expect(locked).toMatchObject({ ok: false, code: 'IDENTITY_OTP_LOCKED' });
    if (locked.ok) {
      throw new Error('OTP verrouillé attendu');
    }
    expect(locked.challenge.attemptsRemaining).toBe(0);
  });

  it('refuse une preuve OTP d’un autre objet, d’une autre liaison ou trop vieille', () => {
    const issued = issueOtp({
      id: CHALLENGE_ID,
      phone: PHONE,
      purpose: 'NEW_DEVICE',
      binding: DEVICE_ID,
      now: NOW,
      pepper,
    });
    const proof = verify(issued);
    expectCode(
      () =>
        assertOtpProof(
          proof,
          { purpose: 'SIGNUP', binding: DEVICE_ID },
          NOW,
          pepper,
        ),
      'IDENTITY_OTP_INVALID',
    );
    expectCode(
      () =>
        assertOtpProof(
          proof,
          { purpose: 'NEW_DEVICE', binding: OTHER_DEVICE_ID },
          NOW,
          pepper,
        ),
      'IDENTITY_OTP_INVALID',
    );
    expectCode(
      () =>
        assertOtpProof(
          proof,
          { purpose: 'NEW_DEVICE', binding: DEVICE_ID },
          '2026-10-26T09:11:00.000Z',
          pepper,
        ),
      'IDENTITY_OTP_INVALID',
    );
  });

  it('crée le compte uniquement après un OTP SIGNUP vérifié', () => {
    const account = signup();
    expect(account).toMatchObject({
      phone: PHONE,
      status: 'ACTIVE',
      phoneVerifiedAt: NOW,
      kycLevel: 'NONE',
    });
    assertAccountActive(account);

    const deviceOtp = issueOtp({
      id: DEVICE_CHALLENGE_ID,
      phone: PHONE,
      purpose: 'NEW_DEVICE',
      binding: DEVICE_ID,
      now: NOW,
      pepper,
    });
    const deviceProof = verify(deviceOtp);
    expectCode(
      () =>
        createAccount({
          id: ACCOUNT_ID,
          phone: PHONE,
          now: NOW,
          otpProof: deviceProof,
          pepper,
        }),
      'IDENTITY_OTP_INVALID',
    );
  });
});

describe('F-ACC-006 · blocage et appareils', () => {
  it('bloque immédiatement et conserve le premier motif', () => {
    const account = signup();
    const blocked = blockAccount(account, {
      now: LATER,
      channel: 'USSD',
      reason: 'Téléphone volé',
    });
    expect(blocked).toMatchObject({
      status: 'BLOCKED',
      blockedAt: LATER,
      blockChannel: 'USSD',
      blockReason: 'Téléphone volé',
    });
    expectCode(() => assertAccountActive(blocked), 'IDENTITY_ACCOUNT_BLOCKED');
    expect(
      blockAccount(blocked, {
        now: '2026-10-26T09:02:00.000Z',
        channel: 'SUPPORT',
        reason: 'Deuxième signalement',
      }),
    ).toBe(blocked);
  });

  it('enregistre une clé Ed25519 réelle et calcule son empreinte', () => {
    const account = signup();
    const device = register(account);
    expect(device).toMatchObject({
      accountId: ACCOUNT_ID,
      status: 'ACTIVE',
      registeredAt: NOW,
    });
    expect(device.fingerprint).toHaveLength(32);
    expect(device.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });

  it('refuse une clé privée, une clé non Ed25519 et une preuve SIGNUP', () => {
    const account = signup();
    const privatePem = generateKeyPairSync('ed25519')
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expectCode(
      () => register(account, { publicKeyPem: privatePem }),
      'IDENTITY_INVALID_REQUEST',
    );
    expectCode(
      () => register(account, { publicKeyPem: ecPublicKeyPem }),
      'IDENTITY_INVALID_REQUEST',
    );

    const signupIssued = issueOtp({
      id: CHALLENGE_ID,
      phone: PHONE,
      purpose: 'SIGNUP',
      binding: PHONE,
      now: NOW,
      pepper,
    });
    expectCode(
      () =>
        registerDevice({
          id: DEVICE_ID,
          account,
          publicKeyPem,
          name: 'Téléphone',
          now: NOW,
          otpProof: verify(signupIssued),
          pepper,
        }),
      'IDENTITY_OTP_INVALID',
    );
  });

  it('révoque un appareil immédiatement et de façon idempotente', () => {
    const account = signup();
    const device = register(account);
    const revoked = revokeDevice(device, {
      now: LATER,
      reason: 'Perte déclarée',
    });
    expect(revoked).toMatchObject({ status: 'REVOKED', revokedAt: LATER });
    expect(
      revokeDevice(revoked, { now: NOW, reason: 'Deuxième demande' }),
    ).toBe(revoked);
  });
});

describe('F-ACC-002 et SEC-AUTH-003 · PIN Argon2id', () => {
  it('refuse les suites et répétitions triviales', () => {
    for (const weak of [
      '000000',
      '111111',
      '123456',
      '654321',
      '012345',
      '987654',
      '890123',
      '121212',
      '123123',
    ]) {
      expectCode(() => assertStrongPin(weak), 'IDENTITY_PIN_WEAK');
    }
    expect(() => assertStrongPin(STRONG_PIN)).not.toThrow();
  });

  it('dérive un Argon2id poivré et ne stocke jamais le PIN', async () => {
    const hash = await hashPin(STRONG_PIN, pepper);
    expect(hash).toMatch(/^\$argon2id\$v=19\$/u);
    expect(hash).not.toContain(STRONG_PIN);
    await expect(verifyPinHash(hash, STRONG_PIN, pepper)).resolves.toBe(true);
    await expect(verifyPinHash(hash, '284918', pepper)).resolves.toBe(false);
    await expect(verifyPinHash(hash, STRONG_PIN, otherPepper)).resolves.toBe(
      false,
    );
    await expect(
      hashPin(STRONG_PIN, new Uint8Array(16)),
    ).rejects.toMatchObject({ code: 'IDENTITY_INVALID_REQUEST' });
  });

  it('réinitialise les échecs après un PIN correct', async () => {
    const account = signup();
    const device = register(account);
    let state = await createPinState({
      account,
      device,
      pin: STRONG_PIN,
      pepper,
      now: NOW,
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await verifyPinAttempt(state, '284918', pepper, NOW);
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error('PIN invalide accepté');
      }
      expect(result.code).toBe('IDENTITY_PIN_INVALID');
      state = result.state;
    }
    expect(state.failedAttempts).toBe(4);
    const success = await verifyPinAttempt(state, STRONG_PIN, pepper, NOW);
    expect(success.ok).toBe(true);
    if (!success.ok) {
      throw new Error('PIN valide refusé');
    }
    expect(success.state.failedAttempts).toBe(0);
    expect(success.state.lockedUntil).toBeNull();
  });

  it('verrouille après cinq essais avec un délai progressif', async () => {
    const account = signup();
    const device = register(account);
    let state = await createPinState({
      account,
      device,
      pin: STRONG_PIN,
      pepper,
      now: NOW,
    });
    let result = await verifyPinAttempt(state, '284918', pepper, NOW);
    for (let attempt = 1; attempt < 5; attempt += 1) {
      if (result.ok) {
        throw new Error('Échec attendu');
      }
      state = result.state;
      result = await verifyPinAttempt(state, '284918', pepper, NOW);
    }
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Verrouillage attendu');
    }
    expect(result.code).toBe('IDENTITY_PIN_LOCKED');
    state = result.state;
    expect(state.lockouts).toBe(1);
    expect(state.lockedUntil).toBe('2026-10-26T09:05:00.000Z');

    const during = await verifyPinAttempt(
      state,
      STRONG_PIN,
      pepper,
      '2026-10-26T09:04:59.000Z',
    );
    expect(during).toMatchObject({
      ok: false,
      code: 'IDENTITY_PIN_LOCKED',
    });

    let second = await verifyPinAttempt(
      state,
      '284918',
      pepper,
      '2026-10-26T09:05:01.000Z',
    );
    for (let attempt = 1; attempt < 5; attempt += 1) {
      if (second.ok) {
        throw new Error('Échec attendu');
      }
      second = await verifyPinAttempt(
        second.state,
        '284918',
        pepper,
        '2026-10-26T09:05:01.000Z',
      );
    }
    if (second.ok) {
      throw new Error('Second verrouillage attendu');
    }
    expect(second.state.lockouts).toBe(2);
    expect(second.state.lockedUntil).toBe('2026-10-26T09:20:01.000Z');
  });

  it('purge un verrou expiré avant d’enregistrer un nouvel échec', async () => {
    const account = signup();
    const device = register(account);
    const state = await createPinState({
      account,
      device,
      pin: STRONG_PIN,
      pepper,
      now: NOW,
    });
    const locked: typeof state = {
      ...state,
      lockouts: 1,
      lockedUntil: '2026-10-26T09:05:00.000Z',
    };
    const after = await verifyPinAttempt(
      locked,
      '284918',
      pepper,
      '2026-10-26T09:05:01.000Z',
    );
    expect(after.ok).toBe(false);
    if (after.ok) {
      throw new Error('Échec attendu');
    }
    expect(after.code).toBe('IDENTITY_PIN_INVALID');
    expect(after.state.failedAttempts).toBe(1);
    expect(after.state.lockedUntil).toBeNull();
  });
});

describe('SEC-AUTH-002 · signature de transaction', () => {
  async function fixture(): Promise<{
    account: Account;
    device: Device;
    pinState: Awaited<ReturnType<typeof createPinState>>;
  }> {
    const account = signup();
    const device = register(account);
    const pinState = await createPinState({
      account,
      device,
      pin: STRONG_PIN,
      pepper,
      now: NOW,
    });
    return { account, device, pinState };
  }

  function signatureFor(tx: TransactionRequest): Buffer {
    return sign(null, Buffer.from(canonicalTransaction(tx), 'utf8'), privateKey);
  }

  it('autorise une transaction signée après PIN valide', async () => {
    const { account, device, pinState } = await fixture();
    const tx = transaction();
    const result = await authorizeTransaction({
      account,
      device,
      pinState,
      pin: STRONG_PIN,
      pepper,
      transaction: tx,
      signature: signatureFor(tx),
      now: LATER,
    });
    expect(result.authorized).toBe(true);
    if (!result.authorized) {
      throw new Error('Transaction attendue autorisée');
    }
    expect(result.transaction.payloadHash).toHaveLength(32);
    expect(result.transaction.signature).toHaveLength(64);
    expect(result.pinState.failedAttempts).toBe(0);
    expect(canonicalTransaction(tx)).not.toContain(STRONG_PIN);
  });

  it('refuse une signature altérée, un autre appareil ou un autre montant', async () => {
    const { account, device, pinState } = await fixture();
    const tx = transaction();
    const good = signatureFor(tx);
    const tampered = Buffer.from(good);
    tampered[10] = (tampered[10] ?? 0) ^ 1;

    await expectAsyncCode(
      authorizeTransaction({
        account,
        device,
        pinState,
        pin: STRONG_PIN,
        pepper,
        transaction: tx,
        signature: tampered,
        now: LATER,
      }),
      'IDENTITY_SIGNATURE_INVALID',
    );

    await expectAsyncCode(
      authorizeTransaction({
        account,
        device,
        pinState,
        pin: STRONG_PIN,
        pepper,
        transaction: { ...tx, amountXaf: '35000' },
        signature: good,
        now: LATER,
      }),
      'IDENTITY_SIGNATURE_INVALID',
    );

    await expectAsyncCode(
      authorizeTransaction({
        account,
        device,
        pinState,
        pin: STRONG_PIN,
        pepper,
        transaction: tx,
        signature: sign(
          null,
          Buffer.from(canonicalTransaction(tx), 'utf8'),
          otherPrivateKey,
        ),
        now: LATER,
      }),
      'IDENTITY_SIGNATURE_INVALID',
    );

    await expectAsyncCode(
      authorizeTransaction({
        account,
        device: { ...device, fingerprint: Buffer.alloc(32) },
        pinState,
        pin: STRONG_PIN,
        pepper,
        transaction: tx,
        signature: good,
        now: LATER,
      }),
      'IDENTITY_DEVICE_UNKNOWN',
    );
  });

  it('refuse une signature qui n’est pas un tableau d’octets', async () => {
    const { account, device, pinState } = await fixture();
    const tx = transaction();
    await expectAsyncCode(
      authorizeTransaction({
        account,
        device,
        pinState,
        pin: STRONG_PIN,
        pepper,
        transaction: tx,
        signature: 'x'.repeat(64) as unknown as Uint8Array,
        now: LATER,
      }),
      'IDENTITY_SIGNATURE_INVALID',
    );
  });

  it('refuse un montant au-delà de la plage BIGINT ou non textuel', () => {
    expectCode(
      () =>
        canonicalTransaction(
          transaction({ amountXaf: '9223372036854775808' }),
        ),
      'IDENTITY_INVALID_REQUEST',
    );
    expectCode(
      () =>
        canonicalTransaction(
          transaction({ amountXaf: 25_000 as unknown as string }),
        ),
      'IDENTITY_INVALID_REQUEST',
    );
    expectCode(
      () =>
        canonicalTransaction(
          transaction({ operationId: 123 as unknown as string }),
        ),
      'IDENTITY_INVALID_REQUEST',
    );
  });

  it('refuse le rejeu du nonce et de l’opération', async () => {
    const { account, device, pinState } = await fixture();
    const tx = transaction();
    await expectAsyncCode(
      authorizeTransaction({
        account,
        device,
        pinState,
        pin: STRONG_PIN,
        pepper,
        transaction: tx,
        signature: signatureFor(tx),
        now: LATER,
        seenNonces: [NONCE],
      }),
      'IDENTITY_NONCE_REUSED',
    );
    await expectAsyncCode(
      authorizeTransaction({
        account,
        device,
        pinState,
        pin: STRONG_PIN,
        pepper,
        transaction: tx,
        signature: signatureFor(tx),
        now: LATER,
        seenOperationIds: [OPERATION_ID],
      }),
      'IDENTITY_NONCE_REUSED',
    );
  });

  it('refuse une transaction expirée, future ou de plus de quinze minutes', async () => {
    const { account, device, pinState } = await fixture();
    const expired = transaction({
      issuedAt: '2026-10-26T08:50:00.000Z',
      expiresAt: '2026-10-26T08:55:00.000Z',
    });
    await expectAsyncCode(
      authorizeTransaction({
        account,
        device,
        pinState,
        pin: STRONG_PIN,
        pepper,
        transaction: expired,
        signature: signatureFor(expired),
        now: NOW,
      }),
      'IDENTITY_TRANSACTION_EXPIRED',
    );

    const future = transaction({
      issuedAt: '2026-10-26T09:10:00.000Z',
      expiresAt: '2026-10-26T09:15:00.000Z',
    });
    await expectAsyncCode(
      authorizeTransaction({
        account,
        device,
        pinState,
        pin: STRONG_PIN,
        pepper,
        transaction: future,
        signature: signatureFor(future),
        now: NOW,
      }),
      'IDENTITY_INVALID_REQUEST',
    );

    expectCode(
      () =>
        canonicalTransaction(
          transaction({
            issuedAt: NOW,
            expiresAt: '2026-10-26T09:20:00.000Z',
          }),
        ),
      'IDENTITY_INVALID_REQUEST',
    );
  });

  it('refuse un appareil révoqué et un compte bloqué', async () => {
    const { account, device, pinState } = await fixture();
    const tx = transaction();
    const revoked = revokeDevice(device, {
      now: NOW,
      reason: 'Perte déclarée',
    });
    await expectAsyncCode(
      authorizeTransaction({
        account,
        device: revoked,
        pinState,
        pin: STRONG_PIN,
        pepper,
        transaction: tx,
        signature: signatureFor(tx),
        now: LATER,
      }),
      'IDENTITY_DEVICE_REVOKED',
    );

    const blocked = blockAccount(account, {
      now: NOW,
      channel: 'SUPPORT',
      reason: 'Vol signalé',
    });
    await expectAsyncCode(
      authorizeTransaction({
        account: blocked,
        device,
        pinState,
        pin: STRONG_PIN,
        pepper,
        transaction: tx,
        signature: signatureFor(tx),
        now: LATER,
      }),
      'IDENTITY_ACCOUNT_BLOCKED',
    );
  });

  it('décrémente les essais PIN sans révéler la signature', async () => {
    const { account, device, pinState } = await fixture();
    const tx = transaction();
    const result = await authorizeTransaction({
      account,
      device,
      pinState,
      pin: '284918',
      pepper,
      transaction: tx,
      signature: signatureFor(tx),
      now: LATER,
    });
    expect(result.authorized).toBe(false);
    if (result.authorized) {
      throw new Error('PIN invalide accepté');
    }
    expect(result.code).toBe('IDENTITY_PIN_INVALID');
    expect(result.pinState.failedAttempts).toBe(1);
  });
});

describe('SEC-AUTH-005 · sessions', () => {
  it('borne l’accès à quinze minutes et vérifie le jeton', () => {
    const account = signup();
    const device = register(account);
    const issued = createSession({
      id: SESSION_ID,
      account,
      device,
      now: NOW,
    });
    expect(issued.accessToken).not.toBe(issued.refreshToken);
    expect(issued.session.accessIssuedAt).toBe(NOW);
    expect(issued.session.accessExpiresAt).toBe(
      '2026-10-26T09:15:00.000Z',
    );
    expect(issued.accessToken).not.toContain('=');
    expect(
      authenticateSession({
        session: issued.session,
        accessToken: issued.accessToken,
        account,
        device,
        now: LATER,
      }),
    ).toBe(issued.session);

    expectCode(
      () =>
        createSession({
          id: SESSION_ID,
          account,
          device,
          now: NOW,
          accessTtlMs: 15 * 60_000 + 1,
        }),
      'IDENTITY_INVALID_REQUEST',
    );
    expectCode(
      () =>
        authenticateSession({
          session: issued.session,
          accessToken: issued.refreshToken,
          account,
          device,
          now: LATER,
        }),
      'IDENTITY_SESSION_INVALID',
    );
    expectCode(
      () =>
        authenticateSession({
          session: issued.session,
          accessToken: issued.accessToken,
          account,
          device,
          now: '2026-10-26T09:15:00.000Z',
        }),
      'IDENTITY_SESSION_EXPIRED',
    );
  });

  it('lie le rafraîchissement à l’appareil et fait tourner le jeton', () => {
    const account = signup();
    const device = register(account);
    const issued = createSession({
      id: SESSION_ID,
      account,
      device,
      now: NOW,
    });
    expectCode(
      () =>
        refreshSession({
          session: issued.session,
          refreshToken: issued.refreshToken,
          account,
          device: { ...device, id: OTHER_DEVICE_ID },
          now: LATER,
        }),
      'IDENTITY_SESSION_INVALID',
    );
    const refreshed = refreshSession({
      session: issued.session,
      refreshToken: issued.refreshToken,
      account,
      device,
      now: LATER,
    });
    expect(refreshed.refreshToken).not.toBe(issued.refreshToken);
    expect(refreshed.session.accessIssuedAt).toBe(LATER);
    expect(refreshed.session.createdAt).toBe(NOW);
    expectCode(
      () =>
        refreshSession({
          session: refreshed.session,
          refreshToken: issued.refreshToken,
          account,
          device,
          now: '2026-10-26T09:02:00.000Z',
        }),
      'IDENTITY_SESSION_INVALID',
    );
  });

  it('révoque immédiatement la session et suit la révocation de l’appareil', () => {
    const account = signup();
    const device = register(account);
    const issued = createSession({
      id: SESSION_ID,
      account,
      device,
      now: NOW,
    });
    const revoked = revokeSession(issued.session, LATER);
    expect(revoked.revokedAt).toBe(LATER);
    expectCode(
      () =>
        authenticateSession({
          session: revoked,
          accessToken: issued.accessToken,
          account,
          device,
          now: LATER,
        }),
      'IDENTITY_SESSION_INVALID',
    );

    const second = createSession({
      id: OTHER_DEVICE_CHALLENGE_ID,
      account,
      device,
      now: NOW,
    });
    const revokedDevice = revokeDevice(device, {
      now: LATER,
      reason: 'Vol',
    });
    expectCode(
      () =>
        authenticateSession({
          session: second.session,
          accessToken: second.accessToken,
          account,
          device: revokedDevice,
          now: LATER,
        }),
      'IDENTITY_DEVICE_REVOKED',
    );
  });
});

describe('SEC-AUTH-007 · récupération de compte', () => {
  function strongAccount(): Account {
    return { ...signup(), kycLevel: 'STRONG' };
  }

  function recoveryProof(now = NOW): OtpProof {
    const issued = issueOtp({
      id: RECOVERY_CHALLENGE_ID,
      phone: '+237698765432',
      purpose: 'RECOVERY',
      binding: ACCOUNT_ID,
      now,
      pepper,
    });
    return verify(issued, now);
  }

  it('interdit le simple OTP, un appareil non attesté et un KYC insuffisant', () => {
    expectCode(
      () =>
        requestRecovery({
          id: RECOVERY_ID,
          account: strongAccount(),
          newPhone: '+237698765432',
          method: 'OTP_ONLY' as never,
          balanceXaf: 0n,
          now: NOW,
        }),
      'IDENTITY_RECOVERY_FORBIDDEN',
    );
    expectCode(
      () =>
        requestRecovery({
          id: RECOVERY_ID,
          account: strongAccount(),
          newPhone: '+237698765432',
          method: 'TRUSTED_DEVICE' as never,
          balanceXaf: 0n,
          now: NOW,
        }),
      'IDENTITY_RECOVERY_FORBIDDEN',
    );
    expectCode(
      () =>
        requestRecovery({
          id: RECOVERY_ID,
          account: signup(),
          newPhone: '+237698765432',
          method: 'KYC_STRONG',
          balanceXaf: 0n,
          now: NOW,
        }),
      'IDENTITY_RECOVERY_FORBIDDEN',
    );
    expectCode(
      () =>
        requestRecovery({
          id: RECOVERY_ID,
          account: strongAccount(),
          newPhone: PHONE,
          method: 'KYC_STRONG',
          balanceXaf: 0n,
          now: NOW,
        }),
      'IDENTITY_RECOVERY_FORBIDDEN',
    );
  });

  it('impose vingt-quatre heures si le compte porte un solde', () => {
    const account = strongAccount();
    const recovery = requestRecovery({
      id: RECOVERY_ID,
      account,
      newPhone: '+237698765432',
      method: 'KYC_STRONG',
      balanceXaf: 1n,
      now: NOW,
    });
    expect(recovery).toMatchObject({
      status: 'PENDING',
      hadBalance: true,
      availableAt: '2026-10-27T09:00:00.000Z',
    });
    expectCode(
      () =>
        confirmRecovery({
          recovery,
          account,
          otpProof: recoveryProof(),
          now: '2026-10-27T08:59:59.000Z',
          pepper,
        }),
      'IDENTITY_RECOVERY_NOT_DUE',
    );
  });

  it('termine après le délai avec un OTP RECOVERY lié au compte et au numéro', () => {
    const account = strongAccount();
    const recovery = requestRecovery({
      id: RECOVERY_ID,
      account,
      newPhone: '+237698765432',
      method: 'KYC_STRONG',
      balanceXaf: 0n,
      now: NOW,
    });
    expect(recovery.availableAt).toBe(NOW);
    const completed = confirmRecovery({
      recovery,
      account,
      otpProof: recoveryProof(),
      now: LATER,
      pepper,
    });
    expect(completed).toMatchObject({
      status: 'COMPLETED',
      completedAt: LATER,
    });
    expect(cancelRecovery(completed, LATER)).toBe(completed);

    const replay = { ...completed, status: 'PENDING' as const, completedAt: null };
    const deviceIssued = issueOtp({
      id: DEVICE_CHALLENGE_ID,
      phone: '+237698765432',
      purpose: 'NEW_DEVICE',
      binding: ACCOUNT_ID,
      now: NOW,
      pepper,
    });
    expectCode(
      () =>
        confirmRecovery({
          recovery: replay,
          account,
          otpProof: verify(deviceIssued),
          now: LATER,
          pepper,
        }),
      'IDENTITY_OTP_INVALID',
    );
  });

  it('refuse une preuve OTP forgée et un numéro modifié entre-temps', () => {
    const account = strongAccount();
    const recovery = requestRecovery({
      id: RECOVERY_ID,
      account,
      newPhone: '+237698765432',
      method: 'KYC_STRONG',
      balanceXaf: 0n,
      now: NOW,
    });
    const proof = recoveryProof();
    expectCode(
      () =>
        confirmRecovery({
          recovery,
          account,
          otpProof: { ...proof, mac: Buffer.alloc(32) },
          now: LATER,
          pepper,
        }),
      'IDENTITY_OTP_INVALID',
    );
    expectCode(
      () =>
        confirmRecovery({
          recovery,
          account: { ...account, phone: '+237611111111' },
          otpProof: proof,
          now: LATER,
          pepper,
        }),
      'IDENTITY_RECOVERY_FORBIDDEN',
    );
  });
});

describe('SEC-LOG-001 · audit identité', () => {
  it('produit un événement chaînable sans donnée secrète', () => {
    const event = identityAuditEvent({
      id: AUDIT_ID,
      ts: NOW,
      action: 'TRANSACTION_AUTHORIZED',
      actorId: ACCOUNT_ID,
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
      operationId: OPERATION_ID,
      reason: 'Retrait validé',
    });
    expect(event).toMatchObject({
      eventType: 'IDENTITY_ACTION',
      action: 'TRANSACTION_AUTHORIZED',
      outcome: 'SUCCESS',
      targetType: 'ACCOUNT',
      targetId: ACCOUNT_ID,
    });
    const serialized = JSON.stringify(event.refs);
    expect(serialized).not.toMatch(/pin|otp|phone|msisdn|token|secret/iu);
    expect(serialized).toContain(OPERATION_ID);

    const denied = identityAuditEvent({
      id: AUDIT_ID,
      ts: NOW,
      action: 'OTP_FAILED',
      actorId: 'SYSTEM',
      accountId: ACCOUNT_ID,
    });
    expect(denied.outcome).toBe('DENIED');
  });

  it('refuse un motif recopiant un numéro ou un code secret', () => {
    for (const reason of [
      'Rappel au +237612345678',
      'Code 123456 refusé',
      'Numéro 612345678 inconnu',
    ]) {
      expectCode(
        () =>
          identityAuditEvent({
            id: AUDIT_ID,
            ts: NOW,
            action: 'OTP_FAILED',
            actorId: 'SYSTEM',
            accountId: ACCOUNT_ID,
            reason,
          }),
        'IDENTITY_INVALID_REQUEST',
      );
    }
    expect(() =>
      identityAuditEvent({
        id: AUDIT_ID,
        ts: NOW,
        action: 'OTP_FAILED',
        actorId: 'SYSTEM',
        accountId: ACCOUNT_ID,
        reason: 'OTP expiré, nouvel envoi demandé',
      }),
    ).not.toThrow();
  });
});
