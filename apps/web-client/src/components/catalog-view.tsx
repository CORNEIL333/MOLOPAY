import { Button, EmptyState } from '@achat/ui';
import type { ReactElement } from 'react';
import type { City, Offer, OfferModel, Universe } from './offer-card';
import { OfferCard } from './offer-card';

export type CatalogLabels = {
  readonly title: string;
  readonly subtitle: string;
  readonly universeLabel: string;
  readonly cityLabel: string;
  readonly all: string;
  readonly apply: string;
  readonly reset: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly universes: Readonly<Record<Universe, string>>;
  readonly cities: Readonly<Record<City, string>>;
  readonly priceLabel: string;
  readonly viewOffer: string;
  readonly warranty: string;
  readonly availability: Readonly<Record<string, string>>;
  readonly models: Readonly<Record<OfferModel, string>>;
};

export type CatalogFilters = {
  readonly universe?: Universe;
  readonly city?: City;
};

const UNIVERSES: readonly Universe[] = [
  'ESSENTIALS',
  'TECHNOLOGY',
  'HOUSING',
  'MOBILITY',
];
const CITIES: readonly City[] = ['yaounde', 'douala'];

export function CatalogView({
  offers,
  labels,
  filters,
}: {
  readonly offers: readonly Offer[];
  readonly labels: CatalogLabels;
  readonly filters: CatalogFilters;
}): ReactElement {
  return (
    <section aria-labelledby="catalog-title" className="catalog">
      <h1 id="catalog-title" className="page-title">
        {labels.title}
      </h1>
      <p className="page-subtitle">{labels.subtitle}</p>

      <form className="catalog-filters" method="get" action="/">
        <div className="achat-field">
          <label className="achat-field__label" htmlFor="filter-universe">
            {labels.universeLabel}
          </label>
          <select
            id="filter-universe"
            name="universe"
            className="achat-field__input"
            defaultValue={filters.universe ?? ''}
          >
            <option value="">{labels.all}</option>
            {UNIVERSES.map((universe) => (
              <option key={universe} value={universe}>
                {labels.universes[universe]}
              </option>
            ))}
          </select>
        </div>
        <div className="achat-field">
          <label className="achat-field__label" htmlFor="filter-city">
            {labels.cityLabel}
          </label>
          <select
            id="filter-city"
            name="city"
            className="achat-field__input"
            defaultValue={filters.city ?? ''}
          >
            <option value="">{labels.all}</option>
            {CITIES.map((city) => (
              <option key={city} value={city}>
                {labels.cities[city]}
              </option>
            ))}
          </select>
        </div>
        <div className="catalog-filters__actions">
          <Button type="submit">{labels.apply}</Button>
          <a className="catalog-filters__reset" href="/">
            {labels.reset}
          </a>
        </div>
      </form>

      {offers.length === 0 ? (
        <EmptyState
          title={labels.emptyTitle}
          description={labels.emptyDescription}
        />
      ) : (
        <div className="offer-grid">
          {offers.map((offer) => (
            <OfferCard
              key={offer.offerId}
              offer={offer}
              labels={{
                price: labels.priceLabel,
                viewOffer: labels.viewOffer,
                warranty: labels.warranty,
                universes: labels.universes,
                cities: labels.cities,
                availability: labels.availability,
                models: labels.models,
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
