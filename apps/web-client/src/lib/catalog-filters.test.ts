import { describe, expect, it } from 'vitest';
import { catalogFiltersFromSearch, catalogPartners } from './catalog-filters';
import { offerFixture, secondOffer } from '../test/fixtures';

describe('F-CAT-004 · filtres de l’URL web', () => {
  it('transmet les cinq filtres avec le prix exact comme texte', () => {
    const filters = { universe: 'TECHNOLOGY', city: 'douala', model: 'SAVE_THEN_BUY', maxPriceXaf: '9007199254740993', partnerId: 'merchant-1' };
    expect(catalogFiltersFromSearch(filters)).toEqual(filters);
  });
  it('omet seulement les valeurs vides des contrôles et les valeurs absentes', () => {
    expect(catalogFiltersFromSearch({ universe: '', city: '', model: '', maxPriceXaf: '', partnerId: undefined })).toEqual({});
    expect(catalogFiltersFromSearch({ maxPriceXaf: '0' })).toEqual({ maxPriceXaf: '0' });
  });
  for (const input of [null, [], { unknown: '' }, { city: ['douala', 'yaounde'] }, { city: ['douala'] },
    { universe: 'other' }, { city: 'other' }, { model: 'other' }, { partnerId: 'x OR 1=1' }, { maxPriceXaf: 100 },
    ...['01', '-1', '1.1', '1e3', '+1', ' 1'].map((value) => ({ maxPriceXaf: value }))]) {
    it('refuse une URL invalide au lieu de retirer silencieusement un filtre', () => {
      expect(() => catalogFiltersFromSearch(input)).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }));
    });
  }
  it('ne lit pas un accesseur et refuse les champs symboliques', () => {
    let accessed = false;
    const input = Object.defineProperty({}, 'city', { enumerable: true, get: () => { accessed = true; return 'douala'; } });
    expect(() => catalogFiltersFromSearch(input)).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }));
    expect(accessed).toBe(false);
    expect(() => catalogFiltersFromSearch({ [Symbol('unknown')]: '' })).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }));
  });
  it('déduit les partenaires des offres réelles et déduplique par identifiant', () => {
    const first = offerFixture();
    const other = { ...secondOffer, partnerId: 'merchant-z', partnerName: 'Z Marchand' };
    expect(catalogPartners([other, first, first])).toEqual([
      { id: first.partnerId, name: first.partnerName }, { id: other.partnerId, name: other.partnerName },
    ]);
    expect(catalogPartners([])).toEqual([]);
  });
});
