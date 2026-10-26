import {
  generateKeyPairSync,
  KeyObject,
  randomBytes,
  sign,
} from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorCode } from '../../packages/contracts/src/errors';
import {
  authenticateSession,
  authorizeTransaction,
  blockAccount,
  canonicalTransaction,
  createAccount,
  createPinState,
  createSession,
  identityAuditEvent,
  issueOtp,
  refreshSession,
  registerDevice,
  requestRecovery,
  confirmRecovery,
  revokeDevice,
  verifyOtp,
  verifyPinAttempt,
  verifyPinHash,
  type Account,
  type Device,
  type OtpProof,
  type PinState,
  type TransactionRequest,
} from '../../apps/api/src/modules/identity/domain';

const PHONE = '+237612345678';
const NEW_PHONE = '+237698765432';
const NOW = '2026-10-26T09:00:00.000Z';
const LATER = '2026-10-26T09:01:00.000Z';

const ACCOUNT_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789ab';
const DEVICE_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789ac';
const SIGNUP_CHALLENGE = '019a0c2e-7b3a-7c4d-8e5f-0123456789ad';
const DEVICE_CHALLENGE = '019a0c2e-7b3a-7c4d-8e5f-0123456789ae';
const RECOVERY_CHALLENGE = '019a0c2e-7b3a-7c4d-8e5f-0123456789af';
const OPERATION_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789b0';
const NONCE = '019a0c2e-7b3a-7c4d-8e5f-0123456789b1';
const RECOVERY_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789b2';
const SESSION_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789b3';
const AUDIT_ID = '019a0c2e-7b3a-7c4d-8e5f-0123456789b4';
const PIN = '284917';

let pepper: Uint8Array;
let privateKey: KeyObject;
let publicKeyPem: string;
let attackerKey: KeyObject;

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
  const pair = generateEd25519();
  privateKey = pair.privateKey;
  publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  attackerKey = generateEd25519().privateKey;
});

function proofFor(
  challengeId: string,
  purpose: 'SIGNUP' | 'NEW_DEVICE' | 'RECOVERY',
  binding: string,
  phone = PHONE,
  now = NOW,
): OtpProof {
  const issued = issueOtp({
    id: challengeId,
    phone,
    purpose,
    binding,
    now,
    pepper,
  });
  const result = verifyOtp(issued.challenge, issued.code, now, pepper);
  if (!result.ok) {
    throw new Error(`OTP de test refusé: ${result.code}`);
  }
  return result.proof;
}

function account(now = NOW): Account {
  return createAccount({
    id: ACCOUNT_ID,
    phone: PHONE,
    now,
    otpProof: proofFor(SIGNUP_CHALLENGE, 'SIGNUP', PHONE, PHONE, now),
    pepper,
  });
}

function deviceFor(
  owner: Account,
  input?: { readonly id?: string; readonly challengeId?: string; readonly pem?: string },
): Device {
  const id = input?.id ?? DEVICE_ID;
  return registerDevice({
    id,
    account: owner,
    publicKeyPem: input?.pem ?? publicKeyPem,
    name: 'Appareil',
    now: NOW,
    otpProof: proofFor(
      input?.challengeId ?? DEVICE_CHALLENGE,
      'NEW_DEVICE',
      id,
      owner.phone,
      NOW,
    ),
    pepper,
  });
}

async function pinStateFor(owner: Account, device: Device): Promise<PinState> {
  return createPinState({
    account: owner,
    device,
    pin: PIN,
    pepper,
    now: NOW,
  });
}

