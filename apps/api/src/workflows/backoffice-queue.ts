import type { PoolClient } from 'pg';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { appendAuditEvent } from '../modules/audit/audit.store';

type SqlClient = Pick<PoolClient, 'query'>;

export type BackofficeQueue = {
  readonly asOf: string;
  readonly refunds: readonly { readonly refundId: string; readonly kind: string; readonly amountXaf: string; readonly stage: string; readonly preparedBy: string }[];
  readonly beneficiaryPayouts: readonly { readonly payoutId: string; readonly amountXaf: string; readonly stage: string; readonly preparedBy: string }[];
  readonly settlements: readonly { readonly payoutId: string; readonly netXaf: string; readonly stage: string; readonly preparedBy: string }[];
  readonly overdueInstructions: readonly { readonly kind: string; readonly instructionId: string; readonly instructedAt: string }[];
  readonly gapsToEscalate: readonly { readonly incidentId: string; readonly gapXaf: string; readonly openedAt: string }[];
  /** C6 / D54 : propositions de classement en attente d'une seconde personne (l'explication n'est pas reprise). */
  readonly pendingGapClassifications: readonly { readonly proposalId: string; readonly incidentId: string; readonly classification: string; readonly proposedBy: string; readonly proposedAt: string }[];
  /** C6 / D56 : litiges ouverts, à lever par une autre personne que celle qui les a ouverts. */
  readonly openDisputes: readonly { readonly disputeId: string; readonly agreementId: string; readonly openedBy: string; readonly openedAt: string }[];
  readonly unjustifiedSuspense: readonly { readonly entryId: string; readonly amountXaf: string; readonly direction: string }[];
  readonly openRiskAlerts: readonly { readonly alertId: string; readonly rule: string; readonly subjectType: string; readonly detectedAt: string }[];
  readonly overdueComplaints: readonly { readonly complaintId: string; readonly reference: string; readonly beyondMaximum: boolean }[];
  /** D75 / REG-LBC-002 : rapprochements à examiner (sans nom ni référence listée : le détail exige READ_IDENTITY_DOCUMENT, D74). */
  readonly pendingSanctionsReviews: readonly { readonly screeningId: string; readonly subjectType: string; readonly screenedAt: string }[];
};

/** Étape suivante d'un circuit maker-checker de sortie de fonds (lecture). */
const STAGE_SQL = (table: string, decision: string, instruction: string, execution: string, key: string): string => `
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM ${decision} d WHERE d.${key} = t.id) THEN 'AWAITING_DECISION'
    WHEN NOT EXISTS (SELECT 1 FROM ${instruction} i WHERE i.${key} = t.id) THEN 'AWAITING_INSTRUCTION'
    ELSE 'AWAITING_EXECUTION'
  END AS stage
  FROM ${table} t
  WHERE NOT EXISTS (SELECT 1 FROM ${execution} x WHERE x.${key} = t.id)
    AND NOT EXISTS (SELECT 1 FROM ${decision} r WHERE r.${key} = t.id AND r.decision = 'REJECTED')`;

/**
 * D62 / F-BO-003 / F-BO-004 : file de travail du back-office (sections lues
 * par des requêtes successives en READ COMMITTED, pas un instantané unique :
 * l'audit ajouté dans la même transaction l'interdit), consultation motivée et journalisée dans l'audit chaîné (même
 * transaction). Seuls des identifiants internes, montants et états.
 */
