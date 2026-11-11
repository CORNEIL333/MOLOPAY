import type { PoolClient } from 'pg';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { getAgreement } from '../modules/agreements/agreement.store';
import { closeComplaint, openDispute, resolveDispute } from '../modules/disputes/dispute.store';
import { factKey, notifyCustomer } from './notify';

type SqlClient = Pick<PoolClient, 'query'>;

async function customerOf(client: SqlClient, agreementId: string): Promise<string | null> {
  const stored = await getAgreement(client, agreementId);
  return stored?.agreement.terms.customerId ?? null;
}

/**
 * F-SUP-002 + F-NOT-001 : ouverture d'un litige (OPEN_DISPUTE, D56) et
 * notification DISPUTE_UPDATED, même transaction.
 */
export async function openDisputeAndNotify(
  client: SqlClient,
  input: { readonly id: string; readonly complaintId: string; readonly principal: AdminPrincipal },
): Promise<Awaited<ReturnType<typeof openDispute>>> {
  assertAuthorized(input.principal, 'OPEN_DISPUTE', {});
  const opened = await openDispute(client, { id: input.id, complaintId: input.complaintId, actorId: input.principal.actorId });
  const customerId = await customerOf(client, opened.agreementId);
  if (customerId !== null) {
    await notifyCustomer(client, { customerId, event: 'DISPUTE_UPDATED', eventKey: factKey('dispute-opened', opened.disputeId) });
  }
  return opened;
}

/**
 * F-SUP-002 + F-NOT-001 : levée d'un litige (RESOLVE_DISPUTE, D56 ; autre
 * personne que l'ouverture, I-7) et notification DISPUTE_UPDATED.
 */
export async function resolveDisputeAndNotify(
  client: SqlClient,
  input: { readonly disputeId: string; readonly principal: AdminPrincipal },
): Promise<Awaited<ReturnType<typeof resolveDispute>>> {
  assertAuthorized(input.principal, 'RESOLVE_DISPUTE', {});
  const resolved = await resolveDispute(client, { disputeId: input.disputeId, actorId: input.principal.actorId });
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

/** F-SUP-001 / D56 : clôture d'une réclamation par le support (CLOSE_COMPLAINT). */
export async function closeComplaintBySupport(
  client: SqlClient,
  input: { readonly complaintId: string; readonly outcome: 'ANSWERED' | 'WITHDRAWN'; readonly principal: AdminPrincipal },
): Promise<void> {
  assertAuthorized(input.principal, 'CLOSE_COMPLAINT', {});
  await closeComplaint(client, { complaintId: input.complaintId, outcome: input.outcome, actorId: input.principal.actorId });
}
