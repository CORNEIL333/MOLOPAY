import { describe, expect, it } from 'vitest';
import { parsePublicOfferFilter, parsePublicOfferId } from './public-offer.store';

describe('F-CAT-004 · filtres du catalogue public', () => {
  it('accepte les cinq filtres et un montant entier exact', () => {
    expect(parsePublicOfferFilter({ universe: 'TECHNOLOGY', city: 'douala', model: 'SAVE_THEN_BUY', partnerId: 'merchant-1', maxPriceXaf: '9007199254740993' }))
      .toEqual({ universe: 'TECHNOLOGY', city: 'douala', model: 'SAVE_THEN_BUY', partnerId: 'merchant-1', maxPriceXaf: 9007199254740993n });
    expect(parsePublicOfferFilter({})).toEqual({});
    expect(parsePublicOfferFilter({ maxPriceXaf: '0' })).toEqual({ maxPriceXaf: 0n });
  });
  for (const input of [null, [], { unknown: 'x' }, { city: ['douala', 'yaounde'] }, { model: {} }, { universe: 'UNKNOWN' },
    { city: 'paris' }, { model: 'UNKNOWN' }, { partnerId: '' }, { partnerId: 'x OR 1=1' },
    ...['-1', '01', '1.1', '1e3', '9223372036854775808', ''].map((price) => ({ maxPriceXaf: price }))]) {
    it('refuse les valeurs hors contrat avec REQUEST_INVALID', () => {
      expect(() => parsePublicOfferFilter(input)).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }));
    });
  }
  it('refuse les accesseurs sans les lire', () => {
    let accessed = false;
    const input = Object.defineProperty({}, 'city', { enumerable: true, get: () => { accessed = true; return 'douala'; } });
    expect(() => parsePublicOfferFilter(input)).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }));
    expect(accessed).toBe(false);
  });
  it('accepte un UUID canonique et refuse les autres identifiants', () => {
    expect(parsePublicOfferId('019a9400-0000-7000-8000-0000000000a1')).toBe('019a9400-0000-7000-8000-0000000000a1');
    expect(() => parsePublicOfferId('invalid')).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }));
  });
});
