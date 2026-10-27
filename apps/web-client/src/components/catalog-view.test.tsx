import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { getDictionary } from '../i18n';
import { CatalogView } from './catalog-view';
import type { CatalogLabels } from './catalog-view';
import { offerFixture, secondOffer } from '../test/fixtures';

const labels: CatalogLabels = getDictionary('fr').catalog;

describe('CatalogView', () => {
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
