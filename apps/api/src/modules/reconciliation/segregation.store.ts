import { BusinessError } from '@achat/contracts';
import { parseXaf } from '@achat/money';
import type { PoolClient } from 'pg';
import { uuidv7 } from '../ledger/domain';
import { segregationGap } from './domain';

type SqlClient = Pick<PoolClient, 'query'>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_UTC_MS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ACTOR_ID_PATTERN = /^[^\s]{1,200}$/;

export type SegregationCheckResult = {
  readonly checkId: string;
  readonly thirdPartyFundsXaf: bigint;
  readonly incomingInTransitXaf: bigint;
  readonly gapXaf: bigint;
  readonly ledgerSeq: number;
  readonly incidentId: string | null;
};

export type EscalatedIncident = {
  readonly id: string;
  readonly checkId: string;
  readonly gapXaf: bigint;
  readonly openedAt: string;
};

function invalid(message: string): never {
  throw new BusinessError('RECONCILIATION_INVALID_REQUEST', message);
}

/**
 * INT-REC-002 : enregistre un contrôle de cantonnement. Seuls le relevé et
 * les règlements sortants en transit viennent de l'appelant ; la base dérive
 * le reste du grand livre (I-9) et ouvre l'incident si l'écart n'est pas nul.
 */
export async function recordSegregationCheck(
  client: SqlClient,
  input: {
    readonly statementDate: string;
    readonly statementBalanceXaf: bigint;
    readonly outgoingInTransitXaf: bigint;
    readonly actorId: string;
  },
): Promise<SegregationCheckResult> {
  if (!DATE_PATTERN.test(input.statementDate) || Number.isNaN(Date.parse(input.statementDate))) {
    invalid('date de relevé AAAA-MM-JJ attendue');
  }
  if (!ACTOR_ID_PATTERN.test(input.actorId)) {
    invalid('acteur invalide');
  }
  // Contrôle des montants saisis avant la base (refus explicite).
  segregationGap({
    thirdPartyFundsXaf: 0n,
    statementBalanceXaf: input.statementBalanceXaf,
    incomingInTransitXaf: 0n,
    outgoingInTransitXaf: input.outgoingInTransitXaf,
  });
  const id = uuidv7();
  const inserted = await client.query<{
    third_party_funds_xaf: string;
    incoming_in_transit_xaf: string;
    gap_xaf: string;
    ledger_seq: string;
  }>(
    `INSERT INTO reconciliation.segregation_check
       (id, statement_date, statement_balance_xaf, outgoing_in_transit_xaf,
        third_party_funds_xaf, incoming_in_transit_xaf, gap_xaf, actor_id, checked_at)
     VALUES ($1, $2::date, $3::bigint, $4::bigint, 0, 0, $3::bigint - $4::bigint, $5, now())
     RETURNING third_party_funds_xaf::text, incoming_in_transit_xaf::text, gap_xaf::text, ledger_seq::text`,
    [
      id,
      input.statementDate,
      input.statementBalanceXaf.toString(),
      input.outgoingInTransitXaf.toString(),
      input.actorId,
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined) {
    invalid('contrôle non enregistré');
  }
  const incident = await client.query<{ id: string }>(
    'SELECT id FROM reconciliation.incident WHERE check_id = $1',
    [id],
  );
  return Object.freeze({
    checkId: id,
    thirdPartyFundsXaf: parseXaf(row.third_party_funds_xaf).amount,
    incomingInTransitXaf: parseXaf(row.incoming_in_transit_xaf).amount,
    gapXaf: parseXaf(row.gap_xaf).amount,
    ledgerSeq: Number(row.ledger_seq),
    incidentId: incident.rows[0]?.id ?? null,
  });
}

/** INT-REC-004 : incidents non classés ouverts depuis plus de 48 h à `at`. */
export async function listIncidentsToEscalate(client: SqlClient, at: string): Promise<EscalatedIncident[]> {
  if (!ISO_UTC_MS_PATTERN.test(at) || Number.isNaN(Date.parse(at))) {
    invalid('instant ISO 8601 UTC attendu');
  }
  const result = await client.query<{ id: string; check_id: string; gap_xaf: string; opened_at: Date }>(
    'SELECT id, check_id, gap_xaf::text, opened_at FROM reconciliation.incidents_to_escalate($1::timestamptz)',
    [at],
  );
  return result.rows.map((row) => ({
    id: row.id,
    checkId: row.check_id,
    gapXaf: parseXaf(row.gap_xaf).amount,
    openedAt: row.opened_at.toISOString(),
  }));
}
