import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/a11y';
import { getDictionary } from '../i18n';
import { offerFixture } from '../test/fixtures';
import { OfferDetail } from './offer-detail';

const labels = getDictionary('fr');

function renderDetail(): ReturnType<typeof render> {
  return render(
    <OfferDetail
      offer={offerFixture()}
      labels={{
        partnerLabel: labels.offer.partnerLabel,
        citiesLabel: labels.offer.citiesLabel,
        priceLabel: labels.offer.priceLabel,
        warrantyLabel: labels.offer.warrantyLabel,
        modelsLabel: labels.offer.modelsLabel,
        universes: labels.catalog.universes,
        cities: labels.catalog.cities,
        availability: labels.catalog.availability,
        models: labels.catalog.models,
      }}
    />,
  );
}

describe('OfferDetail', () => {
  it('affiche le prix renvoyé par l’API, sans recalcul', () => {
    const { container } = renderDetail();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Réfrigérateur 220 L',
    );
    expect(
      container.querySelector('.offer-detail__facts dd')?.textContent,
    ).toBe('250\u00a0000\u00a0FCFA');
  });

  it('reste accessible', async () => {
    const { container } = renderDetail();
    await expectNoA11yViolations(container);
  });
});
