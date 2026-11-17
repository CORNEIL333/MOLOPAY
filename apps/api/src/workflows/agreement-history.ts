import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { appendAuditEvent } from '../modules/audit/audit.store';
import { getAgreement, listAgreementEvents, type AgreementHistoryItem } from '../modules/agreements/agreement.store';
import { getComplaintForStaff, listDisputeHistory, type ComplaintForStaff, type DisputeHistoryItem } from '../modules/disputes/dispute.store';
import { listPaymentHistory, type PaymentHistoryItem } from '../modules/payments/attempt.store';

type SqlClient = Pick<PoolClient, 'query'>;

export type HistoryItem = AgreementHistoryItem | PaymentHistoryItem | DisputeHistoryItem;

/**
 * F-SUP-003 : historique chronologique d'un accord, assemblé à partir des
 * journaux d'événements des modules (statuts, versements, réclamations,
 * litiges), sans rien recalculer ni stocker. Un client ne voit que ses
 * accords : un accord d'un autre client est « introuvable » (pas de fuite).
 * Les remises (lot 12) et les échanges avec le support (D41) s'ajouteront ici.
 */
export async function getAgreementHistory(
  client: SqlClient,
  input: { readonly agreementId: string; readonly customerId: string },
): Promise<HistoryItem[]> {
  const stored = await getAgreement(client, input.agreementId);
  if (stored === null || stored.agreement.terms.customerId !== input.customerId) {
    throw new BusinessError('AGREEMENT_NOT_FOUND', 'Accord introuvable');
  }
  const sources: HistoryItem[][] = [
    await listAgreementEvents(client, input.agreementId),
    await listPaymentHistory(client, input.agreementId),
    await listDisputeHistory(client, input.agreementId),
  ];
  // Tri stable par instant ; à instant égal, l'ordre des sources est conservé.
  return sources
    .flat()
    .map((item, index) => ({ item, index }))
    .sort((a, b) => Date.parse(a.item.at) - Date.parse(b.item.at) || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * F-SUP-003 / F-BO-004 / D62 : le même historique, consulté par le personnel
 * (`READ_FINANCIAL_HISTORY`), motif obligatoire et consultation inscrite à
 * l'audit chaîné dans la même transaction, avec l'identifiant du client.
 */
export async function getAgreementHistoryForStaff(
  client: SqlClient,
  input: { readonly agreementId: string; readonly principal: AdminPrincipal; readonly reason: string },
): Promise<HistoryItem[]> {
  assertAuthorized(input.principal, 'READ_FINANCIAL_HISTORY', { reason: input.reason });
  const stored = await getAgreement(client, input.agreementId);
  if (stored === null) {
    throw new BusinessError('AGREEMENT_NOT_FOUND', 'Accord introuvable');
  }
  const customerId = stored.agreement.terms.customerId;
  await appendAuditEvent(client, {
    eventType: 'FINANCIAL_HISTORY_READ',
    actorId: input.principal.actorId,
    action: 'READ_FINANCIAL_HISTORY',
    targetType: 'AGREEMENT',
    targetId: input.agreementId,
    outcome: 'SUCCESS',
    reason: input.reason,
    refs: { client_id: customerId },
  });
  return getAgreementHistory(client, { agreementId: input.agreementId, customerId });
}

/**
 * F-SUP-001 / F-BO-004 (D73) : détail d'une réclamation pour le support ;
 * consultation motivée, inscrite à l'audit avec l'identifiant du client.
 * L'identifiant du client n'est pas renvoyé (il figure à l'audit seulement).
 */
export async function getComplaintDetailForStaff(
  client: SqlClient,
  input: { readonly complaintId: string; readonly principal: AdminPrincipal; readonly reason: string },
): Promise<Omit<ComplaintForStaff, 'customerId'>> {
  assertAuthorized(input.principal, 'READ_FINANCIAL_HISTORY', { reason: input.reason });
  const complaint = await getComplaintForStaff(client, input.complaintId);
  if (complaint === null) {
    throw new BusinessError('COMPLAINT_NOT_FOUND', 'Réclamation introuvable');
  }
  await appendAuditEvent(client, {
    eventType: 'FINANCIAL_HISTORY_READ',
    actorId: input.principal.actorId,
    action: 'READ_FINANCIAL_HISTORY',
    targetType: 'COMPLAINT',
    targetId: input.complaintId,
    outcome: 'SUCCESS',
    reason: input.reason,
    refs: { client_id: complaint.customerId },
  });
  return Object.freeze({
    complaintId: complaint.complaintId, reference: complaint.reference, agreementId: complaint.agreementId, channel: complaint.channel,
    receivedAt: complaint.receivedAt, reason: complaint.reason, details: complaint.details, closed: complaint.closed, openDispute: complaint.openDispute,
  });
}
