import type { KeyObject } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { getAgreement } from '../modules/agreements/agreement.store';
import { getPartnerLedgerOwner } from '../modules/catalog/partner-ledger.store';
import {
  getBeneficiaryPayout,
  insertBeneficiaryPayout,
  insertBeneficiaryPayoutDecision,
  insertBeneficiaryPayoutExecution,
  insertBeneficiaryPayoutInstruction,
  type BeneficiaryPayout,
  type BeneficiaryPayoutInstructionDocument,
} from '../modules/settlement/beneficiary-payout.store';
import { factKey, notifyCustomer } from './notify';

type SqlClient = Pick<PoolClient, 'query'>;

async function load(client: SqlClient, payoutId: string): Promise<BeneficiaryPayout> {
  const payout = await getBeneficiaryPayout(client, payoutId);
  if (payout === null) {
    throw new BusinessError('SETTLEMENT_NOT_FOUND', 'virement introuvable');
  }
  return payout;
}

/** D50 : préparation du virement au bénéficiaire C (PREPARE_BENEFICIARY_PAYOUT). */
export async function prepareBeneficiaryPayout(
  client: SqlClient,
  input: { readonly id: string; readonly agreementId: string; readonly principal: AdminPrincipal },
): Promise<BeneficiaryPayout> {
  assertAuthorized(input.principal, 'PREPARE_BENEFICIARY_PAYOUT', {});
  return insertBeneficiaryPayout(client, { id: input.id, agreementId: input.agreementId, actorId: input.principal.actorId });
}

/** D50 / F-SET-003 : décision par une autre personne (APPROVE_BENEFICIARY_PAYOUT, plafond). */
export async function decideBeneficiaryPayout(
  client: SqlClient,
  input: { readonly payoutId: string; readonly principal: AdminPrincipal; readonly decision: 'APPROVED' | 'REJECTED'; readonly reason?: string },
): Promise<void> {
  const payout = await load(client, input.payoutId);
  assertAuthorized(input.principal, 'APPROVE_BENEFICIARY_PAYOUT', { amountXaf: payout.amountXaf });
  await insertBeneficiaryPayoutDecision(client, { payout, actorId: input.principal.actorId, decision: input.decision, reason: input.reason });
}

/** D50 / INT-NR-002 : instruction signée (APPROVE_BENEFICIARY_PAYOUT, plafond). */
export async function instructBeneficiaryPayout(
  client: SqlClient,
  input: { readonly payoutId: string; readonly principal: AdminPrincipal; readonly signingKey: KeyObject; readonly keyId: string },
): Promise<{ readonly document: BeneficiaryPayoutInstructionDocument; readonly signature: Buffer }> {
  const payout = await load(client, input.payoutId);
  assertAuthorized(input.principal, 'APPROVE_BENEFICIARY_PAYOUT', { amountXaf: payout.amountXaf });
  return insertBeneficiaryPayoutInstruction(client, { payout, actorId: input.principal.actorId, signingKey: input.signingKey, keyId: input.keyId });
}

/**
 * D50 / F-SET-004 : exécution rapportée par l'établissement (autre personne
 * que l'émetteur). Lit l'identifiant comptable du bénéficiaire (D42) pour le
 * module settlement, qui ne dépend pas du catalogue.
 */
export async function recordBeneficiaryPayoutExecution(
  client: SqlClient,
  input: { readonly payoutId: string; readonly principal: AdminPrincipal; readonly outcome: 'EXECUTED' | 'REJECTED'; readonly bankReference: string },
): Promise<{ readonly entryId: string | null }> {
  const payout = await load(client, input.payoutId);
  assertAuthorized(input.principal, 'APPROVE_BENEFICIARY_PAYOUT', { amountXaf: payout.amountXaf });
  const owner = await getPartnerLedgerOwner(client, payout.beneficiaryId);
  if (owner === null) {
    throw new BusinessError('SETTLEMENT_INVALID_REQUEST', 'bénéficiaire sans identifiant comptable');
  }
  const result = await insertBeneficiaryPayoutExecution(client, {
    payout,
    actorId: input.principal.actorId,
    outcome: input.outcome,
    bankReference: input.bankReference,
    beneficiaryLedgerOwnerId: owner,
  });
  // F-NOT-001 / D52 : le client de l'objectif apprend que le bénéficiaire est effectivement réglé.
  if (input.outcome === 'EXECUTED') {
    const stored = await getAgreement(client, payout.agreementId);
    if (stored === null) {
      throw new BusinessError('AGREEMENT_NOT_FOUND', 'Objectif introuvable');
    }
    await notifyCustomer(client, {
      customerId: stored.agreement.terms.customerId,
      event: 'SETTLEMENT_CONFIRMED',
      eventKey: factKey('SETTLEMENT_CONFIRMED', 'beneficiary-payout', payout.payoutId),
    });
  }
  return result;
}
