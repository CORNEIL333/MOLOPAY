import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { derInteger, derSequence } from './der';
import { ChainError } from './errors';
import {
  buildTimeStampRequest,
  generateTimeStampNonce,
  parseTimeStampResponse,
  parseTimeStampToken,
} from './tsa';

const OPENSSL_DATA = 'molopay-tree-head-probe';
const OPENSSL_HASH =
  '975428b1fc750427a84411510b2b60eab49512fd6364c649efdabcf39d2c0d24';
const OPENSSL_NONCE = 0x639ed6714e6d25d4n;
const OPENSSL_REQUEST =
  '30430201013031300d060960864801650304020105000420975428b1fc750427a84411510b2b60eab49512fd6364c649efdabcf39d2c0d240208639ed6714e6d25d40101ff';

function expectTimestampError(action: () => unknown, message?: RegExp): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ChainError);
    expect((error as ChainError).code).toBe('TIMESTAMP_INVALID');
    if (message !== undefined) {
      expect((error as ChainError).message).toMatch(message);
    }
    return;
  }
  expect.unreachable('une ChainError TIMESTAMP_INVALID était attendue');
}

const EXPECTED = {
  hashedMessage: Buffer.from(OPENSSL_HASH, 'hex'),
  nonce: OPENSSL_NONCE,
};

describe('INT-ANC-003 — requête RFC 3161', () => {
  it('INT-ANC-003 produit exactement la requête de référence OpenSSL', () => {
    expect(createHash('sha256').update(OPENSSL_DATA).digest('hex')).toBe(
      OPENSSL_HASH,
    );
    expect(
      buildTimeStampRequest(
        Buffer.from(OPENSSL_HASH, 'hex'),
        OPENSSL_NONCE,
      ).toString('hex'),
    ).toBe(OPENSSL_REQUEST);
  });

  it('INT-ANC-003 refuse une empreinte qui n’est pas SHA-256', () => {
    expectTimestampError(() =>
      buildTimeStampRequest(Buffer.alloc(31), OPENSSL_NONCE),
    );
  });

  it('INT-ANC-003 refuse un nonce nul ou négatif', () => {
    expectTimestampError(() =>
      buildTimeStampRequest(Buffer.alloc(32), 0n),
    );
    expectTimestampError(() =>
      buildTimeStampRequest(Buffer.alloc(32), -1n),
    );
  });

  it('INT-ANC-003 génère des nonces 128 bits distincts', () => {
    const first = generateTimeStampNonce();
    const second = generateTimeStampNonce();
    expect(first).toBeGreaterThan(0n);
    expect(second).toBeGreaterThan(0n);
    expect(first).not.toBe(second);
  });
});

describe('INT-ANC-003 — rejet des réponses RFC 3161 invalides', () => {
  it('INT-ANC-003 refuse un DER tronqué', () => {
    expectTimestampError(() =>
      parseTimeStampResponse(Buffer.from([0x30, 0x03, 0x02]), EXPECTED),
    );
  });

  it('INT-ANC-003 refuse un statut non accordé', () => {
    const refused = derSequence([derSequence([derInteger(2n)])]);
    expectTimestampError(
      () => parseTimeStampResponse(refused, EXPECTED),
      /refusé/,
    );
  });

  it('INT-ANC-003 refuse une réponse accordée sans jeton', () => {
    const withoutToken = derSequence([derSequence([derInteger(0n)])]);
    expectTimestampError(
      () => parseTimeStampResponse(withoutToken, EXPECTED),
      /TimeStampToken absent/,
    );
  });

  it('INT-ANC-003 refuse un jeton CMS vide', () => {
    expectTimestampError(() =>
      parseTimeStampToken(derSequence([]), EXPECTED),
    );
  });
});
