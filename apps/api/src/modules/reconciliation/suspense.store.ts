import { BusinessError } from '@achat/contracts';
import { parseXaf } from '@achat/money';
import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

const ACTOR_PATTERN = /^[^\s]{1,200}$/;

export type SuspenseLine = {
  readonly entryId: string;
  readonly seq: number;
  readonly recordedAt: string;
  readonly direction: 'D' | 'C';
  readonly amountXaf: bigint;
};

function invalid(message: string): never {
  throw new BusinessError('RECONCILIATION_INVALID_REQUEST', message);
}

/** INT-REC-005 : solde du suspens à la clôture et lignes encore non justifiées. */
export async function readMonthEndSuspense(
  client: SqlClient,
  at: Date,
): Promise<{ readonly balanceXaf: bigint; readonly unjustified: readonly SuspenseLine[] }> {
  if (Number.isNaN(at.getTime())) {
    invalid('date de clôture invalide');
  }
  const balance = await client.query<{ balance: string }>('SELECT reconciliation.suspense_balance_at($1)::text AS balance', [at]);
  const lines = await client.query<{ entry_id: string; seq: string; recorded_at: Date; direction: 'D' | 'C'; amount_xaf: string }>(
    'SELECT entry_id, seq::text, recorded_at, direction, amount_xaf::text FROM reconciliation.unjustified_suspense_lines($1)',
    [at],
  );
  return Object.freeze({
    balanceXaf: BigInt(balance.rows[0]?.balance ?? '0'),
    unjustified: lines.rows.map((row) =>
      Object.freeze({
        entryId: row.entry_id,
        seq: Number(row.seq),
        recordedAt: row.recorded_at.toISOString(),
        direction: row.direction,
        amountXaf: parseXaf(row.amount_xaf).amount,
      }),
    ),
  });
}

/** INT-REC-005 : proposition de justification d'une écriture du suspens. */
export async function proposeSuspenseJustification(
  client: SqlClient,
  input: { readonly entryId: string; readonly explanation: string; readonly actorId: string },
): Promise<void> {
  const explanation = input.explanation.trim();
  if (explanation.length === 0 || explanation.length > 1000 || !ACTOR_PATTERN.test(input.actorId)) {
    invalid('explication (1 à 1000 caractères) ou acteur invalide');
  }
  const existing = await client.query('SELECT 1 FROM reconciliation.suspense_justification WHERE entry_id = $1', [input.entryId]);
  if ((existing.rowCount ?? 0) > 0) {
    throw new BusinessError('RECONCILIATION_ALREADY_CLASSIFIED', 'justification déjà proposée');
  }
  await client.query(
    `INSERT INTO reconciliation.suspense_justification (entry_id, explanation, proposed_by, proposed_at) VALUES ($1, $2, $3, now())`,
    [input.entryId, explanation, input.actorId],
  );
}

/** INT-REC-005 / I-7 : validation par une autre personne. */
export async function approveSuspenseJustification(
  client: SqlClient,
  input: { readonly entryId: string; readonly actorId: string },
): Promise<void> {
  const proposal = await client.query<{ proposed_by: string; approved: boolean }>(
    `SELECT j.proposed_by,
            EXISTS (SELECT 1 FROM reconciliation.suspense_justification_approval x WHERE x.entry_id = j.entry_id) AS approved
       FROM reconciliation.suspense_justification j WHERE j.entry_id = $1`,
    [input.entryId],
  );
  const row = proposal.rows[0];
  if (row === undefined) {
    throw new BusinessError('RECONCILIATION_NOT_FOUND', 'justification introuvable');
  }
  if (row.approved) {
    throw new BusinessError('RECONCILIATION_ALREADY_DECIDED', 'justification déjà validée');
  }
  if (row.proposed_by === input.actorId) {
    throw new BusinessError('MAKER_CANNOT_APPROVE', 'la validation exige une autre personne');
  }
  await client.query(
    `INSERT INTO reconciliation.suspense_justification_approval (entry_id, approved_by, approved_at) VALUES ($1, $2, now())`,
    [input.entryId, input.actorId],
  );
}
