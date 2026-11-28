import { describe, expect, it } from 'vitest';
import {
  computeFavoritePriceDelta,
  parseStoredFavorites,
  toggleStoredFavorite,
} from './favorites';

describe('MVP 0.0.1 · U2a favoris locaux et comparaison entière XAF (09_… § 4.1, I-12)', () => {
  it('ajoute puis retire un favori en conservant le prix entier au moment de l’ajout', () => {
    const step1 = toggleStoredFavorite([], {
      offerId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      priceXaf: '250000',
      nowIso: '2026-11-28T10:00:00.000Z',
    });
    expect(step1).toEqual([
      {
        offerId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        addedPriceXaf: '250000',
        addedAt: '2026-11-28T10:00:00.000Z',
      },
    ]);
    const step2 = toggleStoredFavorite(step1, {
      offerId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      priceXaf: '250000',
      nowIso: '2026-11-28T10:05:00.000Z',
    });
    expect(step2).toEqual([]);
  });

  it('calcule exactement la baisse ou la hausse en bigint XAF sans flottant', () => {
    expect(computeFavoritePriceDelta('250000', '235000')).toEqual({ kind: 'DOWN', deltaXaf: '15000' });
    expect(computeFavoritePriceDelta('250000', '262500')).toEqual({ kind: 'UP', deltaXaf: '12500' });
    expect(computeFavoritePriceDelta('250000', '250000')).toEqual({ kind: 'SAME' });
  });

  it('refuse un montant non canonique dans les favoris stockés (ignore les entrées corrompues)', () => {
    const raw = JSON.stringify([
      { offerId: 'offer-ok', addedPriceXaf: '100000', addedAt: '2026-11-28T10:00:00Z' },
      { offerId: 'offer-float', addedPriceXaf: '100.50', addedAt: '2026-11-28T10:00:00Z' },
      { offerId: '', addedPriceXaf: '100000', addedAt: '2026-11-28T10:00:00Z' },
    ]);
    expect(parseStoredFavorites(raw)).toEqual([
      { offerId: 'offer-ok', addedPriceXaf: '100000', addedAt: '2026-11-28T10:00:00Z' },
    ]);
    expect(() => computeFavoritePriceDelta('250000.5', '250000')).toThrow();
  });
});
