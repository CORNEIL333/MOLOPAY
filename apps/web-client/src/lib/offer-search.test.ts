import { describe, expect, it } from 'vitest';
import { offerFixture, secondOffer } from '../test/fixtures';
import { searchOffers } from './offer-search';

describe('MVP 0.0.1 · U2a recherche tolérante aux fautes et synonymes (09_… § 4.1)', () => {
  const fridge = offerFixture({ title: 'Réfrigérateur 220 L', universe: 'ESSENTIALS' });
  const phone = { ...secondOffer, title: 'Smartphone 128 Go', universe: 'TECHNOLOGY' as const };
  const moto = offerFixture({
    offerId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a99',
    title: 'Moto urbaine 125 cm³',
    universe: 'MOBILITY',
  });
  const catalog = [fridge, phone, moto];

  it('trouve par synonyme courant (frigo -> Réfrigérateur, scooter -> Moto, téléphone -> Smartphone)', () => {
    expect(searchOffers(catalog, 'frigo').map((o) => o.title)).toEqual(['Réfrigérateur 220 L']);
    expect(searchOffers(catalog, 'scooter').map((o) => o.title)).toEqual(['Moto urbaine 125 cm³']);
    expect(searchOffers(catalog, 'téléphone').map((o) => o.title)).toEqual(['Smartphone 128 Go']);
  });

  it('tolère une faute de frappe légère (distance de Levenshtein <= 2)', () => {
    expect(searchOffers(catalog, 'refrigirateur').map((o) => o.title)).toEqual(['Réfrigérateur 220 L']);
    expect(searchOffers(catalog, 'smartpone').map((o) => o.title)).toEqual(['Smartphone 128 Go']);
  });

  it('refuse d’inventer un résultat quand aucun terme ni synonyme ne correspond', () => {
    expect(searchOffers(catalog, 'tractopelle')).toEqual([]);
  });
});
