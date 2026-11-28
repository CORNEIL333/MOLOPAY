import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_MODELS,
  AGREEMENT_STATUSES,
  agreementTermsHash,
  createAgreement,
  isAllowedTransition,
  lockAgreement,
  transitionAgreement,
  type Agreement,
  type AgreementModel,
  type AgreementStatus,
  type CreateAgreementInput,
} from './domain';

const AGREEMENT_ID = '019a9100-0000-7000-8000-000000000001';
const CUSTOMER_ID = '019a9100-0000-7000-8000-0000000000c1';
const OFFER_ID = '019a9100-0000-7000-8000-0000000000f1';
const CREATED_AT = '2026-10-31T09:00:00.000Z';

const OFFER = {
  id: OFFER_ID,
  version: 3,
  partnerId: 'partner-1',
  partnerStatus: 'VALIDATED',
  state: 'PUBLISHED',
  models: ['SAVE_THEN_BUY'],
  priceXaf: 150_000n,
} as const;

const PLAN_A = {
  id: 'plan-a',
  model: 'SAVE_THEN_BUY',
  approved: true,
  rhythm: 'WEEKLY',
  minAmountXaf: 5_000n,
  maxDurationMonths: 6,
} as const;

const PLAN_C = { ...PLAN_A, id: 'plan-c', model: 'PLANNED_EXPENSE', rhythm: 'MONTHLY' };

