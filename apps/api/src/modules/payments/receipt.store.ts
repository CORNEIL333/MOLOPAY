import { BusinessError } from '@achat/contracts';
import { parseXaf } from '@achat/money';
import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Reçu d'un versement (F-PAY-006, D39) : numéro continu propre au client et
 * début de l'empreinte de l'écriture du grand livre, pour la vérification.
 */
export type Receipt = {
  readonly receiptNo: number;
  readonly attemptId: string;
  readonly agreementId: string;
  readonly channel: string;
  readonly amountXaf: bigint;
  readonly confirmedAt: string;
  readonly entryHashPrefix: string;
};

/** Reçus du seul client donné, dans l'ordre de leur numéro. */
export async function listReceipts(client: SqlClient, customerId: string): Promise<Receipt[]> {
  if (!UUID_PATTERN.test(customerId)) {
    throw new BusinessError('PAYMENT_INVALID_REQUEST', 'client : UUID attendu');
  }
  const result = await client.query<{
    receipt_no: number;
    attempt_id: string;
    agreement_id: string;
    channel: string;
    amount_xaf: string;
    confirmed_at: Date;
    entry_hash_prefix: string;
  }>(
    `SELECT receipt_no, attempt_id, agreement_id, channel, amount_xaf, confirmed_at, entry_hash_prefix
       FROM payments.receipt WHERE customer_id = $1 ORDER BY receipt_no`,
    [customerId],
  );
  return result.rows.map((row) => ({
    receiptNo: row.receipt_no,
    attemptId: row.attempt_id,
    agreementId: row.agreement_id,
    channel: row.channel,
    amountXaf: parseXaf(row.amount_xaf).amount,
    confirmedAt: row.confirmed_at.toISOString(),
    entryHashPrefix: row.entry_hash_prefix,
  }));
}

/** F-PAY-006 : versement confirmé d'un accord, tel que montré à son client. */
export type ContributionItem = {
  readonly contributionId: string;
  readonly amountXaf: string;
  readonly status: 'CONFIRMED' | 'REVERSED';
  readonly confirmedAt: string;
  readonly receiptNumber: string;
};

/**
 * Versements confirmés d'un accord du client donné, dans l'ordre des reçus.
 * Un versement dont l'écriture a été contre-passée est marqué REVERSED
 * (l'écriture d'origine n'est jamais modifiée, I-2).
 */
export async function listContributionsForAgreement(
  client: SqlClient,
  input: { readonly customerId: string; readonly agreementId: string },
): Promise<ContributionItem[]> {
  if (!UUID_PATTERN.test(input.customerId) || !UUID_PATTERN.test(input.agreementId)) {
    throw new BusinessError('PAYMENT_INVALID_REQUEST', 'client ou accord : UUID attendu');
  }
  const result = await client.query<{ id: string; amount_xaf: string; confirmed_at: Date; receipt_no: number; reversed: boolean }>(
    `SELECT c.id, c.amount_xaf::text AS amount_xaf, c.confirmed_at, c.receipt_no,
            EXISTS (SELECT 1 FROM ledger.journal_entry r WHERE r.reverses_entry_id = c.entry_id) AS reversed
       FROM payments.contribution c
       JOIN payments.payment_attempt a ON a.id = c.attempt_id
      WHERE c.customer_id = $1 AND a.agreement_id = $2
      ORDER BY c.receipt_no`,
    [input.customerId, input.agreementId],
  );
  return result.rows.map((row) => ({
    contributionId: row.id,
    amountXaf: parseXaf(row.amount_xaf).amount.toString(),
    status: row.reversed ? 'REVERSED' : 'CONFIRMED',
    confirmedAt: row.confirmed_at.toISOString(),
    receiptNumber: row.receipt_no.toString(),
  }));
}
