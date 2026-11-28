import { BusinessError } from '@achat/contracts';
import { xaf } from '@achat/money';
import type { PoolClient } from 'pg';
import { uuidv7 } from '../ledger/domain';
import { appendLedgerEntry, ensureClientFundsAccount, systemAccountId } from '../ledger/entry.store';
import { appendConfirmedTransition, getPaymentAttempt, type StoredPaymentAttempt } from './attempt.store';
import { transitionAttempt } from './domain';
import type { ProviderTransaction } from './provider';

type SqlClient = Pick<PoolClient, 'query'>;

const LEDGER_IDEM_SCOPE = 'payments.confirmation';
const PROVIDER_TX_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

export type ConfirmedPayment = {
  readonly attempt: StoredPaymentAttempt;
  readonly entryId: string;
  readonly contributionId: string;
  readonly replayed: boolean;
};

type ContributionRow = { id: string; provider_tx_id: string; entry_id: string };

function invalid(message: string): never {
  throw new BusinessError('PAYMENT_INVALID_REQUEST', message);
}

function unverified(message: string): never {
  throw new BusinessError('PAYMENT_CONFIRMATION_UNVERIFIED', message);
}

async function existingContribution(client: SqlClient, attemptId: string): Promise<ContributionRow | undefined> {
  const result = await client.query<ContributionRow>(
    'SELECT id, provider_tx_id, entry_id FROM payments.contribution WHERE attempt_id = $1',
    [attemptId],
  );
  return result.rows[0];
}

async function replay(
  client: SqlClient,
  attemptId: string,
  providerTxId: string,
): Promise<ConfirmedPayment> {
  const contribution = await existingContribution(client, attemptId);
  const attempt = await getPaymentAttempt(client, attemptId);
  if (contribution === undefined || attempt === null) {
    invalid('confirmation incomplète');
  }
  if (contribution.provider_tx_id !== providerTxId) {
    throw new BusinessError('PAYMENT_ALREADY_CONFIRMED', 'tentative confirmée par une autre transaction');
  }
  return Object.freeze({
    attempt,
    entryId: contribution.entry_id,
    contributionId: contribution.id,
    replayed: true,
  });
}

/**
 * Confirme une tentative (F-SAV-002, F-PAY-002/003/004, I-6).
 *
 * `providerTransaction` DOIT être le résultat de `PaymentProvider.fetchTransaction`
 * (interrogation de l'API du prestataire), jamais le contenu d'un webhook.
 * À appeler dans une transaction : l'écriture 1200 → 2100 du client, la
 * contribution et la transition CONFIRMED sont validées ensemble ou pas du
 * tout ; la base refuse chacune sans les deux autres. Une confirmation
 * rejouée renvoie la première sans nouvel effet (I-5).
 */
export async function confirmPaymentAttempt(
  client: SqlClient,
  input: {
    readonly attemptId: string;
    readonly customerId: string;
    readonly providerTransaction: ProviderTransaction;
    readonly actorId: string;
  },
): Promise<ConfirmedPayment> {
  const tx = input.providerTransaction;
  if (!PROVIDER_TX_PATTERN.test(tx.providerTxId)) {
    unverified('identifiant de transaction du prestataire invalide');
  }
  if (tx.outcome !== 'SUCCEEDED') {
    unverified('le prestataire ne confirme pas le paiement');
  }
  if (tx.attemptId !== input.attemptId) {
    unverified('transaction rattachée à une autre tentative');
  }

  const attempt = await getPaymentAttempt(client, input.attemptId);
  if (attempt === null) {
    invalid('tentative introuvable');
  }
  if (tx.amountXaf !== attempt.amountXaf) {
    unverified('montant différent de la tentative');
  }
  if (attempt.status === 'CONFIRMED') {
    return replay(client, attempt.id, tx.providerTxId);
  }
  transitionAttempt(attempt.status, 'CONFIRMED', { providerTxVerified: true });
  if (attempt.channel === 'CASH') {
    invalid('les espèces se confirment par rapprochement, pas par ce chemin (D39)');
  }

  const clientFunds = await ensureClientFundsAccount(client, input.customerId);
  const aggregator = await systemAccountId(client, '1200');
  const amount = xaf(attempt.amountXaf);
  const entry = await appendLedgerEntry(client, {
    id: uuidv7(),
    operationType: 'PAYMENT_CONFIRMED',
    businessRefs: {
      payment_attempt_id: attempt.id,
      agreement_id: attempt.agreementId,
      channel: attempt.channel,
      provider_tx_id: tx.providerTxId,
    },
    actorId: input.actorId,
    approvers: [],
    idemScope: LEDGER_IDEM_SCOPE,
    idemKey: attempt.id,
    postings: [
      { accountId: aggregator, direction: 'DEBIT', amount },
      { accountId: clientFunds, direction: 'CREDIT', amount },
    ],
  });
  if (entry.replayed) {
    // Confirmation concurrente validée pendant l'attente du verrou de chaîne.
    return replay(client, attempt.id, tx.providerTxId);
  }

  const contributionId = uuidv7();
  await client.query(
    `INSERT INTO payments.contribution
       (id, attempt_id, channel, provider_tx_id, customer_id, amount_xaf, entry_id, confirmed_at)
     VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, now())`,
    [
      contributionId,
      attempt.id,
      attempt.channel,
      tx.providerTxId,
      input.customerId,
      attempt.amountXaf.toString(),
      entry.id,
    ],
  );
  const confirmed = await appendConfirmedTransition(client, {
    attemptId: attempt.id,
    seq: attempt.seq + 1,
    actorId: input.actorId,
  });
  return Object.freeze({ attempt: confirmed, entryId: entry.id, contributionId, replayed: false });
}
