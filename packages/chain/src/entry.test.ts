import { describe, expect, it } from 'vitest';
import { ChainError } from './errors';
import {
  canonicalEntryContent,
  computeEntryHash,
  genesisPrevHash,
  verifyEntryHash,
  type EntryContent,
  type EntryPosting,
} from './entry';

const ENTRY_ID = '019a0000-0000-7000-8000-0000000000a1';
const ORIGINAL_ID = '019a0000-0000-7000-8000-0000000000b1';
const ACCOUNT_TREASURY = '019a0000-0000-7000-8000-000000001100';
const ACCOUNT_SUSPENSE = '019a0000-0000-7000-8000-000000002900';
const PREV_HASH = Buffer.alloc(32, 0x11);
const TS = '2026-10-26T09:00:00.000Z';

const P1: EntryPosting = {
  accountId: ACCOUNT_TREASURY,
  direction: 'D',
  amountXaf: 10_000n,
  ordinal: 1,
};
const P2: EntryPosting = {
  accountId: ACCOUNT_SUSPENSE,
  direction: 'C',
  amountXaf: 7_500n,
  ordinal: 2,
};
const P3: EntryPosting = {
  accountId: ACCOUNT_SUSPENSE,
  direction: 'C',
  amountXaf: 2_500n,
  ordinal: 3,
};

const POSTINGS: readonly EntryPosting[] = [P1, P2, P3];

function entry(overrides: Partial<EntryContent> = {}): EntryContent {
  return {
    seq: 2,
    id: ENTRY_ID,
    ts: TS,
    type: 'PAYMENT_CONFIRMED',
    refs: { payment_id: 'pay-001', plan_id: 'plan-001' },
    postings: POSTINGS,
    actor: 'user-maker',
    approvers: ['user-z', 'user-a'],
    idemScope: 'payments',
    idemKey: 'pay-001:confirm',
    reversesEntryId: null,
    ...overrides,
  };
}

function expectChainError(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ChainError);
    expect((error as ChainError).code).toBe(code);
    return;
  }
  expect.unreachable('une ChainError était attendue');
}

