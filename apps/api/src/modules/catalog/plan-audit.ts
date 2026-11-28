import { BusinessError } from '@achat/contracts';
import { type AuditEventDraft } from '../audit/domain';
import { activatePartnerPlan, type PlanActivation } from './domain';

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACTOR_ID_PATTERN = /^[^\s]{1,200}$/;
const ISO_UTC_MS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type ActivationInput = Parameters<typeof activatePartnerPlan>[0];

export type AuditedPlanActivation =
  | {
      readonly ok: true;
      readonly activation: PlanActivation;
      readonly event: AuditEventDraft;
    }
  | {
      readonly ok: false;
      readonly error: BusinessError;
      readonly event: AuditEventDraft;
    };

/**
 * Active un plan et produit l'événement d'audit, succès comme refus
 * (F-CAT-002 : « refusée et journalisée »). L'appelant écrit l'événement
 * avant de renvoyer l'erreur, y compris quand la transaction métier échoue.
 * Les références viennent du plan et de l'offre lus côté serveur : aucune
 * valeur fournie par le partenaire n'entre dans le journal.
 */
export function activatePartnerPlanAudited(
  input: ActivationInput & {
    readonly audit: { readonly id: string; readonly actorId: string };
  },
): AuditedPlanActivation {
  if (!UUID_V7_PATTERN.test(input.audit.id)) {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'audit.id doit être un UUID v7');
  }
  if (!ACTOR_ID_PATTERN.test(input.audit.actorId)) {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'audit.actorId invalide');
  }
  if (
    typeof input.now !== 'string' ||
    !ISO_UTC_MS_PATTERN.test(input.now) ||
    Number.isNaN(new Date(input.now).getTime()) ||
    new Date(input.now).toISOString() !== input.now
  ) {
    throw new BusinessError('CATALOG_INVALID_REQUEST', 'now doit être ISO 8601 UTC');
  }
  const base = {
    id: input.audit.id,
    ts: input.now,
    eventType: 'CATALOG_ACTION' as const,
    actorId: input.audit.actorId,
    targetType: 'PARTNER',
    targetId: input.partner.id,
  };
  const refs = {
    plan_id: input.plan.id,
    offer_id: input.offer.id,
    model: input.plan.model,
  };
  try {
    const activation = activatePartnerPlan(input);
    return {
      ok: true,
      activation,
      event: { ...base, action: 'PLAN_ACTIVATED', outcome: 'SUCCESS', refs },
    };
  } catch (error: unknown) {
    if (!(error instanceof BusinessError)) {
      throw error;
    }
    return {
      ok: false,
      error,
      event: {
        ...base,
        action: 'PLAN_ACTIVATION_DENIED',
        outcome: 'DENIED',
        refs: { ...refs, error_code: error.code },
      },
    };
  }
}
