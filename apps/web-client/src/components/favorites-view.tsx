'use client';

import type { components } from '@achat/contracts/api';
import { AmountXaf, Badge, EmptyState, IconButton, formatXaf } from '@achat/ui';
import { useEffect, useId, useState, type ReactElement } from 'react';
import type { Locale } from '../i18n';
import {
  MP_FAVORITES_STORAGE_KEY,
  computeFavoritePriceDelta,
  parseStoredFavorites,
  toggleStoredFavorite,
  type StoredFavorite,
} from '../lib/favorites';
import { searchOffers } from '../lib/offer-search';

type Offer = components['schemas']['Offer'];

function readLocalFavorites(): readonly StoredFavorite[] {
  if (typeof window === 'undefined') return [];
  try { return parseStoredFavorites(window.localStorage.getItem(MP_FAVORITES_STORAGE_KEY)); } catch { return []; }
}

function writeLocalFavorites(next: readonly StoredFavorite[]): void {
  try { window.localStorage.setItem(MP_FAVORITES_STORAGE_KEY, JSON.stringify(next)); } catch { /* stockage indisponible */ }
}

export function FavoriteToggleButton({ offerId, priceXaf, locale }: {
  readonly offerId: string; readonly priceXaf: string; readonly locale: Locale;
}): ReactElement {
  const [saved, setSaved] = useState(false);
  useEffect(() => { setSaved(readLocalFavorites().some((f) => f.offerId === offerId)); }, [offerId]);
  const label = locale === 'en' ? (saved ? 'Remove from wishlist' : 'Add to wishlist') : (saved ? 'Retirer de mes envies' : 'Ajouter à mes envies');
  return (
    <IconButton icon="heart" pressed={saved} ariaLabel={label} onClick={() => {
      const next = toggleStoredFavorite(readLocalFavorites(), { offerId, priceXaf, nowIso: new Date().toISOString() });
      writeLocalFavorites(next);
      setSaved(next.some((f) => f.offerId === offerId));
    }} />
  );
}

export function OfferSearchPanel({ offers, locale, initialQuery = '' }: {
  readonly offers: readonly Offer[]; readonly locale: Locale; readonly initialQuery?: string;
}): ReactElement {
  const id = useId();
  const isEn = locale === 'en';
  const [term, setTerm] = useState(initialQuery);
  const trimmed = term.trim();
  const matched = trimmed === '' ? [] : searchOffers(offers, trimmed);

  return (
    <section role="search" aria-labelledby={`${id}-ask`} className="mp-panel mp-search-box">
      <label id={`${id}-ask`} htmlFor={`${id}-q`} className="mp-search-box__ask">
        {isEn ? 'What’s your next project?' : 'Quel est votre prochain projet ?'}
      </label>
      <input id={`${id}-q`} type="search" value={term} placeholder={isEn ? 'Motorbike, fridge, rent…' : 'Moto, frigo, loyer…'}
        className="achat-field__input" onChange={(e) => { setTerm(e.currentTarget.value); }} />
      {trimmed === '' ? null : matched.length === 0 ? (
        <p role="status" className="mp-banner">
          {isEn ? `No offers for "${trimmed}". Try a simpler word, or request this product.` : `Aucune offre pour « ${trimmed} ». Essayez un mot plus simple, ou demandez ce produit.`}
        </p>
      ) : (
        <div className="mp-page">
          <p role="status" className="mp-sub">{isEn ? `Results for "${trimmed}"` : `Résultats pour « ${trimmed} »`}</p>
          <ul className="mp-navlist">
            {matched.map((offer) => (
              <li key={offer.offerId} className="mp-kv">
                <a href={`/offres/${encodeURIComponent(offer.offerId)}`}>{offer.title}</a>
                <AmountXaf amount={offer.priceXaf} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function FavoritesView({ offers, locale }: { readonly offers: readonly Offer[]; readonly locale: Locale }): ReactElement {
  const isEn = locale === 'en';
  const [favorites, setFavorites] = useState<readonly StoredFavorite[]>([]);
  useEffect(() => { setFavorites(readLocalFavorites()); }, []);

  return (
    <section aria-labelledby="favorites-title" className="mp-page">
      <h1 id="favorites-title" className="page-title">{isEn ? 'My wishlist' : 'Mes envies'}</h1>
      <p className="mp-banner">
        {isEn ? 'A wishlist price can change. It is locked only when you reserve.' : 'Le prix d’un favori peut changer. Il est figé seulement quand vous réservez.'}
      </p>
      {favorites.length === 0 ? (
        <EmptyState title={isEn ? 'No saved offers yet' : 'Aucune envie enregistrée'}
          description={isEn ? 'Browse the catalog to save offers on this device.' : 'Parcourez le catalogue pour garder vos offres sur cet appareil.'} />
      ) : (
        <div className="offer-grid">
          {favorites.map((fav) => {
            const live = offers.find((o) => o.offerId === fav.offerId);
            if (live === undefined) return null;
            const delta = computeFavoritePriceDelta(fav.addedPriceXaf, live.priceXaf);
            return (
              <article key={fav.offerId} className="offer-card">
                <div className="mp-ph">
                  <h2 className="offer-card__title">{live.title}</h2>
                  <IconButton icon="heart" pressed ariaLabel={isEn ? `Remove ${live.title}` : `Retirer ${live.title}`} onClick={() => {
                    const next = favorites.filter((f) => f.offerId !== fav.offerId);
                    writeLocalFavorites(next);
                    setFavorites(next);
                  }} />
                </div>
                <p className="offer-card__partner">{live.partnerName}</p>
                <p className="offer-card__price"><AmountXaf amount={live.priceXaf} /></p>
                {delta.kind === 'DOWN' ? (
                  <p><Badge tone="success">{isEn ? `${formatXaf(delta.deltaXaf)} lower since added` : `Baisse de ${formatXaf(delta.deltaXaf)} depuis l’ajout`}</Badge></p>
                ) : delta.kind === 'UP' ? (
                  <p><Badge tone="warning">{isEn ? `${formatXaf(delta.deltaXaf)} higher since added` : `Hausse de ${formatXaf(delta.deltaXaf)} depuis l’ajout`}</Badge></p>
                ) : null}
                <a className="offer-card__link" href={`/offres/${encodeURIComponent(live.offerId)}`}>{isEn ? 'View offer' : 'Voir l’offre'}</a>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
