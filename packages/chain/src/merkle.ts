import { createHash } from 'node:crypto';
import { ChainError } from './errors';

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);
const HASH_LENGTH = 32;

export function emptyTreeHash(): Buffer {
  return createHash('sha256').digest();
}

export function leafHash(data: Uint8Array): Buffer {
  return createHash('sha256')
    .update(LEAF_PREFIX)
    .update(Buffer.from(data))
    .digest();
}

export function nodeHash(left: Uint8Array, right: Uint8Array): Buffer {
  const leftHash = toHash(left, 'left');
  const rightHash = toHash(right, 'right');
  return createHash('sha256')
    .update(NODE_PREFIX)
    .update(leftHash)
    .update(rightHash)
    .digest();
}

/** Merkle Tree Hash RFC 6962/9162 sur les données brutes des feuilles. */
export function merkleTreeHash(leaves: readonly Uint8Array[]): Buffer {
  if (leaves.length === 0) {
    return emptyTreeHash();
  }
  return treeHash(leaves);
}

function treeHash(leaves: readonly Uint8Array[]): Buffer {
  if (leaves.length === 1) {
    const only = leaves[0];
    if (only === undefined) {
      throw new ChainError('MERKLE_INVALID_ARGUMENT', 'Feuille absente');
    }
    return leafHash(only);
  }
  const split = largestPowerOfTwoBelow(leaves.length);
  return nodeHash(
    treeHash(leaves.slice(0, split)),
    treeHash(leaves.slice(split)),
  );
}

export function inclusionProof(
  leaves: readonly Uint8Array[],
  index: number,
): Buffer[] {
  if (leaves.length === 0) {
    throw new ChainError(
      'MERKLE_INVALID_ARGUMENT',
      'Un arbre vide n’a pas de preuve d’inclusion',
    );
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= leaves.length) {
    throw new ChainError(
      'MERKLE_INVALID_ARGUMENT',
      `Index d’inclusion hors bornes: ${index.toString()}`,
    );
  }
  return inclusionPath(index, leaves);
}

function inclusionPath(
  index: number,
  leaves: readonly Uint8Array[],
): Buffer[] {
  if (leaves.length === 1) {
    return [];
  }
  const split = largestPowerOfTwoBelow(leaves.length);
  if (index < split) {
    return [
      ...inclusionPath(index, leaves.slice(0, split)),
      treeHash(leaves.slice(split)),
    ];
  }
  return [
    ...inclusionPath(index - split, leaves.slice(split)),
    treeHash(leaves.slice(0, split)),
  ];
}

/** Vérification RFC 9162 §2.1.3.2. */
export function verifyInclusion(
  leaf: Uint8Array,
  index: number,
  treeSize: number,
  proof: readonly Uint8Array[],
  root: Uint8Array,
): boolean {
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(treeSize) ||
    index < 0 ||
    treeSize < 1 ||
    index >= treeSize
  ) {
    return false;
  }
  let fn = index;
  let sn = treeSize - 1;
  let computed = leafHash(leaf);
  for (const raw of proof) {
    if (sn === 0 || raw.length !== HASH_LENGTH) {
      return false;
    }
    const node = Buffer.from(raw);
    if ((fn & 1) === 1 || fn === sn) {
      computed = nodeHash(node, computed);
      if ((fn & 1) === 0) {
        while (fn !== 0 && (fn & 1) === 0) {
          fn >>>= 1;
          sn >>>= 1;
        }
      }
    } else {
      computed = nodeHash(computed, node);
    }
    fn >>>= 1;
    sn >>>= 1;
  }
  if (sn !== 0) {
    return false;
  }
  return computed.equals(Buffer.from(root));
}

export function consistencyProof(
  leaves: readonly Uint8Array[],
  firstSize: number,
  secondSize: number,
): Buffer[] {
  if (
    !Number.isSafeInteger(firstSize) ||
    !Number.isSafeInteger(secondSize) ||
    firstSize < 1 ||
    firstSize > secondSize ||
    secondSize > leaves.length
  ) {
    throw new ChainError(
      'MERKLE_INVALID_ARGUMENT',
      'Tailles de preuve de cohérence invalides',
    );
  }
  if (firstSize === secondSize) {
    return [];
  }
  return subproof(firstSize, leaves.slice(0, secondSize), true);
}

function subproof(
  firstSize: number,
  leaves: readonly Uint8Array[],
  complete: boolean,
): Buffer[] {
  if (firstSize === leaves.length) {
    return complete ? [] : [treeHash(leaves)];
  }
  const split = largestPowerOfTwoBelow(leaves.length);
  if (firstSize <= split) {
    return [
      ...subproof(firstSize, leaves.slice(0, split), complete),
      treeHash(leaves.slice(split)),
    ];
  }
  return [
    ...subproof(firstSize - split, leaves.slice(split), false),
    treeHash(leaves.slice(0, split)),
  ];
}

/** Vérification RFC 9162 §2.1.4.2. */
export function verifyConsistency(
  firstSize: number,
  secondSize: number,
  proof: readonly Uint8Array[],
  firstRoot: Uint8Array,
  secondRoot: Uint8Array,
): boolean {
  if (
    !Number.isSafeInteger(firstSize) ||
    !Number.isSafeInteger(secondSize) ||
    firstSize < 1 ||
    firstSize > secondSize
  ) {
    return false;
  }
  const expectedFirst = Buffer.from(firstRoot);
  const expectedSecond = Buffer.from(secondRoot);
  if (
    expectedFirst.length !== HASH_LENGTH ||
    expectedSecond.length !== HASH_LENGTH
  ) {
    return false;
  }
  if (firstSize === secondSize) {
    return proof.length === 0 && expectedFirst.equals(expectedSecond);
  }
  if (proof.length === 0) {
    return false;
  }
  for (const element of proof) {
    if (element.length !== HASH_LENGTH) {
      return false;
    }
  }

  const path: Buffer[] = proof.map((element) => Buffer.from(element));
  if (isPowerOfTwo(firstSize)) {
    path.unshift(expectedFirst);
  }
  let fn = firstSize - 1;
  let sn = secondSize - 1;
  while ((fn & 1) === 1) {
    fn >>>= 1;
    sn >>>= 1;
  }

  const firstElement = path[0];
  if (firstElement === undefined) {
    return false;
  }
  let fr = firstElement;
  let sr = firstElement;
  for (let index = 1; index < path.length; index += 1) {
    const current = path[index];
    if (current === undefined || sn === 0) {
      return false;
    }
    if ((fn & 1) === 1 || fn === sn) {
      fr = nodeHash(current, fr);
      sr = nodeHash(current, sr);
      if ((fn & 1) === 0) {
        while (fn !== 0 && (fn & 1) === 0) {
          fn >>>= 1;
          sn >>>= 1;
        }
      }
    } else {
      sr = nodeHash(sr, current);
    }
    fn >>>= 1;
    sn >>>= 1;
  }
  return fr.equals(expectedFirst) && sr.equals(expectedSecond) && sn === 0;
}

export function largestPowerOfTwoBelow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 2) {
    throw new ChainError(
      'MERKLE_INVALID_ARGUMENT',
      'La taille doit être un entier >= 2',
    );
  }
  let power = 1;
  while (power * 2 < value) {
    power *= 2;
  }
  return power;
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function toHash(value: Uint8Array, field: string): Buffer {
  const hash = Buffer.from(value);
  if (hash.length !== HASH_LENGTH) {
    throw new ChainError(
      'MERKLE_INVALID_ARGUMENT',
      `${field} doit faire 32 octets (reçu ${hash.length.toString()})`,
    );
  }
  return hash;
}
