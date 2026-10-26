import { ChainError } from './errors';
import { merkleTreeHash } from './merkle';

export type BatchEntry = {
  readonly seq: number;
  readonly entryHash: Uint8Array;
};

export type Batch = {
  readonly fromSeq: number;
  readonly toSeq: number;
  readonly treeSize: number;
  readonly rootHash: Buffer;
  readonly entryHashes: readonly Buffer[];
};

/**
 * Lot d'écritures contiguës. L'ordonnancement horaire/quotidien
 * (INT-ANC-001) est du ressort de l'exploitation ; cette fonction refuse
 * tout lot vide, non contigu ou contenant une empreinte invalide.
 */
export function buildBatch(entries: readonly BatchEntry[]): Batch {
  if (entries.length === 0) {
    throw new ChainError(
      'MERKLE_INVALID_ARGUMENT',
      'Un lot ne peut pas être vide',
    );
  }
  const first = entries[0];
  if (first === undefined) {
    throw new ChainError('MERKLE_INVALID_ARGUMENT', 'Lot vide');
  }
  if (!Number.isSafeInteger(first.seq) || first.seq < 1) {
    throw new ChainError(
      'MERKLE_INVALID_ARGUMENT',
      'Première séquence invalide',
    );
  }

  const hashes: Buffer[] = [];
  let expected = first.seq;
  for (const entry of entries) {
    if (entry.seq !== expected) {
      throw new ChainError(
        'MERKLE_INVALID_ARGUMENT',
        `Séquence non contiguë: attendu ${expected.toString()}, reçu ${entry.seq.toString()}`,
      );
    }
    const hash = Buffer.from(entry.entryHash);
    if (hash.length !== 32) {
      throw new ChainError(
        'MERKLE_INVALID_ARGUMENT',
        `Empreinte de taille invalide pour la séquence ${entry.seq.toString()}`,
      );
    }
    hashes.push(hash);
    expected += 1;
  }

  return Object.freeze({
    fromSeq: first.seq,
    toSeq: expected - 1,
    treeSize: hashes.length,
    rootHash: merkleTreeHash(hashes),
    entryHashes: Object.freeze(hashes),
  });
}
