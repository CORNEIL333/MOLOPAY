import { BusinessError } from '@achat/contracts';
import { parseXaf, xaf } from '@achat/money';
import type { PoolClient } from 'pg';
import { uuidv7 } from '../ledger/domain';
import { appendLedgerEntry, ensurePartnerFundsAccount, systemAccountId } from '../ledger/entry.store';

type SqlClient = Pick<PoolClient, 'query'>;

const ACTOR_PATTERN = /^[^\s]{1,200}$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type Payout = {
  readonly payoutId: string;
  readonly agreementId: string;
  readonly partnerId: string;
  readonly grossXaf: bigint;
  readonly commissionBps: number;
  readonly commissionXaf: bigint;
  readonly netXaf: bigint;
  readonly preparedBy: string;
  readonly decision: 'APPROVED' | 'REJECTED' | null;
};

type PayoutRow = {
  id: string;
  agreement_id: string;
  partner_id: string;
  gross_xaf: string;
  commission_bps: number;
  commission_xaf: string;
  net_xaf: string;
  prepared_by: string;
  decision: 'APPROVED' | 'REJECTED' | null;
};

function invalid(message: string): never {
  throw new BusinessError('SETTLEMENT_INVALID_REQUEST', message);
}

function fromRow(row: PayoutRow): Payout {
  return Object.freeze({
    payoutId: row.id,
    agreementId: row.agreement_id,
    partnerId: row.partner_id,
    grossXaf: parseXaf(row.gross_xaf).amount,
    commissionBps: row.commission_bps,
    commissionXaf: parseXaf(row.commission_xaf).amount,
    netXaf: parseXaf(row.net_xaf).amount,
    preparedBy: row.prepared_by,
    decision: row.decision,
  });
}

const SELECT_PAYOUT = `
  SELECT p.id, p.agreement_id, p.partner_id, p.gross_xaf::text, p.commission_bps,
         p.commission_xaf::text, p.net_xaf::text, p.prepared_by, d.decision
    FROM settlement.payout p LEFT JOIN settlement.payout_decision d ON d.payout_id = p.id`;

export async function getPayout(client: SqlClient, payoutId: string): Promise<Payout | null> {
  const result = await client.query<PayoutRow>(`${SELECT_PAYOUT} WHERE p.id = $1`, [payoutId]);
  const row = result.rows[0];
  return row === undefined ? null : fromRow(row);
}

/**
 * F-SET-002 : prépare le règlement d'une remise. La base calcule brut,
 * commission et net à partir des paramètres publiés et refuse avant la fin
 * du délai de contestation ou si une réclamation a suivi la remise.
 * L'autorisation (rôle, ville) est vérifiée par le flux appelant.
 */
export async function insertPayout(
  client: SqlClient,
  input: { readonly id: string; readonly agreementId: string; readonly actorId: string },
): Promise<Payout> {
  if (!UUID_V7_PATTERN.test(input.id) || !ACTOR_PATTERN.test(input.actorId)) {
    invalid('identifiant ou acteur invalide');
  }
  const existing = await client.query('SELECT 1 FROM settlement.payout WHERE agreement_id = $1', [input.agreementId]);
  if ((existing.rowCount ?? 0) > 0) {
    throw new BusinessError('SETTLEMENT_ALREADY_PREPARED', 'règlement déjà préparé pour cette remise');
  }
  // Montants fournis à zéro : la base les recalcule tous.
  await client.query(
    `INSERT INTO settlement.payout
       (id, agreement_id, partner_id, gross_xaf, commission_bps, commission_xaf, net_xaf, prepared_by, prepared_at)
     VALUES ($1, $2, '-', 1, 0, 0, 1, $3, now())`,
    [input.id, input.agreementId, input.actorId],
  );
  const stored = await getPayout(client, input.id);
  if (stored === null) {
    invalid('règlement introuvable après préparation');
  }
  return stored;
}

/**
 * F-SET-003 : décision par une autre personne que le préparateur (I-7).
 * L'approbation passe l'écriture de commission (débit 2200 du marchand,
 * crédit 7100) dans la même transaction ; un refus exige un motif.
 * `partnerLedgerOwnerId` est lu dans le catalogue par le flux appelant (D42).
 */
export async function insertPayoutDecision(
  client: SqlClient,
  input: {
    readonly payout: Payout;
    readonly actorId: string;
    readonly decision: 'APPROVED' | 'REJECTED';
    readonly reason?: string | undefined;
    readonly partnerLedgerOwnerId: string;
  },
): Promise<{ readonly status: 'APPROVED' | 'REJECTED'; readonly commissionEntryId: string | null }> {
  const { payout } = input;
  if (!ACTOR_PATTERN.test(input.actorId)) {
    invalid('acteur invalide');
  }
  if (payout.decision !== null) {
    throw new BusinessError('SETTLEMENT_ALREADY_DECIDED', 'règlement déjà décidé');
  }
  if (payout.preparedBy === input.actorId) {
    throw new BusinessError('MAKER_CANNOT_APPROVE', 'le préparateur ne peut pas décider');
  }
  const reason = input.reason?.trim() ?? '';
  if (input.decision === 'REJECTED' && reason.length === 0) {
    invalid('un refus exige un motif');
  }
  let commissionEntryId: string | null = null;
  if (input.decision === 'APPROVED' && payout.commissionXaf > 0n) {
    const partnerAccount = await ensurePartnerFundsAccount(client, input.partnerLedgerOwnerId);
    const revenue = await systemAccountId(client, '7100');
    const amount = xaf(payout.commissionXaf);
    const entry = await appendLedgerEntry(client, {
      id: uuidv7(),
      operationType: 'FEE_CHARGED',
      businessRefs: { payout_id: payout.payoutId, agreement_id: payout.agreementId },
      actorId: input.actorId,
      approvers: [],
      idemScope: 'settlement.commission',
      idemKey: payout.payoutId,
      postings: [
        { accountId: partnerAccount, direction: 'DEBIT', amount },
        { accountId: revenue, direction: 'CREDIT', amount },
      ],
    });
    commissionEntryId = entry.id;
  }
  await client.query(
    `INSERT INTO settlement.payout_decision (payout_id, decision, decided_by, reason, commission_entry_id, decided_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [payout.payoutId, input.decision, input.actorId, reason.length === 0 ? null : reason, commissionEntryId],
  );
  return Object.freeze({ status: input.decision, commissionEntryId });
}
