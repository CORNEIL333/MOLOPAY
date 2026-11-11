import type { KeyObject } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import {
  getRefund,
  insertRefund,
  insertRefundDecision,
  insertRefundExecution,
  insertRefundInstruction,
  type Refund,
  type RefundKind,
  type RefundInstructionDocument,
} from '../modules/settlement/refund.store';

type SqlClient = Pick<PoolClient, 'query'>;

async function load(client: SqlClient, refundId: string): Promise<Refund> {
  const refund = await getRefund(client, refundId);
  if (refund === null) {
    throw new BusinessError('REFUND_NOT_FOUND', 'remboursement introuvable');
  }
  return refund;
}

/** D49 / D51 : préparation d'un remboursement d'annulation ou de trop-perçu (PREPARE_REFUND). */
export async function prepareRefund(
  client: SqlClient,
  input: { readonly id: string; readonly agreementId: string; readonly kind: RefundKind; readonly principal: AdminPrincipal },
): Promise<Refund> {
  assertAuthorized(input.principal, 'PREPARE_REFUND', {});
  return insertRefund(client, { id: input.id, agreementId: input.agreementId, kind: input.kind, actorId: input.principal.actorId });
}

/** D49 / F-SET-003 : décision par une autre personne (APPROVE_REFUND, plafond). */
export async function decideRefund(
  client: SqlClient,
  input: { readonly refundId: string; readonly principal: AdminPrincipal; readonly decision: 'APPROVED' | 'REJECTED'; readonly reason?: string },
): Promise<void> {
  const refund = await load(client, input.refundId);
  assertAuthorized(input.principal, 'APPROVE_REFUND', { amountXaf: refund.amountXaf });
  await insertRefundDecision(client, { refund, actorId: input.principal.actorId, decision: input.decision, reason: input.reason });
}

/** D49 / INT-NR-002 : instruction signée (APPROVE_REFUND, plafond). */
export async function instructRefund(
  client: SqlClient,
  input: { readonly refundId: string; readonly principal: AdminPrincipal; readonly signingKey: KeyObject; readonly keyId: string },
): Promise<{ readonly document: RefundInstructionDocument; readonly signature: Buffer }> {
  const refund = await load(client, input.refundId);
  assertAuthorized(input.principal, 'APPROVE_REFUND', { amountXaf: refund.amountXaf });
  return insertRefundInstruction(client, { refund, actorId: input.principal.actorId, signingKey: input.signingKey, keyId: input.keyId });
}

/** D49 / F-SET-004 : exécution rapportée par l'établissement (autre personne que l'émetteur). */
export async function recordRefundExecution(
  client: SqlClient,
  input: { readonly refundId: string; readonly principal: AdminPrincipal; readonly outcome: 'EXECUTED' | 'REJECTED'; readonly bankReference: string },
): Promise<{ readonly entryId: string | null }> {
  const refund = await load(client, input.refundId);
  assertAuthorized(input.principal, 'APPROVE_REFUND', { amountXaf: refund.amountXaf });
  return insertRefundExecution(client, { refund, actorId: input.principal.actorId, outcome: input.outcome, bankReference: input.bankReference });
}
