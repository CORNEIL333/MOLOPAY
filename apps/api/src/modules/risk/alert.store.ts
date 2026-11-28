import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import type { RiskFinding } from './domain';

type SqlClient = Pick<PoolClient, 'query'>;

const ACTOR_PATTERN = /^[^\s]{1,200}$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type SubjectType = 'CUSTOMER' | 'PARTNER';

export type RiskAlert = {
  readonly alertId: string;
  readonly rule: RiskFinding['rule'];
  readonly subjectType: SubjectType;
  readonly subjectId: string;
  readonly evidence: RiskFinding['evidence'];
  readonly decision: 'DISMISSED' | 'CONFIRMED' | null;
};

function invalid(message: string): never {
  throw new BusinessError('RISK_INVALID_REQUEST', message);
}

/**
 * Écrit l'alerte et ses preuves, sauf si une alerte de la même règle est déjà
 * ouverte pour ce sujet (la base l'impose aussi, sous verrou).
 */
export async function recordAlert(
  client: SqlClient,
  input: { readonly id: string; readonly finding: RiskFinding; readonly subjectType: SubjectType; readonly subjectId: string; readonly actorId: string },
): Promise<'CREATED' | 'ALREADY_OPEN'> {
  if (!UUID_V7_PATTERN.test(input.id) || !ACTOR_PATTERN.test(input.actorId)) {
    invalid('identifiant ou acteur invalide');
  }
  const open = await client.query(
    `SELECT 1 FROM risk.alert a
      WHERE a.rule = $1 AND a.subject_type = $2 AND a.subject_id = $3
        AND NOT EXISTS (SELECT 1 FROM risk.alert_decision d WHERE d.alert_id = a.id)`,
    [input.finding.rule, input.subjectType, input.subjectId],
  );
  if ((open.rowCount ?? 0) > 0) {
    return 'ALREADY_OPEN';
  }
  await client.query(
    `INSERT INTO risk.alert (id, rule, subject_type, subject_id, evidence, detected_by, detected_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, now())`,
    [input.id, input.finding.rule, input.subjectType, input.subjectId, JSON.stringify(input.finding.evidence), input.actorId],
  );
  return 'CREATED';
}

export async function getAlert(client: SqlClient, alertId: string): Promise<RiskAlert | null> {
  const result = await client.query<{
    id: string; rule: RiskFinding['rule']; subject_type: SubjectType; subject_id: string;
    evidence: RiskFinding['evidence']; decision: 'DISMISSED' | 'CONFIRMED' | null;
  }>(
    `SELECT a.id, a.rule, a.subject_type, a.subject_id, a.evidence, d.decision
       FROM risk.alert a LEFT JOIN risk.alert_decision d ON d.alert_id = a.id WHERE a.id = $1`,
    [alertId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : Object.freeze({
        alertId: row.id,
        rule: row.rule,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        evidence: row.evidence,
        decision: row.decision,
      });
}

/** SEC-FRD-002 : décision tracée, motivée ; aucune sanction appliquée ici. */
export async function recordAlertDecision(
  client: SqlClient,
  input: { readonly alert: RiskAlert; readonly decision: 'DISMISSED' | 'CONFIRMED'; readonly reason: string; readonly actorId: string },
): Promise<void> {
  if (input.alert.decision !== null) {
    throw new BusinessError('RISK_ALERT_ALREADY_DECIDED', 'alerte déjà décidée');
  }
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > 1000 || !ACTOR_PATTERN.test(input.actorId)) {
    invalid('motif (1 à 1000 caractères) ou acteur invalide');
  }
  await client.query(
    `INSERT INTO risk.alert_decision (alert_id, decision, reason, decided_by, decided_at) VALUES ($1, $2, $3, $4, now())`,
    [input.alert.alertId, input.decision, reason, input.actorId],
  );
}
