import type { components } from '@achat/contracts/api';

export type Offer = components['schemas']['Offer'];

export function offerFixture(overrides: Partial<Offer> = {}): Offer {
  return {
    offerId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    title: 'Réfrigérateur 220 L',
    partnerId: 'partner-yaounde-01',
    partnerName: 'Maison Fraîche',
    universe: 'ESSENTIALS',
    models: ['SAVE_THEN_BUY'],
    cities: ['yaounde'],
    priceXaf: '250000',
    availability: { kind: 'IN_STOCK', units: 10 },
    warranty: '24 mois',
    discountTerms: '',
    status: 'PUBLISHED',
    ...overrides,
  };
}

export const secondOffer = offerFixture({
  offerId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
  title: 'Téléphone 128 Go',
  universe: 'TECHNOLOGY',
  models: ['SAVE_THEN_BUY', 'FINANCED_PURCHASE'],
  cities: ['douala'],
  priceXaf: '180000',
  availability: { kind: 'PREORDER', leadDays: 15 },
});

export type Quote = components['schemas']['Quote'];

export function quoteFixture(overrides: Partial<Quote> = {}): Quote {
  return {
    quoteId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60',
    offerId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    model: 'SAVE_THEN_BUY',
    totalXaf: '260000',
    feesXaf: '10000',
    installments: [
      { dueDate: '2026-11-15', amountXaf: '65000' },
      { dueDate: '2026-12-15', amountXaf: '65000' },
      { dueDate: '2027-01-15', amountXaf: '65000' },
      { dueDate: '2027-02-15', amountXaf: '65000' },
    ],
    expiresAt: '2026-10-26T18:00:00.000Z',
    ...overrides,
  };
}

export type Goal = components['schemas']['Goal'];

export function goalFixture(overrides: Partial<Goal> = {}): Goal {
  return {
    goalId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a80',
    offerId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    offerTitle: 'Réfrigérateur 220 L',
    partnerName: 'Maison Fraîche',
    status: 'ACTIVE',
    targetXaf: '260000',
    savedXaf: '65000',
    progressBasisPoints: 2500,
    installmentAmountXaf: '65000',
    rhythm: 'MONTHLY',
    nextDueDate: '2026-11-15',
    handoverCodeAvailable: false,
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-25T09:00:00.000Z',
    ...overrides,
  };
}

export type Contribution = components['schemas']['Contribution'];

export function contributionFixture(
  overrides: Partial<Contribution> = {},
): Contribution {
  return {
    contributionId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a90',
    amountXaf: '65000',
    status: 'CONFIRMED',
    confirmedAt: '2026-10-25T10:30:00.000Z',
    receiptNumber: 'REC-2026-0001',
    ...overrides,
  };
}

export type HandoverCode = components['schemas']['HandoverCode'];

export function handoverCodeFixture(
  overrides: Partial<HandoverCode> = {},
): HandoverCode {
  return {
    code: '482913',
    expiresAt: '2026-10-26T20:15:00.000Z',
    status: 'ACTIVE',
    ...overrides,
  };
}

export type ClaimReceipt = components['schemas']['ClaimReceipt'];

export function claimReceiptFixture(
  overrides: Partial<ClaimReceipt> = {},
): ClaimReceipt {
  return {
    claimId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aa0',
    status: 'OPEN',
    createdAt: '2026-10-26T12:00:00.000Z',
    ...overrides,
  };
}
