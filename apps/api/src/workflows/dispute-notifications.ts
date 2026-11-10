import type { PoolClient } from 'pg';
import { getAgreement } from '../modules/agreements/agreement.store';
import { openDispute, resolveDispute } from '../modules/disputes/dispute.store';
import { factKey, notifyCustomer } from './notify';

type SqlClient = Pick<PoolClient, 'query'>;

async function customerOf(client: SqlClient, agreementId: string): Promise<string | null> {
  const stored = await getAgreement(client, agreementId);
  return stored?.agreement.terms.customerId ?? null;
}

/** F-SUP-002 + F-NOT-001 : ouverture d'un litige et notification DISPUTE_UPDATED, même transaction. */
export async function openDisputeAndNotify(
  client: SqlClient,
  input: { readonly id: string; readonly complaintId: string; readonly actorId: string },
): Promise<Awaited<ReturnType<typeof openDispute>>> {
  const opened = await openDispute(client, input);
  const customerId = await customerOf(client, opened.agreementId);
  if (customerId !== null) {
    await notifyCustomer(client, { customerId, event: 'DISPUTE_UPDATED', eventKey: factKey('dispute-opened', opened.disputeId) });
  }
  return opened;
}

/** F-SUP-002 + F-NOT-001 : levée d'un litige et notification DISPUTE_UPDATED, même transaction. */
export async function resolveDisputeAndNotify(
  client: SqlClient,
  input: { readonly disputeId: string; readonly actorId: string },
): Promise<Awaited<ReturnType<typeof resolveDispute>>> {
  const resolved = await resolveDispute(client, input);
  const agreement = await client.query<{ agreement_id: string }>(
    'SELECT agreement_id FROM disputes.dispute WHERE id = $1',
    [input.disputeId],
  );
  const agreementId = agreement.rows[0]?.agreement_id;
  const customerId = agreementId === undefined ? null : await customerOf(client, agreementId);
  if (customerId !== null) {
    await notifyCustomer(client, { customerId, event: 'DISPUTE_UPDATED', eventKey: factKey('dispute-resolved', input.disputeId) });
  }
  return resolved;
}
