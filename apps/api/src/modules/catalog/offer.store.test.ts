import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import { createOffer, type Offer, type Partner } from './domain';
import { offerFromRow, offerVersionParams, type OfferVersionRow } from './offer.store';

const OFFER_ID = '019a9000-0000-7000-8000-000000000001';
const VALIDATED: Partner = { id: 'partner-1', status: 'VALIDATED' };
// Au-delà de Number.MAX_SAFE_INTEGER : un passage par flottant se verrait.
const BIG_PRICE = 9_007_199_254_740_993n;

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    ...createOffer({
      id: OFFER_ID,
      partner: VALIDATED,
      universe: 'TECHNOLOGY',
      models: ['SAVE_THEN_BUY', 'FINANCED_PURCHASE'],
      cityIds: ['douala', 'yaounde'],
      priceXaf: BIG_PRICE,
      availability: { kind: 'IN_STOCK', units: 3 },
      warranty: 'Garantie 12 mois',
      discountTerms: 'Remise de 5 % dès 50 % versés',
    }),
    ...overrides,
  };
}

function row(overrides: Partial<OfferVersionRow> = {}): OfferVersionRow {
  return {
    offer_id: OFFER_ID,
    version: 1,
    partner_id: 'partner-1',
    universe: 'TECHNOLOGY',
    models: ['SAVE_THEN_BUY', 'FINANCED_PURCHASE'],
    city_ids: ['douala', 'yaounde'],
    price_xaf: BIG_PRICE.toString(),
    availability_kind: 'IN_STOCK',
    stock_units: 3,
    lead_days: null,
    warranty: 'Garantie 12 mois',
    discount_terms: 'Remise de 5 % dès 50 % versés',
    state: 'DRAFT',
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessError);
    expect((error as BusinessError).code).toBe(code);
    return;
  }
  throw new Error(`Aucune erreur levée, ${code} attendu`);
}

describe('F-PRT-002 · correspondance offre ↔ version stockée', () => {
  it('NF-FUN-001 sérialise le prix en chaîne décimale entière, sans flottant', () => {
    const params = offerVersionParams(offer());
    expect(params.priceXaf).toBe('9007199254740993');
    expect(params.availabilityKind).toBe('IN_STOCK');
    expect(params.stockUnits).toBe(3);
    expect(params.leadDays).toBeNull();
  });

  it('F-PRT-002 sérialise une précommande sans stock', () => {
    const params = offerVersionParams(
      offer({ availability: { kind: 'PREORDER', leadDays: 21 } }),
    );
    expect(params.stockUnits).toBeNull();
    expect(params.leadDays).toBe(21);
  });

  it('F-PRT-002 relit une version en revalidant l’offre (aller-retour exact)', () => {
    const value = offerFromRow(row(), VALIDATED);
    expect(value).toEqual(offer());
    expect(value.priceXaf).toBe(BIG_PRICE);
  });

  it('F-PRT-002 relit une version publiée sans exiger un partenaire validé', () => {
    const pending: Partner = { id: 'partner-1', status: 'PENDING' };
    const value = offerFromRow(row({ state: 'PUBLISHED' }), pending);
    expect(value.state).toBe('PUBLISHED');
    expect(value.partner).toEqual(pending);
  });

  it('F-PRT-002 refuse un état stocké inconnu', () => {
    expectCode(() => offerFromRow(row({ state: 'ARCHIVED' }), VALIDATED), 'CATALOG_INVALID_REQUEST');
  });

  it('F-PRT-002 refuse une ligne d’un autre partenaire', () => {
    expectCode(
      () => offerFromRow(row(), { id: 'partner-2', status: 'VALIDATED' }),
      'CATALOG_INVALID_REQUEST',
    );
  });

  it.each(['1.5', '-1', '1e6', '', ' 10'])(
    'NF-FUN-001 refuse le prix stocké « %s »',
    (price) => {
      expectCode(() => offerFromRow(row({ price_xaf: price }), VALIDATED), 'CATALOG_INVALID_REQUEST');
    },
  );

  it('F-CAT-001 refuse une ligne incomplète (disponibilité incohérente)', () => {
    expectCode(
      () => offerFromRow(row({ availability_kind: 'IN_STOCK', stock_units: null }), VALIDATED),
      'CATALOG_OFFER_INCOMPLETE',
    );
  });
});
