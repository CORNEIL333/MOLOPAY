import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { offerFixture, secondOffer } from '../test/fixtures';
import { FavoritesView, OfferSearchPanel } from './favorites-view';
import { MP_FAVORITES_STORAGE_KEY } from '../lib/favorites';

describe('MVP 0.0.1 · U2a composants Recherche et Favoris (09_… § 4.1)', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('OfferSearchPanel filtre par synonyme et affiche un état honnête sans inventer d’offre', async () => {
    const { container } = render(
      <OfferSearchPanel
        offers={[offerFixture(), secondOffer]}
        locale="fr"
      />,
    );
    const input = screen.getByPlaceholderText('Moto, frigo, loyer…');
    fireEvent.change(input, { target: { value: 'frigo' } });
    expect(screen.getByText(/Résultats pour « frigo »/)).toBeVisible();
    expect(screen.getByRole('link', { name: /Réfrigérateur 220 L/ })).toHaveAttribute(
      'href',
      '/offres/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    );
    await expectNoA11yViolations(container);

    fireEvent.change(input, { target: { value: 'hélicoptère' } });
    expect(screen.getByText(/Aucune offre pour « hélicoptère »/)).toBeVisible();
  });

  it('FavoritesView affiche l’avertissement prix non figé et l’écart exact en FCFA hors de tout verre', async () => {
    const offer = offerFixture({ priceXaf: '235000' });
    window.localStorage.setItem(
      MP_FAVORITES_STORAGE_KEY,
      JSON.stringify([
        {
          offerId: offer.offerId,
          addedPriceXaf: '250000',
          addedAt: '2026-11-27T10:00:00.000Z',
        },
      ]),
    );
    const { container } = render(<FavoritesView offers={[offer]} locale="fr" />);
    expect(
      screen.getByText('Le prix d’un favori peut changer. Il est figé seulement quand vous réservez.'),
    ).toBeVisible();
    expect(container.textContent).toContain('Baisse de 15\u00a0000\u00a0FCFA depuis l’ajout');
    expect(container.querySelectorAll('.mp-glass')).toHaveLength(0);
    await expectNoA11yViolations(container);
  });
});
