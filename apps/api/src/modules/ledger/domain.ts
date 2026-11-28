import { randomBytes } from 'node:crypto';
import {
  BusinessError,
  type ErrorCode,
} from '@achat/contracts';
import { type Money } from '@achat/money';

export type Direction = 'DEBIT' | 'CREDIT';

export type JsonValue =
  | string
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type PostingDraft = {
  readonly accountId: string;
  readonly direction: Direction;
  readonly amount: Money;
};

export type EntryDraft = {
  readonly id: string;
  readonly operationType: string;
  readonly businessRefs: Readonly<Record<string, JsonValue>>;
  readonly actorId: string;
  readonly approvers: readonly string[];
  readonly idemScope: string;
  readonly idemKey: string;
  readonly reversesEntryId?: string;
  readonly postings: readonly PostingDraft[];
};

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function uuidv7(now: number = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new BusinessError('LEDGER_INVALID_DRAFT', 'Horodatage UUID invalide');
  }
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

function fail(code: ErrorCode, message: string): never {
  throw new BusinessError(code, message);
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('LEDGER_INVALID_DRAFT', `${field} ne doit pas être vide`);
  }
}

function assertJsonValue(value: unknown, depth: number): void {
  if (depth > 8) {
    fail('LEDGER_INVALID_DRAFT', 'Références métier trop profondes');
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonValue(item, depth + 1);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assertNonEmpty(key, 'Clé de référence métier');
      assertJsonValue(item, depth + 1);
    }
    return;
  }
  fail(
    'LEDGER_INVALID_DRAFT',
    'Les références métier n’acceptent que chaînes, booléens, null, tableaux et objets (pas de nombre flottant)',
  );
}

export function assertEntryDraft(draft: EntryDraft): void {
  if (!isUuidV7(draft.id)) {
    fail('LEDGER_INVALID_DRAFT', 'id d’écriture doit être un UUID v7');
  }
  assertNonEmpty(draft.operationType, 'operationType');
  assertNonEmpty(draft.actorId, 'actorId');
  assertNonEmpty(draft.idemScope, 'idemScope');
  assertNonEmpty(draft.idemKey, 'idemKey');

  for (const [key, value] of Object.entries(draft.businessRefs)) {
    assertNonEmpty(key, 'Clé de référence métier');
    assertJsonValue(value, 0);
  }

  const approvers = new Set<string>();
  for (const approver of draft.approvers) {
    assertNonEmpty(approver, 'approver');
    if (approvers.has(approver)) {
      fail('LEDGER_INVALID_DRAFT', 'Approbateur dupliqué');
    }
    approvers.add(approver);
  }

  if (draft.reversesEntryId !== undefined) {
    if (!isUuidV7(draft.reversesEntryId)) {
      fail('LEDGER_INVALID_DRAFT', 'reversesEntryId doit être un UUID v7');
    }
    if (draft.reversesEntryId === draft.id) {
      fail('LEDGER_REVERSAL_INVALID', 'Une écriture ne peut se contre-passer elle-même');
    }
    if (!draft.approvers.some((approver) => approver !== draft.actorId)) {
      fail(
        'MAKER_CANNOT_APPROVE',
        'Une contre-passation exige un approbateur distinct de l’acteur',
      );
    }
  }

  const isGenesis = draft.operationType === 'GENESIS';
  if (draft.postings.length === 0) {
    if (!isGenesis) {
      fail(
        'LEDGER_INVALID_DRAFT',
        'Une écriture non GENESIS exige au moins deux lignes',
      );
    }
    return;
  }
  if (draft.postings.length < 2) {
    fail(
      'LEDGER_INVALID_DRAFT',
      'Une écriture exige au moins deux lignes',
    );
  }

  const seen = new Set<string>();
  for (const posting of draft.postings) {
    if (!isUuidV7(posting.accountId)) {
      fail('LEDGER_INVALID_DRAFT', 'accountId doit être un UUID v7');
    }
    if (posting.amount.currency !== 'XAF') {
      fail('CURRENCY_MISMATCH', 'Devise non supportée');
    }
    if (posting.amount.amount <= 0n) {
      fail('INVALID_AMOUNT', 'Un montant de ligne doit être strictement positif');
    }
    const key = `${posting.accountId}|${posting.direction}`;
    if (seen.has(key)) {
      fail(
        'LEDGER_INVALID_DRAFT',
        'Deux lignes identiques pour le même compte et le même sens',
      );
    }
    seen.add(key);
  }

  const totals = sumPostings(draft.postings);
  if (totals.debit.amount !== totals.credit.amount) {
    fail('LEDGER_UNBALANCED', 'Σ débits ≠ Σ crédits');
  }
}

export type PostingTotals = {
  readonly debit: Money;
  readonly credit: Money;
};

export function sumPostings(postings: readonly PostingDraft[]): PostingTotals {
  let debit = 0n;
  let credit = 0n;
  for (const posting of postings) {
    if (posting.amount.currency !== 'XAF') {
      fail('CURRENCY_MISMATCH', 'Devise non supportée');
    }
    if (posting.direction === 'DEBIT') {
      debit += posting.amount.amount;
    } else {
      credit += posting.amount.amount;
    }
  }
  return {
    debit: { currency: 'XAF', amount: debit },
    credit: { currency: 'XAF', amount: credit },
  };
}

export function buildReversalPostings(
  postings: readonly PostingDraft[],
): PostingDraft[] {
  return postings.map((posting) => ({
    accountId: posting.accountId,
    direction: posting.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
    amount: posting.amount,
  }));
}

export function assertReversalMirrors(
  original: readonly PostingDraft[],
  reversal: readonly PostingDraft[],
): void {
  if (original.length !== reversal.length) {
    fail('LEDGER_REVERSAL_INVALID', 'Nombre de lignes différent');
  }
  const expected = new Set(
    original.map(
      (posting) =>
        `${posting.accountId}|${posting.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT'}|${posting.amount.amount.toString()}`,
    ),
  );
  for (const posting of reversal) {
    const key = `${posting.accountId}|${posting.direction}|${posting.amount.amount.toString()}`;
    if (!expected.delete(key)) {
      fail(
        'LEDGER_REVERSAL_INVALID',
        'Les lignes ne sont pas le miroir exact de l’original',
      );
    }
  }
  if (expected.size !== 0) {
    fail(
      'LEDGER_REVERSAL_INVALID',
      'Les lignes ne sont pas le miroir exact de l’original',
    );
  }
}
