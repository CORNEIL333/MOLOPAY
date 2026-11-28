import { describe, expect, it } from 'vitest';
import { BusinessError } from '@achat/contracts';
import { xaf } from '@achat/money';
import {
  assertEntryDraft,
  assertReversalMirrors,
  buildReversalPostings,
  isUuidV7,
  sumPostings,
  uuidv7,
  type EntryDraft,
  type JsonValue,
  type PostingDraft,
} from './domain';

const ACCOUNT_TREASURY = '019a0000-0000-7000-8000-000000001100';
const ACCOUNT_SUSPENSE = '019a0000-0000-7000-8000-000000002900';
const ACCOUNT_PARTNER = '019a0000-0000-7000-8000-000000002100';
const ENTRY_ID = '019a0000-0000-7000-8000-0000000000a1';
const ORIGINAL_ID = '019a0000-0000-7000-8000-0000000000b1';

const balancedPostings: readonly PostingDraft[] = [
  { accountId: ACCOUNT_TREASURY, direction: 'DEBIT', amount: xaf(10_000n) },
  { accountId: ACCOUNT_SUSPENSE, direction: 'CREDIT', amount: xaf(7_500n) },
  { accountId: ACCOUNT_PARTNER, direction: 'CREDIT', amount: xaf(2_500n) },
];

function validEntry(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return {
    id: ENTRY_ID,
    operationType: 'PAYMENT_CONFIRMED',
    businessRefs: { payment_id: 'pay_001', plan_id: 'plan_001' },
    actorId: 'user_maker',
    approvers: ['user_checker'],
    idemScope: 'payments',
    idemKey: 'pay_001:confirm',
    postings: balancedPostings,
    ...overrides,
  };
}

function expectBusinessError(
  action: () => void,
  code: string,
  message?: RegExp,
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessError);
    const businessError = error as BusinessError;
    expect(businessError.code).toBe(code);
    if (message !== undefined) {
      expect(businessError.message).toMatch(message);
    }
    return;
  }
  expect.unreachable('une BusinessError était attendue');
}

