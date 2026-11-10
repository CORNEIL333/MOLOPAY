import type { components } from '@achat/contracts/api';
import { BusinessError } from '@achat/contracts';
import { parseXaf } from '@achat/money';
import type { PoolClient } from 'pg';
import { getPublicOffer } from '../catalog/public-offer.store';
import { uuidv7 } from '../ledger/domain';
import {
  createPlannedExpenseAgreement,
  createSaveThenBuyAgreement,
  getAgreement,
  type StoredAgreement,
} from './agreement.store';

type SqlClient = Pick<PoolClient, 'query'>;
export type Goal = components['schemas']['Goal'];
export type GoalRequest = components['schemas']['GoalRequest'];

// D23 : identifiant technique provisoire, en attendant le texte juridique approuvé.
export const CURRENT_TERMS_VERSION = '2026-10-26-v1';

const REQUEST_KEYS = new Set(['model', 'offerId', 'beneficiaryId', 'targetXaf', 'planId', 'durationMonths', 'acceptTermsVersion']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function invalid(message: string): never {
  throw new BusinessError('AGREEMENT_INVALID_REQUEST', message);
}

/** D32 : liste blanche stricte du corps de création ; champs propres au modèle. */
export function parseGoalRequest(body: unknown): GoalRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid('corps JSON objet attendu');
  }
  const value = body as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!REQUEST_KEYS.has(key)) {
      invalid(`champ non autorisé : ${key}`);
    }
  }
  const { model, offerId, beneficiaryId, targetXaf, planId, durationMonths, acceptTermsVersion } = value;
  if (typeof planId !== 'string' || typeof acceptTermsVersion !== 'string') {
    invalid('planId et acceptTermsVersion requis');
  }
  if (typeof durationMonths !== 'number' || !Number.isSafeInteger(durationMonths)) {
    invalid('durationMonths entier requis');
  }
  if (model === 'SAVE_THEN_BUY') {
    if (typeof offerId !== 'string' || beneficiaryId !== undefined || targetXaf !== undefined) {
      invalid('modèle A : offerId seul, ni bénéficiaire ni cible');
    }
    return { model, offerId, planId, durationMonths, acceptTermsVersion };
  }
  if (model === 'PLANNED_EXPENSE') {
    if (typeof beneficiaryId !== 'string' || typeof targetXaf !== 'string' || offerId !== undefined) {
      invalid('modèle C : beneficiaryId et targetXaf, sans offre');
    }
    return { model, beneficiaryId, targetXaf, planId, durationMonths, acceptTermsVersion };
  }
  return invalid('modèle non ouvert (A ou C)');
}

async function presentation(client: SqlClient, offerId: string | null): Promise<{ title: string | null; partnerName: string | null }> {
  if (offerId === null) {
    return { title: null, partnerName: null };
  }
  try {
    const offer = await getPublicOffer(client, offerId);
    return { title: offer.title, partnerName: offer.partnerName };
  } catch (error: unknown) {
    // Offre retirée du catalogue public depuis : l'objectif reste consultable.
    // Toute autre erreur remonte (une erreur SQL a déjà annulé la transaction).
    if (error instanceof BusinessError && error.code.endsWith('_NOT_FOUND')) {
      return { title: null, partnerName: null };
    }
    throw error;
  }
}

/** Objectif tel qu'exposé au client ; versé et progression dérivés du grand livre (I-9). */
export async function goalFromStored(client: SqlClient, stored: StoredAgreement): Promise<Goal> {
  const { agreement } = stored;
  const t = agreement.terms;
  const funds = await client.query<{ funds: string; updated_at: Date | null }>(
    `SELECT agreements.confirmed_funds_xaf($1)::text AS funds,
            (SELECT max(e.created_at) FROM agreements.status_event e WHERE e.agreement_id = $1) AS updated_at`,
    [t.agreementId],
  );
  const saved = parseXaf(funds.rows[0]?.funds ?? '0').amount;
  const progress = t.targetXaf === 0n ? 0n : (saved * 10_000n) / t.targetXaf;
  const shown = await presentation(client, t.offerId);
  return {
    goalId: t.agreementId,
    model: t.model,
    status: agreement.status,
    locked: agreement.locked,
    offerId: t.offerId,
    offerTitle: shown.title,
    partnerName: shown.partnerName,
    beneficiaryId: t.beneficiaryId,
    planId: t.planId,
    rhythm: t.rhythm,
    minAmountXaf: t.minAmountXaf.toString(),
    durationMonths: t.durationMonths,
    targetXaf: t.targetXaf.toString(),
    savedXaf: saved.toString(),
    progressBasisPoints: Number(progress > 10_000n ? 10_000n : progress),
    createdAt: agreement.createdAt,
    updatedAt: (funds.rows[0]?.updated_at ?? new Date(agreement.createdAt)).toISOString(),
  };
}

/** Objectif du seul client donné ; un objectif d'un autre client est « introuvable ». */
export async function getGoalForCustomer(client: SqlClient, customerId: string, goalId: string): Promise<Goal> {
  const stored = UUID_PATTERN.test(goalId) ? await getAgreement(client, goalId) : null;
  if (stored === null || stored.agreement.terms.customerId !== customerId) {
    throw new BusinessError('AGREEMENT_NOT_FOUND', 'Objectif introuvable');
  }
  return goalFromStored(client, stored);
}

export async function listGoalsForCustomer(client: SqlClient, customerId: string): Promise<Goal[]> {
  const ids = await client.query<{ id: string }>(
    'SELECT id FROM agreements.agreement WHERE customer_id = $1 ORDER BY created_at DESC, id',
    [customerId],
  );
  const goals: Goal[] = [];
  for (const row of ids.rows) {
    goals.push(await getGoalForCustomer(client, customerId, row.id));
  }
  return goals;
}

/**
 * D32 : crée un objectif en BROUILLON. L'activation (signature d'appareil +
 * PIN, INT-NR-001) est une route distincte. Plan, prix et bénéficiaire sont
 * lus en base ; la base revérifie tout.
 */
export async function createGoalDraft(client: SqlClient, customerId: string, request: GoalRequest): Promise<Goal> {
  if (request.acceptTermsVersion !== CURRENT_TERMS_VERSION) {
    throw new BusinessError('AGREEMENT_INVALID_REQUEST', 'version des conditions non courante');
  }
  const id = uuidv7();
  const createdAt = new Date().toISOString();
  const stored =
    request.model === 'SAVE_THEN_BUY'
      ? await createSaveThenBuyAgreement(client, {
          id,
          customerId,
          offerId: request.offerId ?? invalid('offerId requis'),
          planId: request.planId,
          durationMonths: request.durationMonths,
          createdAt,
        })
      : await createPlannedExpenseAgreement(client, {
          id,
          customerId,
          beneficiaryId: request.beneficiaryId ?? invalid('beneficiaryId requis'),
          targetXaf: parseXaf(request.targetXaf ?? invalid('targetXaf requis')).amount,
          planId: request.planId,
          durationMonths: request.durationMonths,
          createdAt,
        });
  return goalFromStored(client, stored);
}
