import { describe, expect, it } from 'vitest';
import { agreementFromRow, agreementSigningPayload } from './agreement.store';
import { createAgreement } from './domain';

const AGREEMENT = createAgreement({
  id: '019a9100-0000-7000-8000-000000000001',
  customerId: '019a9100-0000-7000-8000-0000000000c1',
  model: 'SAVE_THEN_BUY',
  offer: {
    id: '019a9100-0000-7000-8000-0000000000f1',
    version: 1,
    partnerId: 'partner-1',
    partnerStatus: 'VALIDATED',
    state: 'PUBLISHED',
    models: ['SAVE_THEN_BUY'],
    priceXaf: 9_007_199_254_740_993n,
  },
  plan: {
    id: 'plan-a',
    model: 'SAVE_THEN_BUY',
    approved: true,
    rhythm: 'WEEKLY',
    minAmountXaf: 5_000n,
    maxDurationMonths: 6,
  },
  durationMonths: 3,
  createdAt: '2026-10-31T09:00:00.000Z',
});

function row(overrides: Record<string, unknown> = {}): Parameters<typeof agreementFromRow>[0] {
  const t = AGREEMENT.terms;
  return {
    id: t.agreementId,
    customer_id: t.customerId,
    model: t.model,
    offer_id: t.offerId,
    offer_version: t.offerVersion,
    partner_id: t.partnerId,
    beneficiary_id: t.beneficiaryId,
    target_xaf: '9007199254740993',
    plan_id: t.planId,
    rhythm: t.rhythm,
    min_amount_xaf: '5000',
    duration_months: t.durationMonths,
    refund_policy: t.refundPolicy,
    terms_hash: Buffer.from(AGREEMENT.termsHash, 'hex'),
    created_at: new Date('2026-10-31T09:00:01.234Z'),
    status: 'ACTIVE',
    locked: false,
    seq: 1,
    disputed_from: null,
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: string): void {
  expect(action).toThrowError(expect.objectContaining({ code }));
}

describe('F-CAT-003 · relecture des accords stockés', () => {
  it('F-CAT-003 relit un accord sans perte de précision et recalcule l’empreinte', () => {
    const stored = agreementFromRow(row());
    expect(stored.agreement.terms.targetXaf).toBe(9_007_199_254_740_993n);
    expect(stored.agreement.termsHash).toBe(AGREEMENT.termsHash);
    expect(stored.agreement.createdAt).toBe('2026-10-31T09:00:01.234Z');
    expect(stored.seq).toBe(1);
  });

  it.each([
    ['un prix modifié', { target_xaf: '1' }],
    ['une durée modifiée', { duration_months: 4 }],
    ['une empreinte absente', { terms_hash: null }],
  ])('I-11 détecte %s → AGREEMENT_INVALID_REQUEST', (_label, overrides) => {
    expectCode(() => agreementFromRow(row(overrides)), 'AGREEMENT_INVALID_REQUEST');
  });

  it.each([
    ['un statut hors liste', { status: 'PAID' }],
    ['un rythme hors liste', { rhythm: 'HOURLY' }],
    ['un montant décimal', { target_xaf: '150000.5' }],
    ['un litige sans origine', { status: 'DISPUTED', disputed_from: null }],
  ])('refuse %s → AGREEMENT_INVALID_REQUEST', (_label, overrides) => {
    expectCode(() => agreementFromRow(row(overrides)), 'AGREEMENT_INVALID_REQUEST');
  });

  it('CDC_05 restitue l’origine d’un litige', () => {
    const stored = agreementFromRow(row({ status: 'DISPUTED', disputed_from: 'FUNDED' }));
    expect(stored.agreement.disputedFrom).toBe('FUNDED');
  });
});

describe('INT-NR-001 · message signé par l’appareil', () => {
  const base = {
    agreementId: AGREEMENT.terms.agreementId,
    termsHash: AGREEMENT.termsHash,
    from: 'DRAFT',
    to: 'ACTIVE',
    seq: 1,
  } as const;

  it('INT-NR-001 est déterministe et séparé par domaine', () => {
    const payload = agreementSigningPayload(base).toString('utf8');
    expect(payload).toBe(agreementSigningPayload(base).toString('utf8'));
    expect(JSON.parse(payload)).toMatchObject({ domain: 'agreement-transition-v1' });
  });

  it.each([
    ['le rang', { seq: 2 }],
    ['la transition', { to: 'CANCELLED_BY_CUSTOMER' as const }],
    ['l’empreinte des conditions', { termsHash: '0'.repeat(64) }],
  ])('INT-NR-001 change avec %s', (_label, overrides) => {
    expect(agreementSigningPayload({ ...base, ...overrides }).equals(agreementSigningPayload(base))).toBe(false);
  });
});