function tx(overrides: Partial<TransactionRequest> = {}): TransactionRequest {
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

function signed(transaction: TransactionRequest, key = privateKey): Buffer {
  return sign(
    null,
    Buffer.from(canonicalTransaction(transaction), 'utf8'),
    key,
  );
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

describe('Attaques identité · OTP', () => {
  it('F-ACC-001 ne laisse pas deviner un OTP en cinq essais', () => {
    const issued = issueOtp({
      id: SIGNUP_CHALLENGE,
      phone: PHONE,
      purpose: 'SIGNUP',
      binding: PHONE,
      now: NOW,
      pepper,
    });
    let challenge = issued.challenge;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = verifyOtp(
        challenge,
        issued.code === '000000' ? '000001' : '000000',
        NOW,
        pepper,
      );
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error('OTP deviné');
      }
      challenge = result.challenge;
    }
    expect(verifyOtp(challenge, issued.code, NOW, pepper)).toMatchObject({
      ok: false,
      code: 'IDENTITY_OTP_LOCKED',
    });
  });

  it('F-ACC-001 refuse le rejeu du même OTP', () => {
    const issued = issueOtp({
      id: SIGNUP_CHALLENGE,
      phone: PHONE,
      purpose: 'SIGNUP',
      binding: PHONE,
      now: NOW,
      pepper,
    });
    expect(verifyOtp(issued.challenge, issued.code, NOW, pepper).ok).toBe(true);
    const replay = verifyOtp(
      {
        ...issued.challenge,
        consumedAt: NOW,
      },
      issued.code,
      NOW,
      pepper,
    );
    expect(replay).toMatchObject({
      ok: false,
      code: 'IDENTITY_OTP_REPLAYED',
    });
  });

  it('F-ACC-001 refuse un code émis pour une autre liaison', () => {
    const issued = issueOtp({
      id: SIGNUP_CHALLENGE,
      phone: PHONE,
      purpose: 'SIGNUP',
      binding: PHONE,
      now: NOW,
      pepper,
    });
    const crossed = {
      ...issued.challenge,
      id: DEVICE_CHALLENGE,
      binding: DEVICE_ID,
      purpose: 'NEW_DEVICE' as const,
    };
    expect(verifyOtp(crossed, issued.code, NOW, pepper).ok).toBe(false);
  });

  it('SEC-AUTH-001 refuse une preuve OTP expirée pour un nouvel appareil', () => {
    const owner = account();
    const proof = proofFor(DEVICE_CHALLENGE, 'NEW_DEVICE', DEVICE_ID);
    expectCode(
      () =>
        registerDevice({
          id: DEVICE_ID,
          account: owner,
          publicKeyPem,
          name: 'Appareil',
          now: '2026-10-26T09:10:01.000Z',
          otpProof: proof,
          pepper,
        }),
      'IDENTITY_OTP_INVALID',
    );
  });

  it('SEC-AUTH-001 refuse une preuve SIGNUP pour enrôler un appareil', () => {
    const owner = account();
    expectCode(
      () =>
        registerDevice({
          id: DEVICE_ID,
          account: owner,
          publicKeyPem,
          name: 'Appareil',
          now: NOW,
          otpProof: proofFor(SIGNUP_CHALLENGE, 'SIGNUP', PHONE),
          pepper,
        }),
      'IDENTITY_OTP_INVALID',
    );
  });

  it('SEC-AUTH-001 refuse une preuve OTP forgée sans MAC poivré', () => {
    const owner = account();
    const proof = proofFor(SIGNUP_CHALLENGE, 'SIGNUP', PHONE);
    expectCode(
      () =>
        createAccount({
          id: ACCOUNT_ID,
          phone: PHONE,
          now: NOW,
          otpProof: { ...proof, mac: Buffer.alloc(32) },
          pepper,
        }),
      'IDENTITY_OTP_INVALID',
    );
    expectCode(
      () =>
        registerDevice({
          id: DEVICE_ID,
          account: owner,
          publicKeyPem,
          name: 'Appareil',
          now: NOW,
          otpProof: {
            challengeId: DEVICE_CHALLENGE,
            phone: PHONE,
            purpose: 'NEW_DEVICE',
            binding: DEVICE_ID,
            verifiedAt: NOW,
            mac: randomBytes(32),
          },
          pepper,
        }),
      'IDENTITY_OTP_INVALID',
    );
  });

  it('F-ACC-001 refuse un compte créé avec le numéro d’un autre', () => {
    expectCode(
      () =>
        createAccount({
          id: ACCOUNT_ID,
          phone: PHONE,
          now: NOW,
          otpProof: proofFor(SIGNUP_CHALLENGE, 'SIGNUP', NEW_PHONE, NEW_PHONE),
          pepper,
        }),
      'IDENTITY_OTP_INVALID',
    );
  });
});

