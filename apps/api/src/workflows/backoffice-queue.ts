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
  readonly unjustifiedSuspense: readonly { readonly entryId: string; readonly amountXaf: string; readonly direction: string }[];
  readonly openRiskAlerts: readonly { readonly alertId: string; readonly rule: string; readonly subjectType: string; readonly detectedAt: string }[];
  readonly overdueComplaints: readonly { readonly complaintId: string; readonly reference: string; readonly beyondMaximum: boolean }[];
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
 * D62 / F-BO-003 / F-BO-004 : file de travail du back-office, un seul
 * instantané, consultation motivée et journalisée dans l'audit chaîné (même
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
  });
}
