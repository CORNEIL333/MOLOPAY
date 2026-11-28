import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import {
  activatePartnerPlan,
  assertStockAvailable,
  createOffer,
  filterOffers,
  publishOffer,
  type ApprovedPaymentPlan,
  type Offer,
  type OfferInput,
  type Partner,
} from './domain';

const OFFER_ID = '019a9000-0000-7000-8000-000000000001';
const OTHER_OFFER_ID = '019a9000-0000-7000-8000-000000000002';
const NOW = '2026-10-26T10:00:00.000Z';

const VALIDATED: Partner = { id: 'partner-1', status: 'VALIDATED' };
const PENDING: Partner = { id: 'partner-1', status: 'PENDING' };

const BASE: OfferInput = {
  id: OFFER_ID,
  partner: VALIDATED,
  universe: 'TECHNOLOGY',
  models: ['SAVE_THEN_BUY', 'FINANCED_PURCHASE'],
  cityIds: ['douala'],
  priceXaf: 150_000n,
  availability: { kind: 'IN_STOCK', units: 3 },
  warranty: 'Garantie 12 mois',
  discountTerms: 'Remise de 5 % dès 50 % versés',
};

function draft(overrides: Partial<OfferInput> = {}): Offer {
  return createOffer({ ...BASE, ...overrides });
}

function published(overrides: Partial<OfferInput> = {}): Offer {
  return publishOffer(draft(overrides));
}