describe('Attaques identité · PIN', () => {
  it('SEC-AUTH-003 refuse les PIN faibles et un poivre absent', async () => {
    const owner = account();
    const device = deviceFor(owner);
    for (const weak of ['000000', '123456', '654321']) {
      await expect(
        createPinState({
          account: owner,
          device,
          pin: weak,
          pepper,
          now: NOW,
        }),
      ).rejects.toMatchObject({ code: 'IDENTITY_PIN_WEAK' });
    }
    await expect(
      createPinState({
        account: owner,
        device,
        pin: PIN,
        pepper: new Uint8Array(8),
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'IDENTITY_INVALID_REQUEST' });
  });

  it('SEC-AUTH-003 ne vérifie pas un PIN avec un autre poivre', async () => {
    const owner = account();
    const device = deviceFor(owner);
    const state = await pinStateFor(owner, device);
    await expect(
      verifyPinHash(state.hash, PIN, randomBytes(32)),
    ).resolves.toBe(false);
    expect(state.hash).not.toContain(PIN);
  });

  it("SEC-AUTH-003 ne contourne pas le verrouillage par un PIN correct", async () => {
    const owner = account();
    const device = deviceFor(owner);
    let state = await pinStateFor(owner, device);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await verifyPinAttempt(state, '999999', pepper, NOW);
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error('PIN erroné accepté');
      }
      state = result.state;
    }
    expect(state.lockouts).toBe(1);
    const blocked = await verifyPinAttempt(state, PIN, pepper, NOW);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) {
      throw new Error('PIN correct accepté malgré le verrouillage');
    }
    expect(blocked.code).toBe('IDENTITY_PIN_LOCKED');
    expect(blocked.state.failedAttempts).toBe(0);
  });

  it('SEC-AUTH-003 purge un verrou expiré avant le nouvel échec', async () => {
    const owner = account();
    const device = deviceFor(owner);
    const state = await pinStateFor(owner, device);
    const expired: PinState = {
      ...state,
      lockouts: 1,
      lockedUntil: '2026-10-26T09:05:00.000Z',
    };
    const result = await verifyPinAttempt(
      expired,
      '999999',
      pepper,
      '2026-10-26T09:05:01.000Z',
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Échec attendu');
    }
    expect(result.code).toBe('IDENTITY_PIN_INVALID');
    expect(result.state.failedAttempts).toBe(1);
    expect(result.state.lockedUntil).toBeNull();
  });
});

