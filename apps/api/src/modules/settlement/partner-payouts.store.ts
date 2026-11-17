import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

export type PartnerPayoutStatus = 'PREPARED' | 'APPROVED' | 'REJECTED' | 'INSTRUCTED' | 'EXECUTED' | 'EXECUTION_REJECTED';

/** F-PRT-004 : règlement vu par le gérant ; aucun identifiant du personnel. */
export type PartnerPayout = {
  readonly payoutId: string;
  readonly agreementId: string;
  readonly grossXaf: string;
  readonly commissionXaf: string;
  readonly netXaf: string;
  readonly status: PartnerPayoutStatus;
  readonly executedAt: string | null;
  readonly bankReference: string | null;
};

const MAX_PAYOUTS = 200;

/**
 * F-PRT-003/004 / D63 : règlements du seul partenaire donné, état dérivé des
 * étapes en ajout seul (préparation, décision, instruction, exécution).
 * Montants entiers XAF lus en texte (jamais de flottant).
 */
export async function listPartnerPayouts(client: SqlClient, partnerId: string): Promise<readonly PartnerPayout[]> {
  const rows = await client.query<{
    id: string; agreement_id: string; gross: string; commission: string; net: string; status: PartnerPayoutStatus; executed_at: Date | null; bank_reference: string | null;
  }>(
    `SELECT p.id, p.agreement_id, p.gross_xaf::text AS gross, p.commission_xaf::text AS commission, p.net_xaf::text AS net,
            CASE
              WHEN x.outcome = 'EXECUTED' THEN 'EXECUTED'
              WHEN x.outcome = 'REJECTED' THEN 'EXECUTION_REJECTED'
              WHEN i.payout_id IS NOT NULL THEN 'INSTRUCTED'
              WHEN d.decision = 'APPROVED' THEN 'APPROVED'
              WHEN d.decision = 'REJECTED' THEN 'REJECTED'
              ELSE 'PREPARED'
            END AS status,
            CASE WHEN x.outcome = 'EXECUTED' THEN x.recorded_at END AS executed_at,
            CASE WHEN x.outcome = 'EXECUTED' THEN x.bank_reference END AS bank_reference
       FROM settlement.payout p
       LEFT JOIN settlement.payout_decision d ON d.payout_id = p.id
       LEFT JOIN settlement.payout_instruction i ON i.payout_id = p.id
       LEFT JOIN settlement.payout_execution x ON x.payout_id = p.id
      WHERE p.partner_id = $1
      ORDER BY p.prepared_at DESC, p.id DESC
      LIMIT ${MAX_PAYOUTS.toString()}`,
    [partnerId],
  );
  return rows.rows.map((row) =>
    Object.freeze({
      payoutId: row.id,
      agreementId: row.agreement_id,
      grossXaf: row.gross,
      commissionXaf: row.commission,
      netXaf: row.net,
      status: row.status,
      executedAt: row.executed_at === null ? null : row.executed_at.toISOString(),
      bankReference: row.bank_reference,
    }),
  );
}
