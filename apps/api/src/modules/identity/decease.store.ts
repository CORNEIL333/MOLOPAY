import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * C19 / F-ACC-007 (tranche 1) : dossier de décès d'un client. La base ancre
 * la déclaration (compte connu, date non future, un seul dossier ouvert ou
 * approuvé) et applique la décision (déclarant ≠ décideur, une seule fois ;
 * à l'approbation : blocage définitif, appareils et sessions révoqués,
 * objectifs actifs gelés, dans la même transaction). Migration 0077.
 */
export async function declareDecease(
  client: SqlClient,
  input: { readonly id: string; readonly accountId: string; readonly deathDate: string; readonly certificateSha256: string; readonly reason: string; readonly actorId: string },
): Promise<{ readonly caseId: string; readonly declaredAt: string }> {
  const row = (await client.query<{ declared_at: Date }>(
    `INSERT INTO identity.decease_case (id, account_id, death_date, certificate_sha256, reason, declared_by, declared_at)
     VALUES ($1, $2, $3::date, decode($4, 'hex'), $5, $6, now())
     RETURNING declared_at`,
    [input.id, input.accountId, input.deathDate, input.certificateSha256, input.reason, input.actorId],
  )).rows[0];
  return { caseId: input.id, declaredAt: (row?.declared_at ?? new Date(0)).toISOString() };
}

export async function decideDecease(
  client: SqlClient,
  input: { readonly caseId: string; readonly decision: 'APPROVED' | 'REJECTED'; readonly reason?: string; readonly actorId: string },
): Promise<{ readonly accountId: string; readonly frozenGoals: number }> {
  const row = (await client.query<{ account_id: string; frozen_goals: number }>(
    `WITH decided AS (
       INSERT INTO identity.decease_decision (case_id, decision, decided_by, reason, frozen_goals, decided_at)
       VALUES ($1, $2, $3, $4, 0, now())
       RETURNING case_id, frozen_goals
     )
     SELECT c.account_id, d.frozen_goals FROM decided d JOIN identity.decease_case c ON c.id = d.case_id`,
    [input.caseId, input.decision, input.actorId, input.reason ?? null],
  )).rows[0];
  if (row === undefined) throw new Error('IDENTITY_DECEASE_CASE_NOT_FOUND: dossier de décès inconnu');
  return { accountId: row.account_id, frozenGoals: row.frozen_goals };
}
