import { xaf } from '@achat/money';
import { describe, expect, it } from 'vitest';
import { formatXaf, formatXafSms, isCanonicalXafAmount } from './format';

const NBSP = '\u00a0';

describe('NF-FUN-001 / I-12 · formatXaf alimenté par @achat/money', () => {
  it('groupe les milliers sans convertir le montant en flottant (chaîne, bigint et Money)', () => {
    expect(formatXaf('25000')).toBe(`25${NBSP}000${NBSP}FCFA`);
    expect(formatXaf(25_000n)).toBe(`25${NBSP}000${NBSP}FCFA`);
    expect(formatXaf(xaf(25_000n))).toBe(`25${NBSP}000${NBSP}FCFA`);
    expect(formatXaf('0')).toBe(`0${NBSP}FCFA`);
    expect(formatXaf('1000000')).toBe(`1${NBSP}000${NBSP}000${NBSP}FCFA`);
  });

  it('produit une espace ASCII ordinaire pour les SMS et USSD (GSM-7)', () => {
    expect(formatXafSms('25000')).toBe('25 000 FCFA');
    expect(formatXafSms(xaf(1_250_000n))).toBe('1 250 000 FCFA');
  });

  it('reste exact au-delà de Number.MAX_SAFE_INTEGER', () => {
    expect(formatXaf('9223372036854775807')).toBe(
      `9${NBSP}223${NBSP}372${NBSP}036${NBSP}854${NBSP}775${NBSP}807${NBSP}FCFA`,
    );
  });

  it.each([
    ['25000.00'],
    ['25,000'],
    ['-1'],
    ['01'],
    [''],
    [' 1'],
    ['1 000'],
    ['9223372036854775808'],
  ])('refuse le montant non canonique %s', (amount) => {
    expect(() => formatXaf(amount)).toThrowError(
      /XAF_AMOUNT_(?:INVALID|OUT_OF_RANGE)/,
    );
  });

  it('refuse un montant Money ou bigint négatif', () => {
    expect(() => formatXaf(-500n)).toThrowError('XAF_AMOUNT_INVALID');
    expect(() => formatXaf(xaf(-500n))).toThrowError('XAF_AMOUNT_INVALID');
  });

  it('reconnaît une chaîne canonique', () => {
    expect(isCanonicalXafAmount('25000')).toBe(true);
    expect(isCanonicalXafAmount('025000')).toBe(false);
    expect(isCanonicalXafAmount(25000 as unknown as string)).toBe(false);
  });
});
