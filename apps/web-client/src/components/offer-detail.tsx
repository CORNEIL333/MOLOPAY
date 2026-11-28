import { AmountXaf, Badge } from '@achat/ui';
import type { ReactElement } from 'react';
import { FavoriteToggleButton } from './favorites-view';
import type {
  City,
  Offer,
  OfferModel,
  Universe,
} from './offer-card';

export type OfferDetailLabels = {
  readonly partnerLabel: string;
  readonly citiesLabel: string;
  readonly priceLabel: string;
  readonly warrantyLabel: string;
  readonly modelsLabel: string;
  readonly universes: Readonly<Record<Universe, string>>;
  readonly cities: Readonly<Record<City, string>>;
  readonly availability: Readonly<Record<string, string>>;
  readonly models: Readonly<Record<OfferModel, string>>;
};

export function OfferDetail({
  offer,
  labels,
}: {
  readonly offer: Offer;
  readonly labels: OfferDetailLabels;
}): ReactElement {
  return (
    <header className="offer-detail" aria-labelledby="offer-title">
      <div className="mp-ph">
        <p className="offer-detail__meta">
          {labels.universes[offer.universe]} ·{' '}
          {offer.cities.map((city) => labels.cities[city]).join(' · ')}
        </p>
        <FavoriteToggleButton offerId={offer.offerId} priceXaf={offer.priceXaf} locale="fr" />
      </div>
      <h1 id="offer-title" className="page-title">
        {offer.title}
      </h1>
      <p className="offer-detail__partner">
        {labels.partnerLabel} : {offer.partnerName}{' '}
        <Badge tone="success">Partenaire vérifié</Badge>
      </p>
      <dl className="offer-detail__facts">
        <div>
          <dt>{labels.priceLabel}</dt>
          <dd>
            <AmountXaf amount={offer.priceXaf} />
          </dd>
        </div>
        <div>
          <dt>{labels.citiesLabel}</dt>
          <dd>{offer.cities.map((city) => labels.cities[city]).join(', ')}</dd>
        </div>
        <div>
          <dt>{labels.warrantyLabel}</dt>
          <dd>{offer.warranty}</dd>
        </div>
      </dl>
      <h2 className="offer-detail__subtitle">{labels.modelsLabel}</h2>
      <ul className="offer-detail__models">
        {offer.models.filter((model) => model !== 'FINANCED_PURCHASE').map((model) => (
          <li key={model}>{labels.models[model]}</li>
        ))}
      </ul>
      {offer.discountTerms === '' ? null : (
        <p className="offer-detail__discount">{offer.discountTerms}</p>
      )}
      <p className="offer-detail__availability">
        {labels.availability[offer.availability.kind === 'IN_STOCK' && offer.availability.units === 0 ? 'OUT_OF_STOCK' : offer.availability.kind]}
      </p>
    </header>
  );
}
