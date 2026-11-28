import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ChainError } from './errors';
import {
  consistencyProof,
  emptyTreeHash,
  inclusionProof,
  leafHash,
  merkleTreeHash,
  nodeHash,
  verifyConsistency,
  verifyInclusion,
} from './merkle';

const PROPERTY_RUNS = Number(process.env['CHAIN_PROPERTY_RUNS'] ?? 2_000);

function sha256(data: Uint8Array): Buffer {
  return createHash('sha256').update(data).digest();
}

function referenceLeaf(data: Uint8Array): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(data)]));
}

function referenceNode(left: Uint8Array, right: Uint8Array): Buffer {
  return sha256(
    Buffer.concat([Buffer.from([0x01]), Buffer.from(left), Buffer.from(right)]),
  );
}

function leavesOf(count: number): Buffer[] {
  return Array.from({ length: count }, (_, index) =>
    Buffer.from(`feuille-${index.toString()}`),
  );
}

describe('INT-ANC-001 — arbre de Merkle RFC 6962/9162', () => {
  it('INT-ANC-001 racine d’un arbre vide = SHA-256()', () => {
    expect(merkleTreeHash([]).equals(emptyTreeHash())).toBe(true);
    expect(emptyTreeHash().toString('hex')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('INT-ANC-001 racine à une feuille = SHA-256(0x00 || feuille)', () => {
    const leaves = leavesOf(1);
    expect(merkleTreeHash(leaves).equals(referenceLeaf(leaves[0] as Buffer))).toBe(
      true,
    );
    expect(leafHash(leaves[0] as Buffer).equals(
      referenceLeaf(leaves[0] as Buffer),
    )).toBe(true);
  });

  it('INT-ANC-001 racine à deux feuilles = nœud des deux feuilles', () => {
    const leaves = leavesOf(2);
    const expected = referenceNode(
      referenceLeaf(leaves[0] as Buffer),
      referenceLeaf(leaves[1] as Buffer),
    );
    expect(merkleTreeHash(leaves).equals(expected)).toBe(true);
    expect(
      nodeHash(
        referenceLeaf(leaves[0] as Buffer),
        referenceLeaf(leaves[1] as Buffer),
      ).equals(expected),
    ).toBe(true);
  });

  it('INT-ANC-001 racine à trois feuilles = nœud(nœud(f0,f1), f2)', () => {
    const leaves = leavesOf(3);
    const left = referenceNode(
      referenceLeaf(leaves[0] as Buffer),
      referenceLeaf(leaves[1] as Buffer),
    );
    const expected = referenceNode(left, referenceLeaf(leaves[2] as Buffer));
    expect(merkleTreeHash(leaves).equals(expected)).toBe(true);
  });

  it('INT-ANC-001 racine à sept feuilles conforme à l’exemple RFC 9162', () => {
    const leaves = leavesOf(7);
    const leaf = (index: number): Buffer =>
      referenceLeaf(leaves[index] as Buffer);
    const node = referenceNode;
    const g = node(leaf(0), leaf(1));
    const h = node(leaf(2), leaf(3));
    const i = node(leaf(4), leaf(5));
    const j = leaf(6);
    const k = node(g, h);
    const l = node(i, j);
    expect(merkleTreeHash(leaves).equals(node(k, l))).toBe(true);
  });

  it('INT-ANC-005 vérifie les preuves d’inclusion de l’exemple RFC 9162', () => {
    const leaves = leavesOf(7);
    const root = merkleTreeHash(leaves);
    for (const index of [0, 3, 4, 6]) {
      const proof = inclusionProof(leaves, index);
      expect(
        verifyInclusion(leaves[index] as Buffer, index, 7, proof, root),
      ).toBe(true);
    }
    expect(inclusionProof(leaves, 0)).toHaveLength(3);
    expect(inclusionProof(leaves, 3)).toHaveLength(3);
    expect(inclusionProof(leaves, 4)).toHaveLength(3);
    expect(inclusionProof(leaves, 6)).toHaveLength(2);
  });

  it('INT-ANC-005 vérifie toutes les preuves d’inclusion de 1 à 16 feuilles', () => {
    for (let size = 1; size <= 16; size += 1) {
      const leaves = leavesOf(size);
      const root = merkleTreeHash(leaves);
      for (let index = 0; index < size; index += 1) {
        const proof = inclusionProof(leaves, index);
        expect(
          verifyInclusion(leaves[index] as Buffer, index, size, proof, root),
          `taille=${size.toString()} index=${index.toString()}`,
        ).toBe(true);
      }
    }
  });

  it('INT-ANC-005 refuse une preuve d’inclusion altérée', () => {
    const leaves = leavesOf(5);
    const root = merkleTreeHash(leaves);
    const proof = inclusionProof(leaves, 2);
    const tampered = proof.map((element, index) =>
      index === 0 ? Buffer.alloc(32, 0x44) : element,
    );
    expect(
      verifyInclusion(leaves[2] as Buffer, 2, 5, tampered, root),
    ).toBe(false);
  });

  it('INT-ANC-005 refuse un index ou une racine incorrects', () => {
    const leaves = leavesOf(4);
    const root = merkleTreeHash(leaves);
    const proof = inclusionProof(leaves, 1);
    expect(
      verifyInclusion(leaves[1] as Buffer, 2, 4, proof, root),
    ).toBe(false);
    expect(
      verifyInclusion(leaves[1] as Buffer, 1, 4, proof, Buffer.alloc(32)),
    ).toBe(false);
    expect(
      verifyInclusion(leaves[1] as Buffer, 4, 4, proof, root),
    ).toBe(false);
  });

  it('INT-ANC-005 vérifie toutes les preuves de cohérence de 1 à 16 feuilles', () => {
    for (let second = 1; second <= 16; second += 1) {
      const leaves = leavesOf(second);
      const secondRoot = merkleTreeHash(leaves);
      for (let first = 1; first < second; first += 1) {
        const firstRoot = merkleTreeHash(leaves.slice(0, first));
        const proof = consistencyProof(leaves, first, second);
        expect(
          verifyConsistency(first, second, proof, firstRoot, secondRoot),
          `m=${first.toString()} n=${second.toString()}`,
        ).toBe(true);
      }
    }
  });

  it('INT-ANC-005 vérifie la preuve de cohérence [3, 7] de l’exemple RFC 9162', () => {
    const leaves = leavesOf(7);
    const proof = consistencyProof(leaves, 3, 7);
    expect(proof).toHaveLength(4);
    expect(
      verifyConsistency(
        3,
        7,
        proof,
        merkleTreeHash(leaves.slice(0, 3)),
        merkleTreeHash(leaves),
      ),
    ).toBe(true);
    expect(
      verifyConsistency(
        1,
        7,
        consistencyProof(leaves, 1, 7),
        merkleTreeHash(leaves.slice(0, 1)),
        merkleTreeHash(leaves),
      ),
    ).toBe(true);
  });

  it('INT-ANC-005 refuse une preuve de cohérence altérée', () => {
    const leaves = leavesOf(7);
    const proof = consistencyProof(leaves, 3, 7);
    const tampered = proof.map((element, index) =>
      index === 1 ? Buffer.alloc(32, 0x55) : element,
    );
    expect(
      verifyConsistency(
        3,
        7,
        tampered,
        merkleTreeHash(leaves.slice(0, 3)),
        merkleTreeHash(leaves),
      ),
    ).toBe(false);
  });

  it('INT-ANC-005 refuse des tailles de cohérence incohérentes', () => {
    const leaves = leavesOf(4);
    expect(
      verifyConsistency(
        3,
        2,
        consistencyProof(leaves, 2, 3),
        merkleTreeHash(leaves.slice(0, 3)),
        merkleTreeHash(leaves.slice(0, 2)),
      ),
    ).toBe(false);
    expect(
      verifyConsistency(
        2,
        2,
        [],
        merkleTreeHash(leaves.slice(0, 2)),
        merkleTreeHash(leaves.slice(0, 2)),
      ),
    ).toBe(true);
    expect(
      verifyConsistency(
        2,
        2,
        [Buffer.alloc(32)],
        merkleTreeHash(leaves.slice(0, 2)),
        merkleTreeHash(leaves.slice(0, 2)),
      ),
    ).toBe(false);
  });

  it('INT-ANC-001 refuse des arguments de preuve invalides', () => {
    const leaves = leavesOf(2);
    expectChainError(() => inclusionProof([], 0));
    expectChainError(() => inclusionProof(leaves, 2));
    expectChainError(() => inclusionProof(leaves, -1));
    expectChainError(() => consistencyProof(leaves, 0, 2));
    expectChainError(() => consistencyProof(leaves, 2, 3));
    expectChainError(() => consistencyProof(leaves, 1, 0));
  });

  it('INT-ANC-001 toutes les preuves d’inclusion vérifient (propriété)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uint8Array({ minLength: 1, maxLength: 40 }), {
          minLength: 1,
          maxLength: 24,
        }),
        fc.nat(),
        (leaves, rawIndex) => {
          const index = rawIndex % leaves.length;
          const root = merkleTreeHash(leaves);
          const proof = inclusionProof(leaves, index);
          return verifyInclusion(
            leaves[index] as Uint8Array,
            index,
            leaves.length,
            proof,
            root,
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('INT-ANC-001 toutes les preuves de cohérence vérifient (propriété)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uint8Array({ minLength: 1, maxLength: 40 }), {
          minLength: 2,
          maxLength: 20,
        }),
        fc.nat(),
        (leaves, rawFirst) => {
          const first = 1 + (rawFirst % (leaves.length - 1));
          const second = leaves.length;
          const proof = consistencyProof(leaves, first, second);
          return verifyConsistency(
            first,
            second,
            proof,
            merkleTreeHash(leaves.slice(0, first)),
            merkleTreeHash(leaves),
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});

function expectChainError(action: () => unknown): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ChainError);
    return;
  }
  expect.unreachable('une ChainError était attendue');
}
