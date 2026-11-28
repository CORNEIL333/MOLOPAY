import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ChainError } from './errors';
import { canonicalTreeHead, type TreeHead } from './sth';
import {
  DEFAULT_TSA_URL,
  parseTimeStampToken,
  timestampTreeHead,
  type TimeStampResult,
} from './tsa';

const HEAD: TreeHead = {
  treeSize: 7,
  rootHash: 'ab'.repeat(32),
  timestamp: '2026-10-26T09:00:00.000Z',
  logId: 'molopay-ledger-test',
};

function expectTimestampError(action: () => unknown): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ChainError);
    expect((error as ChainError).code).toBe('TIMESTAMP_INVALID');
    return;
  }
  expect.unreachable('une ChainError TIMESTAMP_INVALID était attendue');
}

describe('INT-ANC-003 — autorité d’horodatage réelle', () => {
  let stamp: TimeStampResult;

  beforeAll(async () => {
    const stamped = await timestampTreeHead(HEAD, {
      url: process.env['TSA_URL'] ?? DEFAULT_TSA_URL,
      timeoutMs: 30_000,
    });
    stamp = stamped.timestamp;
  });

  it('INT-ANC-003 obtient et vérifie un jeton signé par la TSA', () => {
    expect(stamp.genTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(stamp.policyOid.length).toBeGreaterThan(0);
    expect(stamp.serialNumber.length).toBeGreaterThan(0);
    expect(stamp.tsaCertificateSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stamp.tokenDer.length).toBeGreaterThan(0);
  });

  it('INT-ANC-003 horodate l’empreinte exacte de la tête canonique', () => {
    const expected = createHash('sha256')
      .update(canonicalTreeHead(HEAD), 'utf8')
      .digest();
    expect(stamp.hashedMessage.equals(expected)).toBe(true);
    expect(stamp.hashedMessage.length).toBe(32);
  });

  it('INT-ANC-003 refuse une empreinte différente sur le jeton réel', () => {
    const wrong = Buffer.from(stamp.hashedMessage);
    wrong[0] = (wrong[0] ?? 0) ^ 0x01;
    expectTimestampError(() =>
      parseTimeStampToken(stamp.tokenDer, {
        hashedMessage: wrong,
        nonce: stamp.nonce,
      }),
    );
  });

  it('INT-ANC-003 refuse un nonce différent sur le jeton réel', () => {
    expectTimestampError(() =>
      parseTimeStampToken(stamp.tokenDer, {
        hashedMessage: stamp.hashedMessage,
        nonce: stamp.nonce + 1n,
      }),
    );
  });

  it('INT-ANC-003 détecte un jeton altéré', () => {
    const tampered = Buffer.from(stamp.tokenDer);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0x01;
    expectTimestampError(() =>
      parseTimeStampToken(tampered, {
        hashedMessage: stamp.hashedMessage,
        nonce: stamp.nonce,
      }),
    );
  });
});