function inputA(overrides: Partial<Extract<CreateAgreementInput, { model: 'SAVE_THEN_BUY' }>> = {}): CreateAgreementInput {
  return {
    id: AGREEMENT_ID,
    customerId: CUSTOMER_ID,
    model: 'SAVE_THEN_BUY',
    offer: OFFER,
    plan: PLAN_A,
    durationMonths: 3,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function inputC(overrides: Partial<Extract<CreateAgreementInput, { model: 'PLANNED_EXPENSE' }>> = {}): CreateAgreementInput {
  return {
    id: AGREEMENT_ID,
    customerId: CUSTOMER_ID,
    model: 'PLANNED_EXPENSE',
    beneficiary: { id: 'landlord-1', status: 'VERIFIED' },
    targetXaf: 300_000n,
    plan: PLAN_C,
    durationMonths: 4,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: string): void {
  expect(action).toThrowError(expect.objectContaining({ code }));
}

function withStatus(
  agreement: Agreement,
  status: AgreementStatus,
  disputedFrom: Agreement['disputedFrom'] = null,
): Agreement {
  return { ...agreement, status, disputedFrom };
}

describe('F-SAV-001 · F-CAT-003 · création d’accord A', () => {
  it('F-SAV-001 crée un brouillon avec prix figé, rythme, durée et barème de sortie', () => {
    const agreement = createAgreement(inputA());
    expect(agreement.status).toBe('DRAFT');
    expect(agreement.locked).toBe(false);
    expect(agreement.terms).toMatchObject({
      model: 'SAVE_THEN_BUY',
      offerId: OFFER_ID,
      offerVersion: 3,
      targetXaf: 150_000n,
      rhythm: 'WEEKLY',
      durationMonths: 3,
      refundPolicy: 'FULL_NO_FEE',
    });
    expect(agreement.termsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('F-CAT-003 I-11 le prix figé ne suit pas une nouvelle version de l’offre', () => {
    const before = createAgreement(inputA());
    const repriced = createAgreement(
      inputA({ offer: { ...OFFER, version: 4, priceXaf: 199_000n } }),
    );
    expect(before.terms.targetXaf).toBe(150_000n);
    expect(before.terms.offerVersion).toBe(3);
    expect(repriced.termsHash).not.toBe(before.termsHash);
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.terms)).toBe(true);
  });

  it('F-CAT-003 l’empreinte change dès qu’une condition change', () => {
    const agreement = createAgreement(inputA());
    expect(agreementTermsHash(agreement.terms)).toBe(agreement.termsHash);
    expect(
      agreementTermsHash({ ...agreement.terms, targetXaf: 149_999n }),
    ).not.toBe(agreement.termsHash);
  });

  it('NF-FUN-001 accepte un prix au-delà de 2^53 sans perte', () => {
    const agreement = createAgreement(
      inputA({ offer: { ...OFFER, priceXaf: 9_007_199_254_740_993n } }),
    );
    expect(agreement.terms.targetXaf).toBe(9_007_199_254_740_993n);
  });

  it.each([
    ['offre non publiée', { ...OFFER, state: 'DRAFT' }],
    ['partenaire non validé', { ...OFFER, partnerStatus: 'PENDING' }],
    ['modèle absent de l’offre', { ...OFFER, models: ['PLANNED_EXPENSE'] }],
  ])('F-SAV-001 refuse une %s → AGREEMENT_OFFER_NOT_AVAILABLE', (_label, offer) => {
    expectCode(() => createAgreement(inputA({ offer })), 'AGREEMENT_OFFER_NOT_AVAILABLE');
  });

  it.each([
    ['plan non approuvé', { ...PLAN_A, approved: false }],
    ['plan d’un autre modèle', { ...PLAN_A, model: 'PLANNED_EXPENSE' }],
    ['rythme inconnu', { ...PLAN_A, rhythm: 'HOURLY' }],
    ['minimum supérieur à la cible', { ...PLAN_A, minAmountXaf: 150_001n }],
  ])('F-SAV-001 refuse un %s → AGREEMENT_PLAN_MISMATCH', (_label, plan) => {
    expectCode(() => createAgreement(inputA({ plan })), 'AGREEMENT_PLAN_MISMATCH');
  });

  it('F-SAV-001 refuse une durée supérieure au maximum du plan', () => {
    expectCode(
      () => createAgreement(inputA({ durationMonths: 7 })),
      'AGREEMENT_PLAN_MISMATCH',
    );
    expect(createAgreement(inputA({ durationMonths: 6 })).terms.durationMonths).toBe(6);
  });

  it.each([
    ['identifiant non v7', { id: '019a9100-0000-4000-8000-000000000001' }],
    ['client invalide', { customerId: 'client-1' }],
    ['horodatage non ISO', { createdAt: '2026-10-31 09:00' }],
    ['durée nulle', { durationMonths: 0 }],
    ['durée fractionnaire', { durationMonths: 1.5 }],
    ['D27 durée au-delà de 36 mois', { durationMonths: 37 }],
    ['prix nul', { offer: { ...OFFER, priceXaf: 0n } }],
    ['version d’offre nulle', { offer: { ...OFFER, version: 0 } }],
  ])('F-SAV-001 refuse %s → AGREEMENT_INVALID_REQUEST', (_label, overrides) => {
    expectCode(() => createAgreement(inputA(overrides)), 'AGREEMENT_INVALID_REQUEST');
  });

  it('NF-FUN-001 refuse un prix flottant', () => {
    expectCode(
      () =>
        createAgreement(
          inputA({ offer: { ...OFFER, priceXaf: 150000.5 as unknown as bigint } }),
        ),
      'AGREEMENT_INVALID_REQUEST',
    );
  });

  it('lot 10 refuse le modèle B (lot 13)', () => {
    expectCode(
      () =>
        createAgreement({
          ...inputA(),
          model: 'FINANCED_PURCHASE',
        } as unknown as CreateAgreementInput),
      'AGREEMENT_INVALID_REQUEST',
    );
  });
});

describe('F-PLN-001 · création d’objectif de dépense C', () => {
  it('F-PLN-001 crée un objectif vers un bénéficiaire vérifié', () => {
    const agreement = createAgreement(inputC());
    expect(agreement.terms).toMatchObject({
      model: 'PLANNED_EXPENSE',
      offerId: null,
      beneficiaryId: 'landlord-1',
      targetXaf: 300_000n,
      rhythm: 'MONTHLY',
    });
  });

  it('F-PLN-001 refuse un bénéficiaire non vérifié', () => {
    expectCode(
      () => createAgreement(inputC({ beneficiary: { id: 'landlord-1', status: 'PENDING' } })),
      'AGREEMENT_BENEFICIARY_NOT_VERIFIED',
    );
  });

  it('F-PLN-001 refuse une cible non positive', () => {
    expectCode(() => createAgreement(inputC({ targetXaf: -1n })), 'AGREEMENT_INVALID_REQUEST');
  });

  it('F-PLN-001 refuse un plan du modèle A', () => {
    expectCode(() => createAgreement(inputC({ plan: PLAN_A })), 'AGREEMENT_PLAN_MISMATCH');
  });
});

// CDC_05 § 5.2 : liste exhaustive des transitions attendues, par modèle.
const EXPECTED: Readonly<Record<AgreementModel, ReadonlySet<string>>> = {
  SAVE_THEN_BUY: new Set([
    'DRAFT>ACTIVE',
    'ACTIVE>FUNDED',
    'FUNDED>HANDED_OVER',
    'HANDED_OVER>CLOSED',
    'ACTIVE>CANCELLED_BY_CUSTOMER',
    'CANCELLED_BY_CUSTOMER>REFUNDED',
    'REFUNDED>CLOSED',
    'ACTIVE>DISPUTED',
    'FUNDED>DISPUTED',
    'DISPUTED>ACTIVE',
    'DISPUTED>FUNDED',
    'DISPUTED>REFUNDED',
    'ACTIVE>FROZEN',
    'FROZEN>ACTIVE',
    'FROZEN>REFUNDED',
  ]),
  PLANNED_EXPENSE: new Set([
    'DRAFT>ACTIVE',
    'ACTIVE>FUNDED',
    'FUNDED>PAID_TO_BENEFICIARY',
    'PAID_TO_BENEFICIARY>CLOSED',
    'ACTIVE>CANCELLED_BY_CUSTOMER',
    'CANCELLED_BY_CUSTOMER>REFUNDED',
    'REFUNDED>CLOSED',
    'ACTIVE>DISPUTED',
    'FUNDED>DISPUTED',
    'DISPUTED>ACTIVE',
    'DISPUTED>FUNDED',
    'DISPUTED>REFUNDED',
    'ACTIVE>FROZEN',
    'FROZEN>ACTIVE',
    'FROZEN>REFUNDED',
  ]),
};

describe('CDC_05 § 5.2 · machine à états, 100 % des paires', () => {
  for (const model of AGREEMENT_MODELS) {
    const base = createAgreement(model === 'SAVE_THEN_BUY' ? inputA() : inputC());
    for (const from of AGREEMENT_STATUSES) {
      for (const to of AGREEMENT_STATUSES) {
        const key = `${from}>${to}`;
        const allowed = EXPECTED[model].has(key);
        it(`${model} ${key} ${allowed ? 'autorisée' : 'refusée → UNAUTHORIZED_TRANSITION'}`, () => {
          expect(isAllowedTransition(model, from, to)).toBe(allowed);
          const disputedFrom =
            from === 'DISPUTED' && (to === 'ACTIVE' || to === 'FUNDED') ? to : null;
          const start = withStatus(base, from, disputedFrom);
          if (allowed) {
            expect(transitionAgreement(start, to).status).toBe(to);
          } else {
            expectCode(() => transitionAgreement(start, to), 'UNAUTHORIZED_TRANSITION');
          }
        });
      }
    }
  }

  it('refuse un état cible hors liste', () => {
    const agreement = withStatus(createAgreement(inputA()), 'ACTIVE');
    expectCode(
      () => transitionAgreement(agreement, 'PAID' as AgreementStatus),
      'UNAUTHORIZED_TRANSITION',
    );
  });

  it('les états terminaux CLOSED n’ont aucune sortie', () => {
    for (const model of AGREEMENT_MODELS) {
      for (const to of AGREEMENT_STATUSES) {
        expect(isAllowedTransition(model, 'CLOSED', to)).toBe(false);
      }
    }
  });
});

describe('CDC_05 § 5.2 · litige', () => {
  it('un litige ouvert depuis ACTIVE ne revient qu’à ACTIVE', () => {
    const active = withStatus(createAgreement(inputA()), 'ACTIVE');
    const disputed = transitionAgreement(active, 'DISPUTED');
    expect(disputed.disputedFrom).toBe('ACTIVE');
    expectCode(() => transitionAgreement(disputed, 'FUNDED'), 'UNAUTHORIZED_TRANSITION');
    const back = transitionAgreement(disputed, 'ACTIVE');
    expect(back.status).toBe('ACTIVE');
    expect(back.disputedFrom).toBeNull();
  });

  it('un litige ouvert depuis FUNDED ne revient qu’à FUNDED ou REFUNDED', () => {
    const funded = withStatus(createAgreement(inputA()), 'FUNDED');
    const disputed = transitionAgreement(funded, 'DISPUTED');
    expect(disputed.disputedFrom).toBe('FUNDED');
    expectCode(() => transitionAgreement(disputed, 'ACTIVE'), 'UNAUTHORIZED_TRANSITION');
    expect(transitionAgreement(disputed, 'FUNDED').status).toBe('FUNDED');
    expect(transitionAgreement(disputed, 'REFUNDED').status).toBe('REFUNDED');
  });
});

describe('F-SAV-003 · verrouillage', () => {
  const active = withStatus(createAgreement(inputA()), 'ACTIVE');

  it('F-SAV-003 refuse l’annulation client d’un objectif verrouillé', () => {
    const locked = lockAgreement(active);
    expect(locked.locked).toBe(true);
    expectCode(
      () => transitionAgreement(locked, 'CANCELLED_BY_CUSTOMER'),
      'AGREEMENT_LOCKED',
    );
  });

  it('F-SAV-005 annule un objectif actif non verrouillé', () => {
    expect(transitionAgreement(active, 'CANCELLED_BY_CUSTOMER').status).toBe(
      'CANCELLED_BY_CUSTOMER',
    );
  });

  it('F-SAV-003 les cas prévus passent par FROZEN puis REFUNDED, verrou conservé', () => {
    const frozen = transitionAgreement(lockAgreement(active), 'FROZEN');
    const refunded = transitionAgreement(frozen, 'REFUNDED');
    expect(refunded.status).toBe('REFUNDED');
    expect(refunded.locked).toBe(true);
  });

  it('F-SAV-003 refuse un double verrouillage et le verrou hors ACTIVE', () => {
    expectCode(() => lockAgreement(lockAgreement(active)), 'AGREEMENT_LOCKED');
    expectCode(() => lockAgreement(createAgreement(inputA())), 'UNAUTHORIZED_TRANSITION');
  });
});
