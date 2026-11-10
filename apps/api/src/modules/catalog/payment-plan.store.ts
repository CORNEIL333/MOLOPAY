import { BusinessError } from '@achat/contracts';
import { parseXaf, xaf } from '@achat/money';
import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

const PLAN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// D26 : A et C seulement ; B (achat financé) est fermé jusqu'au lot 13.
export const PLAN_MODELS = ['SAVE_THEN_BUY', 'PLANNED_EXPENSE'] as const;
export type PlanModel = (typeof PLAN_MODELS)[number];
// F-SAV-001.
export const PLAN_RHYTHMS = ['DAILY', 'WEEKLY', 'MONTHLY', 'FREE'] as const;
export type PlanRhythm = (typeof PLAN_RHYTHMS)[number];
// D27 : durée en mois, 1 à 36.
export const MAX_PLAN_DURATION_MONTHS = 36;

/** Conditions d'un plan défini par la plateforme : aucun frais ni taux (D26). */
export type PaymentPlanTerms = {
  readonly planId: string;
  readonly model: PlanModel;
  readonly rhythm: PlanRhythm;
  readonly minAmountXaf: bigint;
  readonly maxDurationMonths: number;
};

export type StoredPaymentPlan = PaymentPlanTerms & {
  readonly approvalRequestId: string;
  readonly approvedAt: string;
};

function invalid(message: string): never {
  throw new BusinessError('CATALOG_INVALID_REQUEST', message);
}

function assertTerms(terms: PaymentPlanTerms): void {
  if (!PLAN_ID_PATTERN.test(terms.planId)) {
    invalid('identifiant de plan invalide');
  }
  if (!(PLAN_MODELS as readonly string[]).includes(terms.model)) {
    invalid('modèle de plan non ouvert');
  }
  if (!(PLAN_RHYTHMS as readonly string[]).includes(terms.rhythm)) {
    invalid('rythme inconnu');
  }
  if (xaf(terms.minAmountXaf).amount <= 0n) {
    invalid('montant minimal strictement positif attendu');
  }
  if (
    !Number.isSafeInteger(terms.maxDurationMonths) ||
    terms.maxDurationMonths < 1 ||
    terms.maxDurationMonths > MAX_PLAN_DURATION_MONTHS
  ) {
    invalid('durée maximale entre 1 et 36 mois');
  }
}

/**
 * Charge à soumettre en demande PAYMENT_PLAN (FINANCE prépare, COMPLIANCE
 * approuve). Liste blanche stricte ; montants et durée en texte décimal pour
 * une empreinte JCS sans ambiguïté.
 */
export function paymentPlanApprovalPayload(terms: PaymentPlanTerms): Record<string, string> {
  assertTerms(terms);
  return {
    plan_id: terms.planId,
    model: terms.model,
    rhythm: terms.rhythm,
    min_amount_xaf: terms.minAmountXaf.toString(),
    max_duration_months: terms.maxDurationMonths.toString(),
  };
}

/**
 * Inscrit un plan au registre après approbation. La base revérifie la
 * demande (type, décision, deux personnes) et que la charge approuvée porte
 * exactement ces conditions.
 */
export async function recordApprovedPaymentPlan(
  client: SqlClient,
  input: { readonly terms: PaymentPlanTerms; readonly approvalRequestId: string },
): Promise<void> {
  assertTerms(input.terms);
  if (!UUID_PATTERN.test(input.approvalRequestId)) {
    invalid('demande d’approbation : UUID attendu');
  }
  await client.query(
    `INSERT INTO catalog.payment_plan
       (id, model, rhythm, min_amount_xaf, max_duration_months, approval_request_id, approved_at)
     VALUES ($1, $2, $3, $4::bigint, $5, $6, now())`,
    [
      input.terms.planId,
      input.terms.model,
      input.terms.rhythm,
      input.terms.minAmountXaf.toString(),
      input.terms.maxDurationMonths,
      input.approvalRequestId,
    ],
  );
}

export async function getPaymentPlan(client: SqlClient, planId: string): Promise<StoredPaymentPlan | null> {
  const result = await client.query<{
    id: string;
    model: PlanModel;
    rhythm: PlanRhythm;
    min_amount_xaf: string;
    max_duration_months: number;
    approval_request_id: string;
    approved_at: Date;
  }>(
    `SELECT id, model, rhythm, min_amount_xaf::text, max_duration_months, approval_request_id, approved_at
       FROM catalog.payment_plan WHERE id = $1`,
    [planId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  return Object.freeze({
    planId: row.id,
    model: row.model,
    rhythm: row.rhythm,
    minAmountXaf: parseXaf(row.min_amount_xaf).amount,
    maxDurationMonths: row.max_duration_months,
    approvalRequestId: row.approval_request_id,
    approvedAt: row.approved_at.toISOString(),
  });
}
