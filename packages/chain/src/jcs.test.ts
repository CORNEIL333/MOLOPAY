import { describe, expect, it } from 'vitest';
import { ChainError } from './errors';
import { canonicalize, type JsonValue } from './jcs';

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

describe('JCS RFC 8785 — sous-ensemble grand livre', () => {
  it('INT-HASH-001 trie les clés et supprime les espaces', () => {
    const input = {
      from_account: '543 232 625-3',
      to_account: '321 567 636-4',
      amount: 500,
      currency: 'USD',
    };
    expect(canonicalize(input)).toBe(
      '{"amount":500,"currency":"USD","from_account":"543 232 625-3","to_account":"321 567 636-4"}',
    );
  });

  it('INT-HASH-001 reproduit le vecteur public de tri de clés', () => {
    const input = {
      '1': { f: { f: 'hi', F: 5 }, '\n': 56 },
      '10': {},
      '': 'empty',
      a: {},
      '111': [{ e: 'yes', E: 'no' }],
      A: {},
    };
    expect(canonicalize(input)).toBe(
      '{"":"empty","1":{"\\n":56,"f":{"F":5,"f":"hi"}},"10":{},"111":[{"E":"no","e":"yes"}],"A":{},"a":{}}',
    );
  });

  it('INT-HASH-001 échappe les caractères de contrôle, guillemets et barres obliques inverses', () => {
    const value = '€$\u000f\nA\'B"\\"/';
    const output = canonicalize(value);
    expect(JSON.parse(output)).toBe(value);
    expect(output).toContain('\\u000f');
    expect(output).toContain('\\n');
    expect(output).toContain('\\"');
    expect(output).toContain('\\\\');
    expect(output).toContain('€');
    expect(output).not.toContain('\\/');
  });

  it('INT-HASH-001 préserve les paires de substitution UTF-16', () => {
    const value = 'paiement 😀 100 %';
    const output = canonicalize({ value });
    expect(JSON.parse(output)).toEqual({ value });
    expect(output).toContain('😀');
  });

  it('INT-HASH-001 trie les clés par unités de code UTF-16', () => {
    const input = { '😀': 1, é: 2, a: 3, A: 4 };
    expect(canonicalize(input)).toBe('{"A":4,"a":3,"é":2,"😀":1}');
  });

  it('INT-HASH-001 normalise -0 en 0', () => {
    expect(canonicalize(-0)).toBe('0');
  });

  it('INT-HASH-001 accepte les structures vides', () => {
    expect(canonicalize({})).toBe('{}');
    expect(canonicalize([])).toBe('[]');
  });

  it('I-12 refuse les nombres flottants', () => {
    expectChainError(() => canonicalize(1.5), 'CHAIN_INVALID_CONTENT');
    expectChainError(() => canonicalize(1e30), 'CHAIN_INVALID_CONTENT');
    expectChainError(
      () => canonicalize(Number.NaN),
      'CHAIN_INVALID_CONTENT',
    );
    expectChainError(
      () => canonicalize(Number.POSITIVE_INFINITY),
      'CHAIN_INVALID_CONTENT',
    );
  });

  it('refuse les entiers au-delà de la plage sûre', () => {
    expectChainError(
      () => canonicalize(Number.MAX_SAFE_INTEGER + 1),
      'CHAIN_INVALID_CONTENT',
    );
  });

  it('refuse undefined, BigInt et objets non simples', () => {
    expectChainError(
      () => canonicalize({ a: undefined } as unknown as JsonValue),
      'CHAIN_INVALID_CONTENT',
    );
    expectChainError(
      () => canonicalize([undefined] as unknown as JsonValue),
      'CHAIN_INVALID_CONTENT',
    );
    expectChainError(
      () => canonicalize(1n as unknown as JsonValue),
      'CHAIN_INVALID_CONTENT',
    );
    expectChainError(
      () => canonicalize(new Date() as unknown as JsonValue),
      'CHAIN_INVALID_CONTENT',
    );
    expectChainError(
      () => canonicalize(new Map() as unknown as JsonValue),
      'CHAIN_INVALID_CONTENT',
    );
  });

  it('refuse les références circulaires', () => {
    const cyclic: Record<string, JsonValue> = {};
    cyclic['self'] = cyclic;
    expectChainError(() => canonicalize(cyclic), 'CHAIN_INVALID_CONTENT');
  });

  it('refuse les chaînes UTF-16 mal formées', () => {
    expectChainError(
      () => canonicalize('\ud800'),
      'CHAIN_INVALID_CONTENT',
    );
    expectChainError(
      () => canonicalize('\udc00'),
      'CHAIN_INVALID_CONTENT',
    );
  });
});