export async function readBackofficeQueue(client: SqlClient, principal: AdminPrincipal, reason: string): Promise<BackofficeQueue> {
  assertAuthorized(principal, 'READ_FINANCIAL_HISTORY', { reason });
  await appendAuditEvent(client, {
    eventType: 'FINANCIAL_HISTORY_READ',
    actorId: principal.actorId,
    action: 'READ_FINANCIAL_HISTORY',
    targetType: 'BACKOFFICE_QUEUE',
    targetId: 'queue',
    outcome: 'SUCCESS',
    reason,
  });
  const now = (await client.query<{ now: Date }>('SELECT statement_timestamp() AS now')).rows[0]?.now ?? new Date(0);
  const refunds = await client.query<{ id: string; kind: string; amount: string; stage: string; prepared_by: string }>(
    `SELECT t.id, t.kind, t.amount_xaf::text AS amount, t.prepared_by, ${STAGE_SQL('settlement.refund', 'settlement.refund_decision', 'settlement.refund_instruction', 'settlement.refund_execution', 'refund_id')}
     ORDER BY t.prepared_at`,
  );
  const payouts = await client.query<{ id: string; amount: string; stage: string; prepared_by: string }>(
    `SELECT t.id, t.amount_xaf::text AS amount, t.prepared_by, ${STAGE_SQL('settlement.beneficiary_payout', 'settlement.beneficiary_payout_decision', 'settlement.beneficiary_payout_instruction', 'settlement.beneficiary_payout_execution', 'payout_id')}
     ORDER BY t.prepared_at`,
  );
  const settlements = await client.query<{ id: string; net: string; stage: string; prepared_by: string }>(
    `SELECT t.id, t.net_xaf::text AS net, t.prepared_by, ${STAGE_SQL('settlement.payout', 'settlement.payout_decision', 'settlement.payout_instruction', 'settlement.payout_execution', 'payout_id')}
     ORDER BY t.prepared_at`,
  );
  const overdue = await client.query<{ kind: string; instruction_id: string; instructed_at: Date }>(
    'SELECT kind, instruction_id, instructed_at FROM settlement.overdue_outgoing_instructions($1)',
    [now],
  );
  const gaps = await client.query<{ id: string; gap_xaf: string; opened_at: Date }>(
    'SELECT id, gap_xaf::text, opened_at FROM reconciliation.incidents_to_escalate($1)',
    [now],
  );
  const suspense = await client.query<{ entry_id: string; amount_xaf: string; direction: string }>(
    'SELECT entry_id, amount_xaf::text, direction FROM reconciliation.unjustified_suspense_lines($1)',
    [now],
  );
  const alerts = await client.query<{ id: string; rule: string; subject_type: string; detected_at: Date }>(
    `SELECT a.id, a.rule, a.subject_type, a.detected_at FROM risk.alert a
      WHERE NOT EXISTS (SELECT 1 FROM risk.alert_decision d WHERE d.alert_id = a.id) ORDER BY a.detected_at`,
  );
  const complaints = await client.query<{ complaint_id: string; reference: string; beyond_maximum: boolean }>(
    'SELECT complaint_id, reference, beyond_maximum FROM disputes.overdue_complaints($1)',
    [now],
  );
  const proposals = await client.query<{ id: string; incident_id: string; classification: string; proposed_by: string; proposed_at: Date }>(
    `SELECT p.id, p.incident_id, p.classification, p.proposed_by, p.proposed_at FROM reconciliation.classification_proposal p
      WHERE NOT EXISTS (SELECT 1 FROM reconciliation.classification_decision d WHERE d.proposal_id = p.id)
      ORDER BY p.proposed_at, p.id`,
  );
  const disputes = await client.query<{ id: string; agreement_id: string; opened_by: string; opened_at: Date }>(
    `SELECT d.id, d.agreement_id, d.opened_by, d.opened_at FROM disputes.dispute d
      WHERE NOT EXISTS (SELECT 1 FROM disputes.dispute_resolution r WHERE r.dispute_id = d.id)
      ORDER BY d.opened_at, d.id`,
  );
  const screenings = await client.query<{ id: string; subject_type: string; screened_at: Date }>(
    `SELECT s.id, s.subject_type, s.screened_at FROM kyc.screening s
      WHERE s.outcome = 'POTENTIAL_MATCH' AND NOT EXISTS (SELECT 1 FROM kyc.screening_review r WHERE r.screening_id = s.id)
      ORDER BY s.screened_at, s.id`,
  );
  return Object.freeze({
    asOf: now.toISOString(),
    refunds: refunds.rows.map((row) => ({ refundId: row.id, kind: row.kind, amountXaf: row.amount, stage: row.stage, preparedBy: row.prepared_by })),
    beneficiaryPayouts: payouts.rows.map((row) => ({ payoutId: row.id, amountXaf: row.amount, stage: row.stage, preparedBy: row.prepared_by })),
    settlements: settlements.rows.map((row) => ({ payoutId: row.id, netXaf: row.net, stage: row.stage, preparedBy: row.prepared_by })),
    overdueInstructions: overdue.rows.map((row) => ({ kind: row.kind, instructionId: row.instruction_id, instructedAt: row.instructed_at.toISOString() })),
    gapsToEscalate: gaps.rows.map((row) => ({ incidentId: row.id, gapXaf: row.gap_xaf, openedAt: row.opened_at.toISOString() })),
    unjustifiedSuspense: suspense.rows.map((row) => ({ entryId: row.entry_id, amountXaf: row.amount_xaf, direction: row.direction })),
    openRiskAlerts: alerts.rows.map((row) => ({ alertId: row.id, rule: row.rule, subjectType: row.subject_type, detectedAt: row.detected_at.toISOString() })),
    overdueComplaints: complaints.rows.map((row) => ({ complaintId: row.complaint_id, reference: row.reference, beyondMaximum: row.beyond_maximum })),
    pendingGapClassifications: proposals.rows.map((row) => ({ proposalId: row.id, incidentId: row.incident_id, classification: row.classification, proposedBy: row.proposed_by, proposedAt: row.proposed_at.toISOString() })),
    openDisputes: disputes.rows.map((row) => ({ disputeId: row.id, agreementId: row.agreement_id, openedBy: row.opened_by, openedAt: row.opened_at.toISOString() })),
    pendingSanctionsReviews: screenings.rows.map((row) => ({ screeningId: row.id, subjectType: row.subject_type, screenedAt: row.screened_at.toISOString() })),
  });
}