describe('INT-HASH-001 — contenu canonique des écritures', () => {
  it('INT-HASH-001 produit un contenu canonique stable', () => {
    const expected =
      '{"actor":"user-maker","approvers":["user-a","user-z"],' +
      `"id":"${ENTRY_ID}",` +
      '"idem_key":"pay-001:confirm","idem_scope":"payments",' +
      `"postings":[{"account_id":"${ACCOUNT_TREASURY}","amount_xaf":"10000","direction":"D","ordinal":1},` +
      `{"account_id":"${ACCOUNT_SUSPENSE}","amount_xaf":"7500","direction":"C","ordinal":2},` +
      `{"account_id":"${ACCOUNT_SUSPENSE}","amount_xaf":"2500","direction":"C","ordinal":3}],` +
      '"refs":{"payment_id":"pay-001","plan_id":"plan-001"},' +
      '"reverses_entry_id":null,"seq":2,"ts":"2026-10-26T09:00:00.000Z","type":"PAYMENT_CONFIRMED"}';
    expect(canonicalEntryContent(entry())).toBe(expected);
  });

  it('INT-HASH-001 est indépendant de l’ordre des lignes et des approbateurs', () => {
    const reordered = entry({
      postings: [P3, P1, P2],
      approvers: ['user-a', 'user-z'],
    });
    expect(canonicalEntryContent(reordered)).toBe(
      canonicalEntryContent(entry()),
    );
    expect(computeEntryHash(PREV_HASH, reordered).equals(
      computeEntryHash(PREV_HASH, entry()),
    )).toBe(true);
  });

  it('INT-HASH-001 couvre le lien de contre-passation', () => {
    const reversal = entry({
      type: 'PAYMENT_REVERSED',
      reversesEntryId: ORIGINAL_ID,
    });
    expect(canonicalEntryContent(reversal)).toContain(
      `"reverses_entry_id":"${ORIGINAL_ID}"`,
    );
    expect(computeEntryHash(PREV_HASH, reversal).equals(
      computeEntryHash(PREV_HASH, entry()),
    )).toBe(false);
  });

  it('INT-HASH-001 couvre la portée d’idempotence', () => {
    const otherScope = entry({ idemScope: 'settlements' });
    expect(computeEntryHash(PREV_HASH, otherScope).equals(
      computeEntryHash(PREV_HASH, entry()),
    )).toBe(false);
  });

  it('INT-HASH-001 lie l’empreinte à prev_hash', () => {
    const otherPrev = Buffer.alloc(32, 0x22);
    expect(computeEntryHash(otherPrev, entry()).equals(
      computeEntryHash(PREV_HASH, entry()),
    )).toBe(false);
  });

  it('INT-HASH-001 détecte une altération de ligne', () => {
    const altered = entry({
      postings: POSTINGS.map((posting, index) =>
        index === 0 ? { ...posting, amountXaf: 9_999n } : posting,
      ),
    });
    expect(computeEntryHash(PREV_HASH, altered).equals(
      computeEntryHash(PREV_HASH, entry()),
    )).toBe(false);
  });

  it('INT-HASH-001 vérifie une empreinte correcte et refuse une autre', () => {
    const hash = computeEntryHash(PREV_HASH, entry());
    expect(verifyEntryHash(PREV_HASH, entry(), hash)).toBe(true);
    expect(
      verifyEntryHash(PREV_HASH, entry(), Buffer.alloc(32, 0x33)),
    ).toBe(false);
    expect(
      verifyEntryHash(PREV_HASH, entry(), Buffer.alloc(31)),
    ).toBe(false);
  });

  it('INT-HASH-003 accepte une genèse sans ligne', () => {
    const genesis = entry({
      seq: 1,
      type: 'GENESIS',
      refs: { params_hash: 'parametres-v1', signing_key: 'cle-publique-v1' },
      postings: [],
      approvers: [],
      idemScope: 'system',
      idemKey: 'genesis',
    });
    expect(() => canonicalEntryContent(genesis)).not.toThrow();
    expect(computeEntryHash(genesisPrevHash(), genesis)).toHaveLength(32);
  });

  it('INT-HASH-001 refuse une écriture ordinaire sans ligne', () => {
    expectChainError(
      () => canonicalEntryContent(entry({ postings: [] })),
      'CHAIN_INVALID_CONTENT',
    );
  });

  it('INT-HASH-001 refuse une écriture à une seule ligne', () => {
    expectChainError(
      () => canonicalEntryContent(entry({ postings: [P1] })),
      'CHAIN_INVALID_CONTENT',
    );
  });

  it('INT-HASH-001 refuse des ordinales dupliqués', () => {
    expectChainError(
      () =>
        canonicalEntryContent(
          entry({
            postings: [
              P1,
              { ...P2, ordinal: 1 },
            ],
          }),
        ),
      'CHAIN_INVALID_CONTENT',
    );
  });

  it('INT-HASH-001 refuse un montant non strictement positif', () => {
    expectChainError(
      () =>
        canonicalEntryContent(
          entry({
            postings: [
              { ...P1, amountXaf: 0n },
              P2,
            ],
          }),
        ),
      'CHAIN_INVALID_CONTENT',
    );
  });

  it('INT-HASH-001 refuse un horodatage non canonique', () => {
    expectChainError(
      () => canonicalEntryContent(entry({ ts: '2026-10-26T09:00:00Z' })),
      'CHAIN_INVALID_CONTENT',
    );
    expectChainError(
      () => canonicalEntryContent(entry({ ts: '2026-02-30T09:00:00.000Z' })),
      'CHAIN_INVALID_CONTENT',
    );
  });

  it('INT-LED-007 refuse un identifiant non UUID v7', () => {
    expectChainError(
      () => canonicalEntryContent(entry({ id: 'not-a-uuid' })),
      'CHAIN_INVALID_CONTENT',
    );
  });

  it('INT-HASH-001 refuse un approbateur dupliqué', () => {
    expectChainError(
      () =>
        canonicalEntryContent(entry({ approvers: ['user-a', 'user-a'] })),
      'CHAIN_INVALID_CONTENT',
    );
  });

  it('INT-HASH-001 refuse un prev_hash de mauvaise taille', () => {
    expectChainError(
      () => computeEntryHash(Buffer.alloc(31), entry()),
      'CHAIN_INVALID_HASH',
    );
  });

  it('INT-HASH-001 produit une empreinte de référence (or) stable', () => {
    expect(computeEntryHash(PREV_HASH, entry()).toString('hex')).toBe(
      '3580c95b95218108e0d3efe04a70128c5e1a7b0536ec08802162f6b3c6184bc9',
    );
  });
});
