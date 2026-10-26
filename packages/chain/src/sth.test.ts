import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalTreeHead, signTreeHead, verifySignedTreeHead, type TreeHead } from './sth';

const TIMESTAMP = '2026-10-26T10:00:00.000Z';

function keyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey };
}

const HEAD: TreeHead = {
  treeSize: 3,
  rootHash:
    'ab'.repeat(32),
  timestamp: TIMESTAMP,
  logId: 'achat-ledger-v1',
};

describe('INT-ANC-002 — tête d’arbre signée Ed25519', () => {
  it('INT-ANC-002 signe et vérifie une tête', () => {
    const { privateKey, publicKey } = keyPair();
    const signed = signTreeHead(HEAD, privateKey);
    expect(signed.algorithm).toBe('Ed25519');
    expect(Buffer.from(signed.signature, 'base64')).toHaveLength(64);
    expect(verifySignedTreeHead(signed, publicKey)).toBe(true);
  });

  it('INT-ANC-002 signe de façon déterministe', () => {
    const { privateKey } = keyPair();
    expect(signTreeHead(HEAD, privateKey).signature).toBe(
      signTreeHead(HEAD, privateKey).signature,
    );
  });

  it('INT-ANC-002 refuse une tête altérée', () => {
    const { privateKey, publicKey } = keyPair();
    const signed = signTreeHead(HEAD, privateKey);
    const alteredSizes = [
      { ...signed, head: { ...signed.head, treeSize: 4 } },
      { ...signed, head: { ...signed.head, rootHash: 'cd'.repeat(32) } },
      { ...signed, head: { ...signed.head, timestamp: '2026-10-26T10:00:01.000Z' } },
      { ...signed, head: { ...signed.head, logId: 'autre-journal' } },
    ];
    for (const altered of alteredSizes) {
      expect(verifySignedTreeHead(altered, publicKey)).toBe(false);
    }
  });

  it('INT-ANC-002 refuse une signature produite par une autre clé', () => {
    const first = keyPair();
    const second = keyPair();
    const signed = signTreeHead(HEAD, first.privateKey);
    expect(verifySignedTreeHead(signed, second.publicKey)).toBe(false);
  });

  it('INT-ANC-002 refuse une signature tronquée ou un algorithme inconnu', () => {
    const { privateKey, publicKey } = keyPair();
    const signed = signTreeHead(HEAD, privateKey);
    expect(
      verifySignedTreeHead(
        { ...signed, signature: signed.signature.slice(0, 20) },
        publicKey,
      ),
    ).toBe(false);
    expect(
      verifySignedTreeHead(
        { ...signed, algorithm: 'RSA' as unknown as 'Ed25519' },
        publicKey,
      ),
    ).toBe(false);
  });

  it('INT-ANC-002 normalise la racine en minuscules', () => {
    const { privateKey, publicKey } = keyPair();
    const upper: TreeHead = { ...HEAD, rootHash: 'AB'.repeat(32) };
    const signed = signTreeHead(upper, privateKey);
    expect(signed.head.rootHash).toBe('ab'.repeat(32));
    expect(verifySignedTreeHead(signed, publicKey)).toBe(true);
  });

  it('INT-ANC-002 produit un contenu canonique couvrant tous les champs', () => {
    expect(canonicalTreeHead(HEAD)).toBe(
      `{"algorithm":"Ed25519","log_id":"achat-ledger-v1","root_hash":"${'ab'.repeat(32)}","timestamp":"${TIMESTAMP}","tree_size":3}`,
    );
  });

  it('INT-ANC-002 refuse une tête mal formée', () => {
    const { privateKey } = keyPair();
    expect(() =>
      signTreeHead({ ...HEAD, rootHash: 'xyz' }, privateKey),
    ).toThrowError(/rootHash/);
    expect(() =>
      signTreeHead({ ...HEAD, timestamp: '2026-10-26T10:00:00Z' }, privateKey),
    ).toThrowError(/timestamp/);
    expect(() =>
      signTreeHead({ ...HEAD, treeSize: -1 }, privateKey),
    ).toThrowError(/treeSize/);
    expect(() =>
      signTreeHead({ ...HEAD, logId: ' ' }, privateKey),
    ).toThrowError(/logId/);
  });
});
