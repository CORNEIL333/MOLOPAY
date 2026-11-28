import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

export type GapClassification = 'IN_TRANSIT' | 'FEES' | 'DUPLICATE' | 'UNKNOWN';
const CLASSIFICATIONS: readonly GapClassification[] = ['IN_TRANSIT', 'FEES', 'DUPLICATE', 'UNKNOWN'];
const ACTOR_PATTERN = /^[^\s]{1,200}$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ClassificationProposal = {
  readonly proposalId: string;
  readonly incidentId: string;
  readonly classification: GapClassification;
  readonly proposedBy: string;
  readonly decision: 'APPROVED' | 'REJECTED' | null;
};

function invalid(message: string): never {
  throw new BusinessError('RECONCILIATION_INVALID_REQUEST', message);
}

function text(value: string | undefined, label: string): string {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0 || trimmed.length > 1000) {
    invalid(`${label} (1 à 1000 caractères) attendu`);
  }
  return trimmed;
}

/** INT-REC-003 : proposition de classe pour un écart, avec son explication. */
export async function proposeClassification(
  client: SqlClient,
  input: { readonly id: string; readonly incidentId: string; readonly classification: GapClassification; readonly explanation: string; readonly actorId: string },
): Promise<void> {
  if (!UUID_V7_PATTERN.test(input.id) || !ACTOR_PATTERN.test(input.actorId) || !CLASSIFICATIONS.includes(input.classification)) {
    invalid('identifiant, acteur ou classe invalide');
  }
  const explanation = text(input.explanation, 'explication');
  const incident = await client.query('SELECT 1 FROM reconciliation.incident WHERE id = $1', [input.incidentId]);
  if ((incident.rowCount ?? 0) === 0) {
    throw new BusinessError('RECONCILIATION_NOT_FOUND', 'écart introuvable');
  }
  const blocking = await client.query(
    `SELECT 1 FROM reconciliation.classification_proposal p
       LEFT JOIN reconciliation.classification_decision d ON d.proposal_id = p.id
      WHERE p.incident_id = $1 AND (d.proposal_id IS NULL OR d.decision = 'APPROVED')`,
    [input.incidentId],
  );
  if ((blocking.rowCount ?? 0) > 0) {
    throw new BusinessError('RECONCILIATION_ALREADY_CLASSIFIED', 'classement en attente ou validé');
  }
  await client.query(
    `INSERT INTO reconciliation.classification_proposal (id, incident_id, classification, explanation, proposed_by, proposed_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [input.id, input.incidentId, input.classification, explanation, input.actorId],
  );
}

export async function getClassificationProposal(client: SqlClient, proposalId: string): Promise<ClassificationProposal | null> {
  const result = await client.query<{
    id: string; incident_id: string; classification: GapClassification; proposed_by: string; decision: 'APPROVED' | 'REJECTED' | null;
  }>(
    `SELECT p.id, p.incident_id, p.classification, p.proposed_by, d.decision
       FROM reconciliation.classification_proposal p
       LEFT JOIN reconciliation.classification_decision d ON d.proposal_id = p.id
      WHERE p.id = $1`,
    [proposalId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : Object.freeze({
        proposalId: row.id,
        incidentId: row.incident_id,
        classification: row.classification,
        proposedBy: row.proposed_by,
        decision: row.decision,
      });
}

/** INT-REC-003 / I-7 : validation ou refus motivé par une autre personne. */
export async function decideClassification(
  client: SqlClient,
  input: { readonly proposal: ClassificationProposal; readonly decision: 'APPROVED' | 'REJECTED'; readonly reason?: string | undefined; readonly actorId: string },
): Promise<void> {
  if (input.proposal.decision !== null) {
    throw new BusinessError('RECONCILIATION_ALREADY_DECIDED', 'proposition déjà décidée');
  }
  if (input.proposal.proposedBy === input.actorId) {
    throw new BusinessError('MAKER_CANNOT_APPROVE', 'la validation exige une autre personne');
  }
  const reason = input.decision === 'REJECTED' ? text(input.reason, 'motif de refus') : null;
  await client.query(
    `INSERT INTO reconciliation.classification_decision (proposal_id, decision, reason, decided_by, decided_at)
     VALUES ($1, $2, $3, $4, now())`,
    [input.proposal.proposalId, input.decision, reason, input.actorId],
  );
}
