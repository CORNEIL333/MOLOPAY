import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import { createAuditEvent, genesisAuditPrevHash } from '../audit/domain';
import {
  createOffer,
  publishOffer,
  type ApprovedPaymentPlan,
  type Offer,
  type Partner,
} from './domain';
import { activatePartnerPlanAudited } from './plan-audit';

const OFFER_ID = '019a9000-0000-7000-8000-000000000001';
const AUDIT_ID = '019a9000-0000-7000-8000-0000000000e1';
const NOW = '2026-10-28T10:00:00.000Z';
const VALIDATED: Partner = { id: 'partner-1', status: 'VALIDATED' };

const OFFER: Offer = publishOffer(
  createOffer({
    id: OFFER_ID,
    partner: VALIDATED,
    universe: 'TECHNOLOGY',
    models: ['SAVE_THEN_BUY', 'FINANCED_PURCHASE'],
    cityIds: ['douala'],
    priceXaf: 150_000n,
    availability: { kind: 'IN_STOCK', units: 3 },
    warranty: 'Garantie 12 mois',
    discountTerms: 'Remise de 5 % dès 50 % versés',
  }),
);

const PLAN: ApprovedPaymentPlan = {
  id: 'plan-1',
  offerId: OFFER_ID,
  partnerId: 'partner-1',
  model: 'SAVE_THEN_BUY',
  platformApproved: true,
  lenderApprovalRef: null,
};

function attempt(
  request: Readonly<Record<string, unknown>>,
  plan: ApprovedPaymentPlan = PLAN,
): ReturnType<typeof activatePartnerPlanAudited> {
  return activatePartnerPlanAudited({
    plan,
    offer: OFFER,
    partner: VALIDATED,
    request,
    now: NOW,
    audit: { id: AUDIT_ID, actorId: 'partner-staff-1' },
  });
}

const VALID_REQUEST = { planId: 'plan-1', offerId: OFFER_ID, model: 'SAVE_THEN_BUY' };

describe('F-CAT-002 · activation de plan journalisée', () => {
  it('F-CAT-002 journalise une activation réussie', () => {
    const outcome = attempt(VALID_REQUEST);
    expect(outcome.ok).toBe(true);
    expect(outcome.event).toEqual({
      id: AUDIT_ID,
      ts: NOW,
      eventType: 'CATALOG_ACTION',
      actorId: 'partner-staff-1',
      action: 'PLAN_ACTIVATED',
      targetType: 'PARTNER',
      targetId: 'partner-1',
      outcome: 'SUCCESS',
      refs: { plan_id: 'plan-1', offer_id: OFFER_ID, model: 'SAVE_THEN_BUY' },
    });
    expect(() => createAuditEvent(outcome.event, 1, genesisAuditPrevHash())).not.toThrow();
  });

  it('F-CAT-002 refuse et journalise une condition de crédit fournie par le partenaire', () => {
    const outcome = attempt({ ...VALID_REQUEST, rate: '0.35' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toBeInstanceOf(BusinessError);
    expect(outcome.error.code).toBe('CATALOG_FIELD_FORBIDDEN');
    expect(outcome.event.action).toBe('PLAN_ACTIVATION_DENIED');
    expect(outcome.event.outcome).toBe('DENIED');
    expect(outcome.event.refs).toEqual({
      plan_id: 'plan-1',
      offer_id: OFFER_ID,
      model: 'SAVE_THEN_BUY',
      error_code: 'CATALOG_FIELD_FORBIDDEN',
    });
    expect(() => createAuditEvent(outcome.event, 1, genesisAuditPrevHash())).not.toThrow();
  });

  it('F-CAT-002 refuse et journalise un plan non approuvé par la plateforme', () => {
    const outcome = attempt(VALID_REQUEST, { ...PLAN, platformApproved: false });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('CATALOG_PLAN_NOT_APPROVED');
    expect(outcome.event.refs?.['error_code']).toBe('CATALOG_PLAN_NOT_APPROVED');
  });

  it('F-CAT-002 refuse et journalise un plan B sans approbation du financeur', () => {
    const outcome = attempt(
      { planId: 'plan-1', offerId: OFFER_ID, model: 'FINANCED_PURCHASE' },
      { ...PLAN, model: 'FINANCED_PURCHASE', lenderApprovalRef: null },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('CATALOG_PLAN_NOT_APPROVED');
    expect(outcome.event.refs?.['model']).toBe('FINANCED_PURCHASE');
  });

  it('SEC-LOG · aucune donnée fournie par le partenaire n’entre dans le journal', () => {
    const outcome = attempt({
      planId: 'plan-1\n{"forged":true}',
      offerId: OFFER_ID,
      model: 'SAVE_THEN_BUY',
      '<script>': 'x'.repeat(1000),
    });
    expect(outcome.ok).toBe(false);
    const serialized = JSON.stringify(outcome.event);
    expect(serialized).not.toContain('forged');
    expect(serialized).not.toContain('<script>');
    expect(serialized).not.toContain('xxxx');
  });

  it('F-CAT-002 un identifiant d’audit invalide est une erreur, pas un refus journalisé', () => {
    expect(() =>
      activatePartnerPlanAudited({
        plan: PLAN,
        offer: OFFER,
        partner: VALIDATED,
        request: VALID_REQUEST,
        now: NOW,
        audit: { id: 'pas-un-uuid', actorId: 'partner-staff-1' },
      }),
    ).toThrowError(expect.objectContaining({ code: 'CATALOG_INVALID_REQUEST' }));
  });

  it('F-CAT-002 un horodatage invalide est une erreur, pas un refus journalisé', () => {
    expect(() =>
      activatePartnerPlanAudited({
        plan: PLAN,
        offer: OFFER,
        partner: VALIDATED,
        request: VALID_REQUEST,
        now: '2026-10-28 10:00',
        audit: { id: AUDIT_ID, actorId: 'partner-staff-1' },
      }),
    ).toThrowError(expect.objectContaining({ code: 'CATALOG_INVALID_REQUEST' }));
  });

  it('F-CAT-002 le journal refuse une clé non déclarée pour PLAN_ACTIVATED', () => {
    const outcome = attempt(VALID_REQUEST);
    expect(() =>
      createAuditEvent(
        { ...outcome.event, refs: { ...outcome.event.refs, rate: '0.35' } },
        1,
        genesisAuditPrevHash(),
      ),
    ).toThrowError(expect.objectContaining({ code: 'AUDIT_REFS_FORBIDDEN' }));
  });
});
