import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import { verifyAssertion, verifyRegistration, type RelyingParty } from './webauthn';

/**
 * Authentificateur logiciel construit selon WebAuthn niveau 2 (W3C) pour
 * éprouver le vérificateur : vraies clés, vrais octets, aucune réponse figée.
 */
const RP: RelyingParty = { rpId: 'backoffice.molopay.test', origins: new Set(['https://backoffice.molopay.test']) };
const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

function b64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function clientData(type: 'webauthn.create' | 'webauthn.get', challenge: Buffer, origin = 'https://backoffice.molopay.test', extra: object = {}): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge: b64url(challenge), origin, crossOrigin: false, ...extra }), 'utf8');
}

function authData(options: { rpId?: string | undefined; flags: number; signCount: number; credentialId?: Buffer }): Buffer {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(options.signCount);
  const parts: Buffer[] = [createHash('sha256').update(options.rpId ?? RP.rpId).digest(), Buffer.from([options.flags]), counter];
  if (options.credentialId !== undefined) {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(options.credentialId.length);
    // AAGUID nul (attestation « none ») puis identifiant ; la clé COSE suit (non lue : clé SPKI fournie à part).
    parts.push(Buffer.alloc(16), length, options.credentialId, Buffer.from([0xa0]));
  }
  return Buffer.concat(parts);
}

type Authenticator = { readonly privateKey: KeyObject; readonly spki: Buffer; readonly credentialId: Buffer; readonly hash: string | null };

function authenticator(kind: 'P-256' | 'Ed25519'): Authenticator {
  const pair = kind === 'P-256' ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' }) : generateKeyPairSync('ed25519');
  return { privateKey: pair.privateKey, spki: pair.publicKey.export({ type: 'spki', format: 'der' }), credentialId: randomBytes(32), hash: kind === 'P-256' ? 'sha256' : null };
}

function assertion(
  device: Authenticator,
  challenge: Buffer,
  options: { flags?: number; signCount?: number; origin?: string; type?: 'webauthn.get' | 'webauthn.create'; rpId?: string; extra?: object } = {},
): { clientDataJSON: Buffer; authenticatorData: Buffer; signature: Buffer } {
  const clientDataJSON = clientData(options.type ?? 'webauthn.get', challenge, options.origin, options.extra);
  const authenticatorData = authData({ rpId: options.rpId, flags: options.flags ?? UP | UV, signCount: options.signCount ?? 1 });
  const signed = Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]);
  return { clientDataJSON, authenticatorData, signature: sign(device.hash, signed, device.privateKey) };
}

function refuses(action: () => unknown): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BusinessError);
  expect((caught as BusinessError).code).toBe('STAFF_AUTH_INVALID');
}

describe('SEC-AUTH-004 inscription d’une clé WebAuthn', () => {
  for (const kind of ['P-256', 'Ed25519'] as const) {
    it(`accepte une inscription ${kind} conforme (UP, UV, AT, identifiant présent)`, () => {
      const device = authenticator(kind);
      const challenge = randomBytes(32);
      const registered = verifyRegistration({
        rp: RP,
        expectedChallenge: challenge,
        clientDataJSON: clientData('webauthn.create', challenge),
        authenticatorData: authData({ flags: UP | UV | AT, signCount: 0, credentialId: device.credentialId }),
        credentialId: device.credentialId,
        publicKeySpki: device.spki,
      });
      expect(registered).toEqual({ credentialId: device.credentialId, publicKeySpki: device.spki, algorithm: kind === 'P-256' ? 'ES256' : 'EdDSA', signCount: 0 });
    });
  }

  it('refuse un identifiant de clé absent des données d’authentificateur, sans UV, ou une clé RSA', () => {
    const device = authenticator('P-256');
    const challenge = randomBytes(32);
    const base = {
      rp: RP,
      expectedChallenge: challenge,
      clientDataJSON: clientData('webauthn.create', challenge),
      authenticatorData: authData({ flags: UP | UV | AT, signCount: 0, credentialId: device.credentialId }),
      credentialId: device.credentialId,
      publicKeySpki: device.spki,
    };
    refuses(() => verifyRegistration({ ...base, credentialId: randomBytes(32) }));
    refuses(() => verifyRegistration({ ...base, authenticatorData: authData({ flags: UP | AT, signCount: 0, credentialId: device.credentialId }) }));
    refuses(() => verifyRegistration({ ...base, clientDataJSON: clientData('webauthn.get', challenge) }));
    // Données de clé présentes mais drapeau AT absent : refus.
    refuses(() => verifyRegistration({ ...base, authenticatorData: authData({ flags: UP | UV, signCount: 0, credentialId: device.credentialId }) }));
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' });
    refuses(() => verifyRegistration({ ...base, publicKeySpki: rsa }));
  });
});