describe('Attaques identité · signature de transaction', () => {
  async function fixture(): Promise<{
    owner: Account;
    device: Device;
    state: PinState;
  }> {
    const owner = account();
    const device = deviceFor(owner);
    return { owner, device, state: await pinStateFor(owner, device) };
  }

  it('SEC-AUTH-002 refuse une signature produite par une autre clé', async () => {
    const { owner, device, state } = await fixture();
    const transaction = tx();
    await expectAsyncCode(
      authorizeTransaction({
        account: owner,
        device,
        pinState: state,
        pin: PIN,
        pepper,
        transaction,
        signature: signed(transaction, attackerKey),
        now: LATER,
      }),
      'IDENTITY_SIGNATURE_INVALID',
    );
  });

  it('SEC-AUTH-002 refuse une signature qui n’est pas un tableau d’octets', async () => {
    const { owner, device, state } = await fixture();
    const transaction = tx();
    await expectAsyncCode(
      authorizeTransaction({
        account: owner,
        device,
        pinState: state,
        pin: PIN,
        pepper,
        transaction,
        signature: 'f'.repeat(128) as unknown as Uint8Array,
        now: LATER,
      }),
      'IDENTITY_SIGNATURE_INVALID',
    );
  });

  it('SEC-AUTH-002 refuse un appareil dont l’empreinte ne correspond pas à sa clé', async () => {
    const { owner, device, state } = await fixture();
    const transaction = tx();
    await expectAsyncCode(
      authorizeTransaction({
        account: owner,
        device: { ...device, fingerprint: randomBytes(32) },
        pinState: state,
        pin: PIN,
        pepper,
        transaction,
        signature: signed(transaction),
        now: LATER,
      }),
      'IDENTITY_DEVICE_UNKNOWN',
    );
  });

  it('SEC-AUTH-002 refuse un montant modifié après signature', async () => {
    const { owner, device, state } = await fixture();
    const transaction = tx();
    await expectAsyncCode(
      authorizeTransaction({
        account: owner,
        device,
        pinState: state,
        pin: PIN,
        pepper,
        transaction: { ...transaction, amountXaf: '999999' },
        signature: signed(transaction),
        now: LATER,
      }),
      'IDENTITY_SIGNATURE_INVALID',
    );
  });

  it('SEC-AUTH-002 refuse une signature rejouée avec un autre nonce', async () => {
    const { owner, device, state } = await fixture();
    const transaction = tx();
    await expectAsyncCode(
      authorizeTransaction({
        account: owner,
        device,
        pinState: state,
        pin: PIN,
        pepper,
        transaction: {
          ...transaction,
          nonce: '019a0c2e-7b3a-7c4d-8e5f-0123456789ff',
        },
        signature: signed(transaction),
        now: LATER,
      }),
      'IDENTITY_SIGNATURE_INVALID',
    );
  });

  it('SEC-AUTH-002 refuse le rejeu d’un nonce ou d’une opération', async () => {
    const { owner, device, state } = await fixture();
    const transaction = tx();
    const signature = signed(transaction);
    await expectAsyncCode(
      authorizeTransaction({
        account: owner,
        device,
        pinState: state,
        pin: PIN,
        pepper,
        transaction,
        signature,
        now: LATER,
        seenNonces: [NONCE],
      }),
      'IDENTITY_NONCE_REUSED',
    );
    await expectAsyncCode(
      authorizeTransaction({
        account: owner,
        device,
        pinState: state,
        pin: PIN,
        pepper,
        transaction,
        signature,
        now: LATER,
        seenOperationIds: [OPERATION_ID],
      }),
      'IDENTITY_NONCE_REUSED',
    );
  });

  it('SEC-AUTH-002 refuse un appareil révoqué et un compte bloqué', async () => {
    const { owner, device, state } = await fixture();
    const transaction = tx();
    const signature = signed(transaction);
    await expectAsyncCode(
      authorizeTransaction({
        account: owner,
        device: revokeDevice(device, { now: NOW, reason: 'Vol' }),
        pinState: state,
        pin: PIN,
        pepper,
        transaction,
        signature,
        now: LATER,
      }),
      'IDENTITY_DEVICE_REVOKED',
    );
    await expectAsyncCode(
      authorizeTransaction({
        account: blockAccount(owner, {
          now: NOW,
          channel: 'USSD',
          reason: 'Vol',
        }),
        device,
        pinState: state,
        pin: PIN,
        pepper,
        transaction,
        signature,
        now: LATER,
      }),
      'IDENTITY_ACCOUNT_BLOCKED',
    );
  });

  it('SEC-AUTH-002 refuse un montant flottant, nul, hors BIGINT ou une durée excessive', () => {
    for (const amountXaf of [
      '25000.5',
      '0',
      '-1',
      '1e6',
      ' 25000',
      '9223372036854775808',
    ]) {
      expectCode(
        () => canonicalTransaction(tx({ amountXaf })),
        'IDENTITY_INVALID_REQUEST',
      );
    }
    expectCode(
      () =>
        canonicalTransaction(
          tx({
            issuedAt: NOW,
            expiresAt: '2026-10-26T09:15:00.001Z',
          }),
        ),
      'IDENTITY_INVALID_REQUEST',
    );
  });

  it('F-ACC-006 refuse une session après blocage du compte', async () => {
    const { owner, device } = await fixture();
    const issued = createSession({
      id: SESSION_ID,
      account: owner,
      device,
      now: NOW,
    });
    const blocked = blockAccount(owner, {
      now: LATER,
      channel: 'TRUSTED_DEVICE',
      reason: 'Vol',
    });
    expectCode(
      () =>
        authenticateSession({
          session: issued.session,
          accessToken: issued.accessToken,
          account: blocked,
          device,
          now: LATER,
        }),
      'IDENTITY_ACCOUNT_BLOCKED',
    );
  });
});

describe('Attaques identité · sessions', () => {
  it('SEC-AUTH-005 refuse le jeton de rafraîchissement comme jeton d’accès', () => {
    const owner = account();
    const device = deviceFor(owner);
    const issued = createSession({
      id: SESSION_ID,
      account: owner,
      device,
      now: NOW,
    });
    expectCode(
      () =>
        authenticateSession({
          session: issued.session,
          accessToken: issued.refreshToken,
          account: owner,
          device,
          now: LATER,
        }),
      'IDENTITY_SESSION_INVALID',
    );
  });

  it('SEC-AUTH-005 refuse un rafraîchissement depuis un autre appareil', () => {
    const owner = account();
    const device = deviceFor(owner);
    const issued = createSession({
      id: SESSION_ID,
      account: owner,
      device,
      now: NOW,
    });
    expectCode(
      () =>
        refreshSession({
          session: issued.session,
          refreshToken: issued.refreshToken,
          account: owner,
          device: {
            ...device,
            id: '019a0c2e-7b3a-7c4d-8e5f-0123456789ff',
          },
          now: LATER,
        }),
      'IDENTITY_SESSION_INVALID',
    );
  });

  it('SEC-AUTH-005 n’accepte pas un jeton d’accès de plus de quinze minutes', () => {
    const owner = account();
    const device = deviceFor(owner);
    expectCode(
      () =>
        createSession({
          id: SESSION_ID,
          account: owner,
          device,
          now: NOW,
          accessTtlMs: 15 * 60_000 + 1,
        }),
      'IDENTITY_INVALID_REQUEST',
    );
  });
});

