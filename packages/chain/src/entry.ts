import { createHash, timingSafeEqual } from 'node:crypto';
import { ChainError } from './errors';
import { canonicalize, type JsonValue } from './jcs';
import {
  assertIsoUtcMs,
  assertNonEmpty,
  assertPositiveSafeInteger,
  assertUuidV7,
} from './validation';

export type PostingDirection = 'D' | 'C';

export type EntryPosting = {
  readonly accountId: string;
  readonly direction: PostingDirection;
  readonly amountXaf: bigint;
  readonly ordinal: number;
};

export type EntryContent = {
  readonly seq: number;
  readonly id: string;
  readonly ts: string;
  readonly type: string;
  readonly refs: Readonly<Record<string, JsonValue>>;
  readonly postings: readonly EntryPosting[];
  readonly actor: string;
  readonly approvers: readonly string[];
  readonly idemScope: string;
  readonly idemKey: string;
  readonly reversesEntryId: string | null;
};

const HASH_LENGTH = 32;

export function genesisPrevHash(): Buffer {
  return Buffer.alloc(HASH_LENGTH);
}

/**
 * Contenu canonique d'une écriture. Couvre tous les champs immuables, y
 * compris la portée d'idempotence et le lien de contre-passation : un
 * administrateur de la base ne peut pas les modifier sans rompre la chaîne.
 * Les lignes sont triées par `ordinal` et les approbateurs par ordre
 * lexicographique UTF-16 (sémantique d'ensemble).
 */
export function canonicalEntryContent(content: EntryContent): string {
  if (!Number.isSafeInteger(content.seq) || content.seq < 1) {
    throw new ChainError(
      'CHAIN_INVALID_CONTENT',
      'seq doit être un entier sûr >= 1',
    );
  }
  assertUuidV7(content.id, 'id');
  assertIsoUtcMs(content.ts, 'ts');
  assertNonEmpty(content.type, 'type');
  assertNonEmpty(content.actor, 'actor');
  assertNonEmpty(content.idemScope, 'idemScope');
  assertNonEmpty(content.idemKey, 'idemKey');
  if (
    typeof content.refs !== 'object' ||
    content.refs === null ||
    Array.isArray(content.refs)
  ) {
    throw new ChainError(
      'CHAIN_INVALID_CONTENT',
      'refs doit être un objet JSON',
    );
  }
  if (
    content.reversesEntryId !== null &&
    typeof content.reversesEntryId !== 'string'
  ) {
    throw new ChainError(
      'CHAIN_INVALID_CONTENT',
      'reversesEntryId doit être null ou un UUID v7',
    );
  }
  if (content.reversesEntryId !== null) {
    assertUuidV7(content.reversesEntryId, 'reversesEntryId');
  }

  const postings = [...content.postings];
  if (postings.length === 1) {
    throw new ChainError(
      'CHAIN_INVALID_CONTENT',
      'Une écriture exige zéro (genèse) ou au moins deux lignes',
    );
  }
  if (postings.length === 0 && content.type !== 'GENESIS') {
    throw new ChainError(
      'CHAIN_INVALID_CONTENT',
      'Seule la genèse peut ne porter aucune ligne',
    );
  }

  const ordinals = new Set<number>();
  for (const posting of postings) {
    assertUuidV7(posting.accountId, 'accountId');
    if (posting.direction !== 'D' && posting.direction !== 'C') {
      throw new ChainError(
        'CHAIN_INVALID_CONTENT',
        'direction doit valoir D ou C',
      );
    }
    if (typeof posting.amountXaf !== 'bigint' || posting.amountXaf <= 0n) {
      throw new ChainError(
        'CHAIN_INVALID_CONTENT',
        'amountXaf doit être un bigint strictement positif',
      );
    }
    assertPositiveSafeInteger(posting.ordinal, 'ordinal');
    if (ordinals.has(posting.ordinal)) {
      throw new ChainError(
        'CHAIN_INVALID_CONTENT',
        `ordinal dupliqué: ${posting.ordinal.toString()}`,
      );
    }
    ordinals.add(posting.ordinal);
  }
  postings.sort((left, right) => left.ordinal - right.ordinal);

  const approvers = new Set<string>();
  for (const approver of content.approvers) {
    assertNonEmpty(approver, 'approver');
    if (approvers.has(approver)) {
      throw new ChainError(
        'CHAIN_INVALID_CONTENT',
        'Approbateur dupliqué',
      );
    }
    approvers.add(approver);
  }

  const canonical = {
    actor: content.actor,
    approvers: [...approvers].sort(),
    id: content.id,
    idem_key: content.idemKey,
    idem_scope: content.idemScope,
    postings: postings.map((posting) => ({
      account_id: posting.accountId,
      amount_xaf: posting.amountXaf.toString(),
      direction: posting.direction,
      ordinal: posting.ordinal,
    })),
    refs: content.refs,
    reverses_entry_id: content.reversesEntryId,
    seq: content.seq,
    ts: content.ts,
    type: content.type,
  };

  return canonicalize(canonical);
}

export function computeEntryHash(
  prevHash: Uint8Array,
  content: EntryContent,
): Buffer {
  const previous = toHash(prevHash, 'prevHash');
  const canonical = canonicalEntryContent(content);
  return createHash('sha256')
    .update(previous)
    .update(canonical, 'utf8')
    .digest();
}

export function verifyEntryHash(
  prevHash: Uint8Array,
  content: EntryContent,
  expected: Uint8Array,
): boolean {
  const computed = computeEntryHash(prevHash, content);
  const candidate = Buffer.from(expected);
  if (candidate.length !== HASH_LENGTH) {
    return false;
  }
  return timingSafeEqual(computed, candidate);
}

function toHash(value: Uint8Array, field: string): Buffer {
  const hash = Buffer.from(value);
  if (hash.length !== HASH_LENGTH) {
    throw new ChainError(
      'CHAIN_INVALID_HASH',
      `${field} doit faire 32 octets (reçu ${hash.length.toString()})`,
    );
  }
  return hash;
}