function plan(
  overrides: Partial<ApprovedPaymentPlan> = {},
): ApprovedPaymentPlan {
  return {
    id: 'plan-1',
    offerId: OFFER_ID,
    partnerId: 'partner-1',
    model: 'SAVE_THEN_BUY',
    platformApproved: true,
    lenderApprovalRef: null,
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
  throw new Error(`Aucun refus pour le code attendu ${code}`);
}

describe('F-CAT-001 · offre complète avant publication', () => {
  it('publie une offre complète d’un partenaire validé', () => {
    const offer = published();
    expect(offer.state).toBe('PUBLISHED');
    expect(offer.priceXaf).toBe(150_000n);
    expect(offer.models).toEqual(['SAVE_THEN_BUY', 'FINANCED_PURCHASE']);
    expect(offer.cityIds).toEqual(['douala']);
  });

  it('refuse une offre sans modèle', () => {
    expectCode(() => draft({ models: [] }), 'CATALOG_OFFER_INCOMPLETE');
  });

  it('refuse un modèle inconnu', () => {
    expectCode(
      () => draft({ models: ['RENTAL'] as unknown as OfferInput['models'] }),
      'CATALOG_OFFER_INCOMPLETE',
    );
  });

  it('refuse un modèle dupliqué', () => {
    expectCode(
      () => draft({ models: ['SAVE_THEN_BUY', 'SAVE_THEN_BUY'] }),
      'CATALOG_OFFER_INCOMPLETE',
    );
  });

  it('refuse une offre sans ville ou avec doublon', () => {
    expectCode(() => draft({ cityIds: [] }), 'CATALOG_OFFER_INCOMPLETE');
    expectCode(
      () => draft({ cityIds: ['douala', 'douala'] }),
      'CATALOG_OFFER_INCOMPLETE',
    );
  });

  it('refuse une ville hors lancement', () => {
    expectCode(
      () => draft({ cityIds: ['bafoussam'] as unknown as OfferInput['cityIds'] }),
      'CATALOG_OFFER_INCOMPLETE',
    );
  });

  it('refuse une garantie ou des conditions vides', () => {
    expectCode(() => draft({ warranty: '  ' }), 'CATALOG_OFFER_INCOMPLETE');
    expectCode(
      () => draft({ discountTerms: '' }),
      'CATALOG_OFFER_INCOMPLETE',
    );
  });

  it('refuse un prix nul, flottant ou hors plage', () => {
    expectCode(() => draft({ priceXaf: 0n }), 'CATALOG_OFFER_INCOMPLETE');
    expectCode(
      () => draft({ priceXaf: 150_000 as unknown as bigint }),
      'CATALOG_OFFER_INCOMPLETE',
    );
    expectCode(
      () => draft({ priceXaf: 2n ** 63n }),
      'CATALOG_OFFER_INCOMPLETE',
    );
  });

  it('refuse un stock ou un délai invalide', () => {
    expectCode(
      () => draft({ availability: { kind: 'IN_STOCK', units: -1 } }),
      'CATALOG_OFFER_INCOMPLETE',
    );
    expectCode(
      () => draft({ availability: { kind: 'PREORDER', leadDays: 0 } }),
      'CATALOG_OFFER_INCOMPLETE',
    );
  });

  it('refuse un univers inconnu', () => {
    expectCode(
      () => draft({ universe: 'OTHER' as unknown as OfferInput['universe'] }),
      'CATALOG_INVALID_REQUEST',
    );
  });
});

describe('F-PRT-001 · partenaire non validé invisible', () => {
  it('refuse la publication d’un partenaire en attente ou suspendu', () => {
    expectCode(
      () => publishOffer(draft({ partner: PENDING })),
      'CATALOG_PARTNER_NOT_VALIDATED',
    );
    expectCode(
      () =>
        publishOffer(
          draft({ partner: { id: 'partner-1', status: 'SUSPENDED' } }),
        ),
      'CATALOG_PARTNER_NOT_VALIDATED',
    );
  });

  it('filtre les brouillons et les offres de partenaire non validé', () => {
    const visible = published();
    const hiddenDraft = draft({ id: OTHER_OFFER_ID });
    const forged = {
      ...published({ id: OTHER_OFFER_ID }),
      partner: PENDING,
    } as Offer;
    expect(filterOffers([visible, hiddenDraft, forged])).toEqual([visible]);
  });
});

describe('F-CAT-002 · plans approuvés uniquement', () => {
  it('active un plan A approuvé par la plateforme', () => {
    const activation = activatePartnerPlan({
      plan: plan(),
      offer: published(),
      partner: VALIDATED,
      request: {
        planId: 'plan-1',
        offerId: OFFER_ID,
        model: 'SAVE_THEN_BUY',
      },
      now: NOW,
    });
    expect(activation).toEqual({
      planId: 'plan-1',
      offerId: OFFER_ID,
      partnerId: 'partner-1',
      model: 'SAVE_THEN_BUY',
      activatedAt: NOW,
    });
  });

  it('refuse un plan non approuvé par la plateforme', () => {
    expectCode(
      () =>
        activatePartnerPlan({
          plan: plan({ platformApproved: false }),
          offer: published(),
          partner: VALIDATED,
          request: {
            planId: 'plan-1',
            offerId: OFFER_ID,
            model: 'SAVE_THEN_BUY',
          },
          now: NOW,
        }),
      'CATALOG_PLAN_NOT_APPROVED',
    );
  });

  it('exige l’approbation du financeur pour le modèle B', () => {
    const request = {
      planId: 'plan-2',
      offerId: OFFER_ID,
      model: 'FINANCED_PURCHASE',
    };
    expectCode(
      () =>
        activatePartnerPlan({
          plan: plan({ id: 'plan-2', model: 'FINANCED_PURCHASE' }),
          offer: published(),
          partner: VALIDATED,
          request,
          now: NOW,
        }),
      'CATALOG_PLAN_NOT_APPROVED',
    );
    expect(
      activatePartnerPlan({
        plan: plan({
          id: 'plan-2',
          model: 'FINANCED_PURCHASE',
          lenderApprovalRef: 'lender-decision-42',
        }),
        offer: published(),
        partner: VALIDATED,
        request,
        now: NOW,
      }).model,
    ).toBe('FINANCED_PURCHASE');
  });

  it('interdit au partenaire de fournir une condition de crédit', () => {
    for (const extra of [
      { teg: 0.12 },
      { durationMonths: 12 },
      { feesXaf: 5_000 },
      { rate: '12 %' },
    ]) {
      expectCode(
        () =>
          activatePartnerPlan({
            plan: plan(),
            offer: published(),
            partner: VALIDATED,
            request: {
              planId: 'plan-1',
              offerId: OFFER_ID,
              model: 'SAVE_THEN_BUY',
              ...extra,
            },
            now: NOW,
          }),
        'CATALOG_FIELD_FORBIDDEN',
      );
    }
  });

  it('refuse un plan d’une autre offre, d’un autre partenaire ou d’un modèle absent', () => {
    const request = {
      planId: 'plan-1',
      offerId: OFFER_ID,
      model: 'SAVE_THEN_BUY',
    };
    expectCode(
      () =>
        activatePartnerPlan({
          plan: plan({ offerId: OTHER_OFFER_ID }),
          offer: published(),
          partner: VALIDATED,
          request,
          now: NOW,
        }),
      'CATALOG_PLAN_NOT_APPROVED',
    );
    expectCode(
      () =>
        activatePartnerPlan({
          plan: plan({ partnerId: 'partner-2' }),
          offer: published(),
          partner: VALIDATED,
          request,
          now: NOW,
        }),
      'CATALOG_PLAN_NOT_APPROVED',
    );
    expectCode(
      () =>
        activatePartnerPlan({
          plan: plan({ model: 'PLANNED_EXPENSE' }),
          offer: published(),
          partner: VALIDATED,
          request: { ...request, model: 'PLANNED_EXPENSE' },
          now: NOW,
        }),
      'CATALOG_PLAN_NOT_APPROVED',
    );
  });

  it('refuse une activation sur brouillon, partenaire non validé ou requête divergente', () => {
    expectCode(
      () =>
        activatePartnerPlan({
          plan: plan(),
          offer: draft(),
          partner: VALIDATED,
          request: {
            planId: 'plan-1',
            offerId: OFFER_ID,
            model: 'SAVE_THEN_BUY',
          },
          now: NOW,
        }),
      'CATALOG_OFFER_NOT_PUBLISHED',
    );
    expectCode(
      () =>
        activatePartnerPlan({
          plan: plan(),
          offer: published(),
          partner: PENDING,
          request: {
            planId: 'plan-1',
            offerId: OFFER_ID,
            model: 'SAVE_THEN_BUY',
          },
          now: NOW,
        }),
      'CATALOG_PARTNER_NOT_VALIDATED',
    );
    expectCode(
      () =>
        activatePartnerPlan({
          plan: plan(),
          offer: published(),
          partner: VALIDATED,
          request: {
            planId: 'plan-autre',
            offerId: OFFER_ID,
            model: 'SAVE_THEN_BUY',
          },
          now: NOW,
        }),
      'CATALOG_PLAN_NOT_APPROVED',
    );
  });
});

describe('F-CAT-004 · filtres du catalogue', () => {
  it('filtre par univers, ville, modèle, prix et partenaire', () => {
    const phone = published();
    const housing = published({
      id: OTHER_OFFER_ID,
      partner: { id: 'partner-2', status: 'VALIDATED' },
      universe: 'HOUSING',
      models: ['PLANNED_EXPENSE'],
      cityIds: ['yaounde'],
      priceXaf: 90_000n,
    });
    const offers = [phone, housing];
    expect(filterOffers(offers, { universe: 'HOUSING' })).toEqual([housing]);
    expect(filterOffers(offers, { city: 'douala' })).toEqual([phone]);
    expect(filterOffers(offers, { model: 'PLANNED_EXPENSE' })).toEqual([
      housing,
    ]);
    expect(filterOffers(offers, { maxPriceXaf: 100_000n })).toEqual([
      housing,
    ]);
    expect(filterOffers(offers, { partnerId: 'partner-2' })).toEqual([
      housing,
    ]);
    expect(filterOffers(offers, { universe: 'HOUSING', city: 'douala' })).toEqual(
      [],
    );
  });

  it('refuse un filtre de prix non entier', () => {
    expectCode(
      () => filterOffers([], { maxPriceXaf: 90_000 as unknown as bigint }),
      'CATALOG_INVALID_REQUEST',
    );
  });

  it('refuse un univers ou une ville de filtre inconnus', () => {
    expectCode(
      () =>
        filterOffers([], {
          universe: 'OTHER' as unknown as 'TECHNOLOGY',
        }),
      'CATALOG_INVALID_REQUEST',
    );
    expectCode(
      () => filterOffers([], { city: 'bafoussam' as unknown as 'douala' }),
      'CATALOG_INVALID_REQUEST',
    );
  });
});

describe('F-CAT-005 · disponibilité avant réservation', () => {
  it('accepte une quantité dans le stock et en précommande', () => {
    expect(() => assertStockAvailable(published(), 3)).not.toThrow();
    expect(() =>
      assertStockAvailable(
        published({
          availability: { kind: 'PREORDER', leadDays: 30 },
        }),
        10,
      ),
    ).not.toThrow();
  });

  it('refuse un stock insuffisant, une quantité nulle ou un brouillon', () => {
    expectCode(
      () => assertStockAvailable(published(), 4),
      'CATALOG_STOCK_UNAVAILABLE',
    );
    expectCode(
      () => assertStockAvailable(published(), 0),
      'CATALOG_INVALID_REQUEST',
    );
    expectCode(
      () => assertStockAvailable(draft(), 1),
      'CATALOG_OFFER_NOT_PUBLISHED',
    );
  });
});