describe('Attaques identité · récupération', () => {
  function strongAccount(): Account {
    return { ...account(), kycLevel: 'STRONG' };
  }

  it('SEC-AUTH-007 interdit la récupération par simple OTP ou appareil non attesté', () => {
    for (const method of ['OTP_ONLY', 'TRUSTED_DEVICE']) {
      expectCode(
        () =>
          requestRecovery({
            id: RECOVERY_ID,
            account: strongAccount(),
            newPhone: NEW_PHONE,
            method: method as never,
            balanceXaf: 0n,
            now: NOW,
          }),
        'IDENTITY_RECOVERY_FORBIDDEN',
      );
    }
  });

  it('SEC-AUTH-007 ne contourne pas le délai de vingt-quatre heures', () => {
    const owner = strongAccount();
    const recovery = requestRecovery({
      id: RECOVERY_ID,
      account: owner,
      newPhone: NEW_PHONE,
      method: 'KYC_STRONG',
      balanceXaf: 100_000n,
      now: NOW,
    });
    const proof = proofFor(
      RECOVERY_CHALLENGE,
      'RECOVERY',
      ACCOUNT_ID,
      NEW_PHONE,
      NOW,
    );
    expectCode(
      () =>
        confirmRecovery({
          recovery,
          account: owner,
          otpProof: proof,
          now: '2026-10-27T08:59:59.999Z',
          pepper,
        }),
      'IDENTITY_RECOVERY_NOT_DUE',
    );
  });

  it('SEC-AUTH-007 refuse un OTP de nouvel appareil pour finaliser la récupération', () => {
    const owner = strongAccount();
    const recovery = requestRecovery({
      id: RECOVERY_ID,
      account: owner,
      newPhone: NEW_PHONE,
      method: 'KYC_STRONG',
      balanceXaf: 0n,
      now: NOW,
    });
    expectCode(
      () =>
        confirmRecovery({
          recovery,
          account: owner,
          otpProof: proofFor(
            DEVICE_CHALLENGE,
            'NEW_DEVICE',
            DEVICE_ID,
            NEW_PHONE,
            NOW,
          ),
          now: LATER,
          pepper,
        }),
      'IDENTITY_OTP_INVALID',
    );
  });

  it('SEC-AUTH-007 refuse un KYC seulement basique', () => {
    expectCode(
      () =>
        requestRecovery({
          id: RECOVERY_ID,
          account: { ...account(), kycLevel: 'BASIC' },
          newPhone: NEW_PHONE,
          method: 'KYC_STRONG',
          balanceXaf: 0n,
          now: NOW,
        }),
      'IDENTITY_RECOVERY_FORBIDDEN',
    );
  });
});

describe('Attaques identité · audit', () => {
  it('SEC-LOG-001 n’accepte que des références non sensibles', () => {
    const event = identityAuditEvent({
      id: AUDIT_ID,
      ts: NOW,
      action: 'DEVICE_REGISTERED',
      actorId: ACCOUNT_ID,
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
      reason: 'Nouvel appareil',
    });
    expect(Object.keys(event.refs ?? {}).sort()).toEqual([
      'account_id',
      'device_id',
    ]);
    expect(JSON.stringify(event)).not.toMatch(/\+237|284917/iu);
  });

  it('SEC-LOG-001 refuse un motif qui recopie un numéro ou un OTP', () => {
    for (const reason of ['Numéro +237612345678', 'OTP 123456 refusé']) {
      expectCode(
        () =>
          identityAuditEvent({
            id: AUDIT_ID,
            ts: NOW,
            action: 'OTP_FAILED',
            actorId: ACCOUNT_ID,
            accountId: ACCOUNT_ID,
            reason,
          }),
        'IDENTITY_INVALID_REQUEST',
      );
    }
  });

  it('SEC-LOG-001 refuse un identifiant d’audit mal formé', () => {
    expectCode(
      () =>
        identityAuditEvent({
          id: 'not-a-uuid',
          ts: NOW,
          action: 'OTP_ISSUED',
          actorId: ACCOUNT_ID,
          accountId: ACCOUNT_ID,
        }),
      'IDENTITY_INVALID_REQUEST',
    );
  });
});
