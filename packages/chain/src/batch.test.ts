import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildBatch, type BatchEntry } from './batch';
import { ChainError } from './errors';
import { merkleTreeHash } from './merkle';

function entry(seq: number, seed: number): BatchEntry {
  return {
    seq,
    entryHash: createHash('sha256').update(`entree-${seed.toString()}`).digest(),
  };
}

describe('INT-ANC-001 — lots contigus', () => {
  it('INT-ANC-001 construit la racine d’un lot contigu', () => {
    const entries = [entry(10, 1), entry(11, 2), entry(12, 3)];
    const batch = buildBatch(entries);
    expect(batch.fromSeq).toBe(10);
    expect(batch.toSeq).toBe(12);
    expect(batch.treeSize).toBe(3);
    expect(
      batch.rootHash.equals(
        merkleTreeHash(entries.map((item) => item.entryHash)),
      ),
    ).toBe(true);
    expect(batch.entryHashes).toHaveLength(3);
  });

  it('INT-ANC-001 refuse un lot vide', () => {
    expect(() => buildBatch([])).toThrowError(ChainError);
  });

  it('INT-ANC-001 refuse une séquence trouée', () => {
    expect(() => buildBatch([entry(1, 1), entry(3, 3)])).toThrowError(
      /Séquence non contiguë/,
    );
  });

  it('INT-ANC-001 refuse une séquence désordonnée', () => {
    expect(() => buildBatch([entry(2, 2), entry(1, 1)])).toThrowError(
      /Séquence non contiguë/,
    );
  });

  it('INT-ANC-001 refuse une empreinte de taille invalide', () => {
    expect(() =>
      buildBatch([{ seq: 1, entryHash: Buffer.alloc(31) }]),
    ).toThrowError(/Empreinte de taille invalide/);
  });
});
