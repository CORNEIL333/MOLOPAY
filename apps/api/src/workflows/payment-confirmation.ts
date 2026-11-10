import type { PoolClient } from 'pg';
import { markAgreementFundedIfComplete } from '../modules/agreements/agreement.store';
import { confirmPaymentAttempt, type ConfirmedPayment } from '../modules/payments/confirmation.store';
import type { ProviderTransaction } from '../modules/payments/provider';
import { notifyCustomer } from './notify';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * Flux « versement confirmé » (F-SAV-002, I-6) : orchestre deux modules par
 * leurs interfaces publiques, sans que `payments` dépende d'`agreements`
 * (CDC_05 § 3). À appeler dans UNE transaction : écriture du grand livre,
 * contribution, CONFIRMED et, à 100 %, FUNDED sont validés ensemble.
 */
export async function confirmPaymentAndFundAgreement(
  client: SqlClient,
  input: {
    readonly attemptId: string;
    readonly customerId: string;
    readonly providerTransaction: ProviderTransaction;
    readonly actorId: string;
  },
): Promise<ConfirmedPayment & { readonly agreementFunded: boolean }> {
  const confirmed = await confirmPaymentAttempt(client, input);
  const { funded } = await markAgreementFundedIfComplete(client, {
    agreementId: confirmed.attempt.agreementId,
    actorId: input.actorId,
  });
  // F-NOT-001 : dans la même transaction ; clés déterministes (rejeu sans doublon).
  await notifyCustomer(client, {
    customerId: input.customerId,
    event: 'PAYMENT_CONFIRMED',
    eventKey: confirmed.contributionId,
  });
  if (funded) {
    await notifyCustomer(client, {
      customerId: input.customerId,
      event: 'GOAL_FUNDED',
      eventKey: confirmed.attempt.agreementId,
    });
  }
  return Object.freeze({ ...confirmed, agreementFunded: funded });
}
