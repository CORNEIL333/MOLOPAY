import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { getDictionary } from '../i18n';
import { CatalogView } from './catalog-view';
import type { CatalogLabels } from './catalog-view';
import { offerFixture, secondOffer } from '../test/fixtures';

const labels: CatalogLabels = getDictionary('fr').catalog;
const completeLabels = { ...labels, modelLabel: 'Formule', maxPriceLabel: 'Prix maximal (FCFA)',
  priceHint: 'Montant entier, sans décimales.', partnerLabel: 'Partenaire', unavailablePartner: 'Partenaire indisponible' };

describe('CatalogView', () => {
  it('F-CAT-004 soumet les cinq filtres sans modifier le prix entier', () => {
    const filters = { universe: 'TECHNOLOGY' as const, city: 'douala' as const, model: 'SAVE_THEN_BUY' as const,
      maxPriceXaf: '9007199254740993', partnerId: 'merchant-1' };
    const props = { offers: [], labels: completeLabels, filters, partners: [{ id: 'merchant-1', name: 'Marchand public' }] };
    const { container } = render(<CatalogView {...props} />);
    expect(screen.getByLabelText(completeLabels.modelLabel)).toHaveValue('SAVE_THEN_BUY');
    const price = screen.getByLabelText(completeLabels.maxPriceLabel);
    expect(price).toHaveValue('9007199254740993');
    expect(price).toHaveAttribute('inputmode', 'numeric');
    expect(price).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText(completeLabels.partnerLabel)).toHaveValue('merchant-1');
    expect(screen.getByRole('option', { name: 'Marchand public' })).toBeVisible();
    const form = container.querySelector('form')!;
    expect(Object.fromEntries(new FormData(form).entries())).toEqual(filters);
    expect(form).toHaveAttribute('method', 'get');
  });
  it('F-CAT-004 conserve le partenaire devenu indisponible dans FormData', () => {
    const props = { offers: [], labels: completeLabels, filters: { partnerId: 'merchant-gone' }, partners: [] };
    const { container } = render(<CatalogView {...props} />);
    const option = screen.getByRole('option', { name: completeLabels.unavailablePartner });
    expect(option).not.toBeDisabled();
    expect(new FormData(container.querySelector('form')!).getAll('partnerId')).toEqual(['merchant-gone']);
    expect(container.textContent).not.toContain('merchant-gone');
    expect(screen.getByRole('link', { name: labels.reset })).toHaveAttribute('href', '/');
  });
  it('NF-UX-001 conserve l’accessibilité des cinq champs, même sans offre', async () => {
    const props = { offers: [], labels: completeLabels, filters: {}, partners: [{ id: 'merchant-1', name: 'Marchand public' }] };
    const { container } = render(<CatalogView {...props} />);
    expect(screen.getAllByRole('combobox')).toHaveLength(4);
    await expectNoA11yViolations(container);
  });
  it('F-CAT-004 garde le formulaire corrigeable après un refus serveur sans afficher un faux résultat vide', () => {
    const props = { offers: [], labels: completeLabels, filters: { maxPriceXaf: '999999999999999999999999' }, partners: [],
      problem: { title: 'Prix invalide', detail: 'Vérifiez le prix maximal.' } };
    render(<CatalogView {...props} />);
    expect(screen.getByLabelText(completeLabels.maxPriceLabel)).toHaveValue('999999999999999999999999');
    expect(screen.getByRole('heading', { name: 'Prix invalide' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: labels.emptyTitle })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.apply })).toBeEnabled();
  });
  it('affiche les offres avec leur prix serveur et un lien explicite', () => {
    const { container } = render(
      <CatalogView
        offers={[offerFixture(), secondOffer]}
        labels={labels}
        filters={{}}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: labels.title }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Réfrigérateur 220 L' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', {
        name: 'Voir l’offre : Réfrigérateur 220 L',
      }),
    ).toHaveAttribute(
      'href',
      '/offres/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    );
    expect(container.textContent).toContain('250\u00a0000\u00a0FCFA');
    expect(container.textContent).toContain('Sur commande');
  });

  it('conserve les filtres choisis dans le formulaire', () => {
    render(
      <CatalogView
        offers={[offerFixture()]}
        labels={labels}
        filters={{ universe: 'TECHNOLOGY', city: 'douala' }}
      />,
    );
    expect(screen.getByLabelText(labels.universeLabel)).toHaveValue(
      'TECHNOLOGY',
    );
    expect(screen.getByLabelText(labels.cityLabel)).toHaveValue('douala');
    expect(
      screen.getByRole('option', { name: 'Technologie' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: labels.apply }),
    ).toHaveAttribute('type', 'submit');
  });

  it('explique l’absence d’offre sans inventer de résultat', () => {
    render(<CatalogView offers={[]} labels={labels} filters={{}} />);
    expect(
      screen.getByRole('heading', { level: 2, name: labels.emptyTitle }),
    ).toBeVisible();
  });

  it('est accessible avec offres et filtres', async () => {
    const { container } = render(
      <CatalogView
        offers={[offerFixture(), secondOffer]}
        labels={labels}
        filters={{ universe: 'ESSENTIALS' }}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
