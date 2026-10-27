import type { components } from '@achat/contracts/api';
import { AmountXaf } from '@achat/ui';
import type { ReactElement } from 'react';

export type Offer = components['schemas']['Offer'];
export type OfferModel = components['schemas']['OfferModel'];
export type Universe = components['schemas']['Universe'];
export type City = components['schemas']['City'];

export type OfferCardLabels = {
  readonly price: string;
  readonly viewOffer: string;
  readonly warranty: string;
  readonly universes: Readonly<Record<Universe, string>>;
  readonly cities: Readonly<Record<City, string>>;
  readonly availability: Readonly<Record<string, string>>;
  readonly models: Readonly<Record<OfferModel, string>>;
};

export function OfferCard({
  offer,
  labels,
}: {
  readonly offer: Offer;
  readonly labels: OfferCardLabels;
}): ReactElement {
  return (
    <article className="offer-card">
      <p className="offer-card__meta">
        {labels.universes[offer.universe]} ·{' '}
        {offer.cities.map((city) => labels.cities[city]).join(' · ')}
      </p>
      <h2 className="offer-card__title">{offer.title}</h2>
      <p className="offer-card__partner">{offer.partnerName}</p>
      <p className="offer-card__price">
        <span className="offer-card__label">{labels.price}</span>{' '}
        <AmountXaf amount={offer.priceXaf} />
      </p>
      <p className="offer-card__availability">
        {labels.availability[offer.availability.kind === 'IN_STOCK' && offer.availability.units === 0 ? 'OUT_OF_STOCK' : offer.availability.kind]}
      </p>
      <ul className="offer-card__models">
        {offer.models.map((model) => (
          <li key={model}>{labels.models[model]}</li>
        ))}
      </ul>
      <p className="offer-card__warranty">
        {labels.warranty} : {offer.warranty}
      </p>
      {offer.discountTerms === '' ? null : (
        <p className="offer-card__discount">{offer.discountTerms}</p>
      )}
      <a
        className="offer-card__link"
        href={`/offres/${encodeURIComponent(offer.offerId)}`}
        aria-label={`${labels.viewOffer} : ${offer.title}`}
      >
        {labels.viewOffer}
      </a>
    </article>
  );
}