describe('SEC-AUTH-004 assertion WebAuthn (connexion)', () => {
  for (const kind of ['P-256', 'Ed25519'] as const) {
    it(`accepte une assertion ${kind} signée sur authData ‖ SHA-256(clientDataJSON) et renvoie le compteur`, () => {
      const device = authenticator(kind);
      const challenge = randomBytes(32);
      const result = verifyAssertion({ rp: RP, expectedChallenge: challenge, credential: { publicKeySpki: device.spki, signCount: 4 }, ...assertion(device, challenge, { signCount: 5 }) });
      expect(result).toEqual({ signCount: 5 });
    });
  }

  it('refuse : autre défi, autre origine, autre RP ID, mauvais type, sans UV, sans UP', () => {
    const device = authenticator('P-256');
    const challenge = randomBytes(32);
    const credential = { publicKeySpki: device.spki, signCount: 0 };
    refuses(() => verifyAssertion({ rp: RP, expectedChallenge: randomBytes(32), credential, ...assertion(device, challenge) }));
    refuses(() => verifyAssertion({ rp: RP, expectedChallenge: challenge, credential, ...assertion(device, challenge, { origin: 'https://hameconnage.example' }) }));
    refuses(() => verifyAssertion({ rp: RP, expectedChallenge: challenge, credential, ...assertion(device, challenge, { rpId: 'hameconnage.example' }) }));
    refuses(() => verifyAssertion({ rp: RP, expectedChallenge: challenge, credential, ...assertion(device, challenge, { type: 'webauthn.create' }) }));
    refuses(() => verifyAssertion({ rp: RP, expectedChallenge: challenge, credential, ...assertion(device, challenge, { flags: UP }) }));
    refuses(() => verifyAssertion({ rp: RP, expectedChallenge: challenge, credential, ...assertion(device, challenge, { flags: UV }) }));
  });

  it('refuse une signature d’une autre clé ou une donnée altérée après signature', () => {
    const device = authenticator('Ed25519');
    const other = authenticator('Ed25519');
    const challenge = randomBytes(32);
    const signed = assertion(device, challenge);
    refuses(() => verifyAssertion({ rp: RP, expectedChallenge: challenge, credential: { publicKeySpki: other.spki, signCount: 0 }, ...signed }));
    const tampered = Buffer.from(signed.authenticatorData);
    tampered.writeUInt32BE(99, 33);
    refuses(() => verifyAssertion({ rp: RP, expectedChallenge: challenge, credential: { publicKeySpki: device.spki, signCount: 0 }, ...signed, authenticatorData: tampered }));
  });

  it('clonage : un compteur qui ne croît pas est refusé ; deux compteurs nuls sont admis (authentificateur sans compteur)', () => {
    const device = authenticator('P-256');
    const challenge = randomBytes(32);
    refuses(() => verifyAssertion({ rp: RP, expectedChallenge: challenge, credential: { publicKeySpki: device.spki, signCount: 7 }, ...assertion(device, challenge, { signCount: 7 }) }));
    refuses(() => verifyAssertion({ rp: RP, expectedChallenge: challenge, credential: { publicKeySpki: device.spki, signCount: 7 }, ...assertion(device, challenge, { signCount: 0 }) }));
    expect(verifyAssertion({ rp: RP, expectedChallenge: challenge, credential: { publicKeySpki: device.spki, signCount: 0 }, ...assertion(device, challenge, { signCount: 0 }) })).toEqual({ signCount: 0 });
  });

  it('refuse un défi trop court, un clientDataJSON non JSON ou cross-origin, des données d’authentificateur tronquées', () => {
    const device = authenticator('P-256');
    const short = randomBytes(8);
    refuses(() => verifyAssertion({ rp: RP, expectedChallenge: short, credential: { publicKeySpki: device.spki, signCount: 0 }, ...assertion(device, short) }));
    const challenge = randomBytes(32);
    const signed = assertion(device, challenge);
    refuses(() => verifyAssertion({ rp: RP, expectedChallenge: challenge, credential: { publicKeySpki: device.spki, signCount: 0 }, ...signed, clientDataJSON: Buffer.from('pas du json') }));
    // Assertion correctement signée mais déclarée inter-origines : refusée pour ce seul motif.
    refuses(() =>
      verifyAssertion({
        rp: RP,
        expectedChallenge: challenge,
        credential: { publicKeySpki: device.spki, signCount: 0 },
        ...assertion(device, challenge, { extra: { crossOrigin: true } }),
      }),
    );
    refuses(() => verifyAssertion({ rp: RP, expectedChallenge: challenge, credential: { publicKeySpki: device.spki, signCount: 0 }, ...signed, authenticatorData: signed.authenticatorData.subarray(0, 36) }));
  });
});