describe('uuidv7', () => {
  it('génère un identifiant version 7 et variante RFC 4122', () => {
    const id = uuidv7(1_767_225_600_000);
    expect(isUuidV7(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('encode l’horodatage milliseconde dans les 48 premiers bits', () => {
    const now = 1_767_225_600_123;
    const hex = uuidv7(now).replaceAll('-', '');
    expect(BigInt(`0x${hex.slice(0, 12)}`)).toBe(BigInt(now));
  });

  it('refuse un horodatage non entier', () => {
    expectBusinessError(
      () => uuidv7(1.5),
      'LEDGER_INVALID_DRAFT',
      /Horodatage/,
    );
  });

  it('refuse un identifiant qui n’est pas de version 7', () => {
    expect(isUuidV7('019a0000-0000-4000-8000-0000000000a1')).toBe(false);
    expect(isUuidV7('019a0000-0000-7000-c000-0000000000a1')).toBe(false);
  });
});

describe('assertEntryDraft', () => {
  it('INT-LED-001 accepte une écriture équilibrée en partie double', () => {
    expect(() => assertEntryDraft(validEntry())).not.toThrow();
  });

  it('INT-LED-001 refuse Σ débits ≠ Σ crédits', () => {
    expectBusinessError(
      () =>
        assertEntryDraft(
          validEntry({
            postings: [
              {
                accountId: ACCOUNT_TREASURY,
                direction: 'DEBIT',
                amount: xaf(10_000n),
              },
              {
                accountId: ACCOUNT_SUSPENSE,
                direction: 'CREDIT',
                amount: xaf(9_999n),
              },
            ],
          }),
        ),
      'LEDGER_UNBALANCED',
    );
  });

  it('INT-LED-001 refuse une écriture non GENESIS sans ligne', () => {
    expectBusinessError(
      () => assertEntryDraft(validEntry({ postings: [] })),
      'LEDGER_INVALID_DRAFT',
    );
  });

  it('INT-HASH-003 accepte une genèse sans ligne', () => {
    expect(() =>
      assertEntryDraft(
        validEntry({ operationType: 'GENESIS', businessRefs: { params_hash: 'abc' }, postings: [] }),
      ),
    ).not.toThrow();
  });

  it('INT-LED-001 refuse une écriture à une seule ligne', () => {
    expectBusinessError(
      () =>
        assertEntryDraft(
          validEntry({
            postings: [
              {
                accountId: ACCOUNT_TREASURY,
                direction: 'DEBIT',
                amount: xaf(10_000n),
              },
            ],
          }),
        ),
      'LEDGER_INVALID_DRAFT',
    );
  });

  it('NF-FUN-001 refuse un montant nul ou négatif', () => {
    expectBusinessError(
      () =>
        assertEntryDraft(
          validEntry({
            postings: [
              {
                accountId: ACCOUNT_TREASURY,
                direction: 'DEBIT',
                amount: xaf(0n),
              },
              {
                accountId: ACCOUNT_SUSPENSE,
                direction: 'CREDIT',
                amount: xaf(0n),
              },
            ],
          }),
        ),
      'INVALID_AMOUNT',
    );
  });

  it('INT-LED-001 refuse deux lignes identiques (compte, sens)', () => {
    expectBusinessError(
      () =>
        assertEntryDraft(
          validEntry({
            postings: [
              {
                accountId: ACCOUNT_TREASURY,
                direction: 'DEBIT',
                amount: xaf(1_000n),
              },
              {
                accountId: ACCOUNT_TREASURY,
                direction: 'DEBIT',
                amount: xaf(1_000n),
              },
              {
                accountId: ACCOUNT_SUSPENSE,
                direction: 'CREDIT',
                amount: xaf(2_000n),
              },
            ],
          }),
        ),
      'LEDGER_INVALID_DRAFT',
    );
  });

  it('INT-LED-007 refuse un identifiant d’écriture non UUID v7', () => {
    expectBusinessError(
      () => assertEntryDraft(validEntry({ id: 'not-a-uuid' })),
      'LEDGER_INVALID_DRAFT',
    );
  });

  it('INT-LED-007 refuse un compte non UUID v7', () => {
    expectBusinessError(
      () =>
        assertEntryDraft(
          validEntry({
            postings: [
              {
                accountId: '1100',
                direction: 'DEBIT',
                amount: xaf(1_000n),
              },
              {
                accountId: ACCOUNT_SUSPENSE,
                direction: 'CREDIT',
                amount: xaf(1_000n),
              },
            ],
          }),
        ),
      'LEDGER_INVALID_DRAFT',
    );
  });

  it('INT-LED-007 refuse un champ obligatoire vide', () => {
    expectBusinessError(
      () => assertEntryDraft(validEntry({ operationType: '   ' })),
      'LEDGER_INVALID_DRAFT',
    );
  });

  it('INT-LED-007 refuse un approbateur dupliqué', () => {
    expectBusinessError(
      () => assertEntryDraft(validEntry({ approvers: ['user_a', 'user_a'] })),
      'LEDGER_INVALID_DRAFT',
    );
  });

  it('INT-LED-007 refuse un nombre dans les références métier (pas de flottant)', () => {
    const businessRefs = { amount: 12.5 } as unknown as Readonly<
      Record<string, JsonValue>
    >;
    expectBusinessError(
      () => assertEntryDraft(validEntry({ businessRefs })),
      'LEDGER_INVALID_DRAFT',
    );
  });

  it('INT-LED-007 refuse des références métier trop profondes', () => {
    let nested: JsonValue = 'feuille';
    for (let depth = 0; depth < 10; depth += 1) {
      nested = { niveau: nested };
    }
    expectBusinessError(
      () => assertEntryDraft(validEntry({ businessRefs: { racine: nested } })),
      'LEDGER_INVALID_DRAFT',
      /profondes/,
    );
  });
});

describe('contre-passation', () => {
  const reversal = (
    overrides: Partial<EntryDraft> = {},
  ): EntryDraft =>
    validEntry({
      id: '019a0000-0000-7000-8000-0000000000a2',
      operationType: 'REVERSAL',
      reversesEntryId: ORIGINAL_ID,
      postings: buildReversalPostings(balancedPostings),
      ...overrides,
    });

  it('INT-LED-004 inverse chaque ligne sans changer les montants', () => {
    const postings = buildReversalPostings(balancedPostings);
    expect(postings).toHaveLength(balancedPostings.length);
    expect(() =>
      assertReversalMirrors(balancedPostings, postings),
    ).not.toThrow();
    expect(postings[0]).toEqual({
      accountId: ACCOUNT_TREASURY,
      direction: 'CREDIT',
      amount: xaf(10_000n),
    });
  });

  it('INT-LED-004 refuse un miroir dont un montant diffère', () => {
    const postings = buildReversalPostings(balancedPostings);
    const altered = postings.map((posting, index) =>
      index === 0 ? { ...posting, amount: xaf(9_999n) } : posting,
    );
    expectBusinessError(
      () => assertReversalMirrors(balancedPostings, altered),
      'LEDGER_REVERSAL_INVALID',
    );
  });

  it('INT-LED-004 refuse un miroir au nombre de lignes différent', () => {
    expectBusinessError(
      () =>
        assertReversalMirrors(balancedPostings, [
          {
            accountId: ACCOUNT_TREASURY,
            direction: 'CREDIT',
            amount: xaf(10_000n),
          },
        ]),
      'LEDGER_REVERSAL_INVALID',
    );
  });

  it('INT-LED-004 refuse une auto-contre-passation', () => {
    expectBusinessError(
      () => assertEntryDraft(reversal({ reversesEntryId: reversal().id })),
      'LEDGER_REVERSAL_INVALID',
    );
  });

  it('SEC-AUTHZ-003 refuse une contre-passation approuvée par le seul acteur', () => {
    expectBusinessError(
      () => assertEntryDraft(reversal({ approvers: ['user_maker'] })),
      'MAKER_CANNOT_APPROVE',
    );
  });

  it('SEC-AUTHZ-003 refuse une contre-passation sans approbateur', () => {
    expectBusinessError(
      () => assertEntryDraft(reversal({ approvers: [] })),
      'MAKER_CANNOT_APPROVE',
    );
  });

  it('SEC-AUTHZ-003 accepte une contre-passation approuvée par un tiers', () => {
    expect(() => assertEntryDraft(reversal())).not.toThrow();
  });
});

describe('sumPostings', () => {
  it('INT-LED-001 totalise débits et crédits séparément', () => {
    const totals = sumPostings(balancedPostings);
    expect(totals.debit).toEqual(xaf(10_000n));
    expect(totals.credit).toEqual(xaf(10_000n));
  });

  it('INT-LED-001 retourne zéro pour une liste vide', () => {
    expect(sumPostings([])).toEqual({ debit: xaf(0n), credit: xaf(0n) });
  });
});
