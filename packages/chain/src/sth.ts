import { sign, verify, type KeyObject } from 'node:crypto';
import { ChainError } from './errors';
import { canonicalize } from './jcs';
import { ISO_UTC_MS_PATTERN } from './validation';

export type TreeHead = {
  readonly treeSize: number;
  readonly rootHash: string;
  readonly timestamp: string;
  readonly logId: string;
};

export type SignedTreeHead = {
  readonly head: TreeHead;
  readonly algorithm: 'Ed25519';
  readonly signature: string;
};

const ROOT_HASH_PATTERN = /^[0-9a-fA-F]{64}$/;
const ED25519_SIGNATURE_BYTES = 64;

export function signTreeHead(
  head: TreeHead,
  privateKey: KeyObject,
): SignedTreeHead {
  const normalized = normalizeTreeHead(head);
  const payload = Buffer.from(canonicalTreeHead(normalized), 'utf8');
  const signature = sign(null, payload, privateKey).toString('base64');
  return {
    algorithm: 'Ed25519',
    head: normalized,
    signature,
  };
}

export function verifySignedTreeHead(
  signed: SignedTreeHead,
  publicKey: KeyObject,
): boolean {
  try {
    if (signed.algorithm !== 'Ed25519') {
      return false;
    }
    const signature = Buffer.from(signed.signature, 'base64');
    if (signature.length !== ED25519_SIGNATURE_BYTES) {
      return false;
    }
    const payload = Buffer.from(
      canonicalTreeHead(normalizeTreeHead(signed.head)),
      'utf8',
    );
    return verify(null, payload, publicKey, signature);
  } catch {
    return false;
  }
}

export function canonicalTreeHead(head: TreeHead): string {
  const normalized = normalizeTreeHead(head);
  return canonicalize({
    algorithm: 'Ed25519',
    log_id: normalized.logId,
    root_hash: normalized.rootHash,
    timestamp: normalized.timestamp,
    tree_size: normalized.treeSize,
  });
}

function normalizeTreeHead(head: TreeHead): TreeHead {
  if (!Number.isSafeInteger(head.treeSize) || head.treeSize < 0) {
    throw new ChainError(
      'STH_INVALID',
      'treeSize doit être un entier sûr >= 0',
    );
  }
  if (!ROOT_HASH_PATTERN.test(head.rootHash)) {
    throw new ChainError(
      'STH_INVALID',
      'rootHash doit être une empreinte SHA-256 hexadécimale',
    );
  }
  if (
    !ISO_UTC_MS_PATTERN.test(head.timestamp) ||
    Number.isNaN(new Date(head.timestamp).getTime()) ||
    new Date(head.timestamp).toISOString() !== head.timestamp
  ) {
    throw new ChainError(
      'STH_INVALID',
      'timestamp doit être ISO 8601 UTC avec millisecondes',
    );
  }
  if (typeof head.logId !== 'string' || head.logId.trim().length === 0) {
    throw new ChainError('STH_INVALID', 'logId ne doit pas être vide');
  }
  return {
    treeSize: head.treeSize,
    rootHash: head.rootHash.toLowerCase(),
    timestamp: head.timestamp,
    logId: head.logId,
  };
}
