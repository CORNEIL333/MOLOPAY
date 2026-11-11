import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import {
  decideClassification,
  getClassificationProposal,
  proposeClassification,
  type GapClassification,
} from '../modules/reconciliation/classification.store';
import { approveSuspenseJustification, proposeSuspenseJustification } from '../modules/reconciliation/suspense.store';

type SqlClient = Pick<PoolClient, 'query'>;

/** D54 / INT-REC-003 : proposition de classe d'un écart (CLASSIFY_RECONCILIATION_GAP). */
export async function proposeGapClassification(
  client: SqlClient,
  input: { readonly id: string; readonly incidentId: string; readonly classification: GapClassification; readonly explanation: string; readonly principal: AdminPrincipal },
): Promise<void> {
  assertAuthorized(input.principal, 'CLASSIFY_RECONCILIATION_GAP', {});
  await proposeClassification(client, {
    id: input.id,
    incidentId: input.incidentId,
    classification: input.classification,
    explanation: input.explanation,
    actorId: input.principal.actorId,
  });
}

/** D54 / INT-REC-003 / I-7 : validation par une autre personne (CLASSIFY_RECONCILIATION_GAP). */
export async function decideGapClassification(
  client: SqlClient,
  input: { readonly proposalId: string; readonly decision: 'APPROVED' | 'REJECTED'; readonly reason?: string; readonly principal: AdminPrincipal },
): Promise<void> {
  assertAuthorized(input.principal, 'CLASSIFY_RECONCILIATION_GAP', {});
  const proposal = await getClassificationProposal(client, input.proposalId);
  if (proposal === null) {
    throw new BusinessError('RECONCILIATION_NOT_FOUND', 'proposition introuvable');
  }
  await decideClassification(client, { proposal, decision: input.decision, reason: input.reason, actorId: input.principal.actorId });
}

/** D55 / INT-REC-005 : justification d'une écriture du suspens 2900 (proposition). */
export async function proposeSuspenseLineJustification(
  client: SqlClient,
  input: { readonly entryId: string; readonly explanation: string; readonly principal: AdminPrincipal },
): Promise<void> {
  assertAuthorized(input.principal, 'CLASSIFY_RECONCILIATION_GAP', {});
  await proposeSuspenseJustification(client, { entryId: input.entryId, explanation: input.explanation, actorId: input.principal.actorId });
}

/** D55 / INT-REC-005 / I-7 : validation par une autre personne. */
export async function approveSuspenseLineJustification(
  client: SqlClient,
  input: { readonly entryId: string; readonly principal: AdminPrincipal },
): Promise<void> {
  assertAuthorized(input.principal, 'CLASSIFY_RECONCILIATION_GAP', {});
  await approveSuspenseJustification(client, { entryId: input.entryId, actorId: input.principal.actorId });
}
