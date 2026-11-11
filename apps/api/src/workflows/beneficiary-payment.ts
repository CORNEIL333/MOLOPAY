import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { getAgreement } from '../modules/agreements/agreement.store';
import { getPartnerLedgerOwner } from '../modules/catalog/partner-ledger.store';
import {
  insertBeneficiaryDocument,
  insertBeneficiaryPayment,
  insertDocumentReview,
  insertDocumentReviewApproval,
} from '../modules/settlement/beneficiary.store';

type SqlClient = Pick<PoolClient, 'query'>;

/** F-PLN-002 : le client dépose l'empreinte de la pièce de son objectif C. */
export async function submitBeneficiaryDocument(
  client: SqlClient,
  input: { readonly id: string; readonly agreementId: string; readonly customerId: string; readonly kind: 'LEASE' | 'LAND_TITLE'; readonly sha256Hex: string },
): Promise<void> {
  await insertBeneficiaryDocument(client, input);
}

/** F-PLN-002 : proposition par un agent de la conformité. */
export async function proposeDocumentReview(
  client: SqlClient,
  input: { readonly documentId: string; readonly principal: AdminPrincipal; readonly decision: 'APPROVED' | 'REJECTED'; readonly reason?: string },
): Promise<void> {
  assertAuthorized(input.principal, 'REVIEW_BENEFICIARY_DOCUMENT', {});
  await insertDocumentReview(client, {
    documentId: input.documentId,
    actorId: input.principal.actorId,
    decision: input.decision,
    reason: input.reason,
  });
}

/** F-PLN-002 : confirmation par un second agent de la conformité (I-7). */
export async function approveDocumentReview(
  client: SqlClient,
  input: { readonly documentId: string; readonly principal: AdminPrincipal },
): Promise<void> {
  assertAuthorized(input.principal, 'REVIEW_BENEFICIARY_DOCUMENT', {});
  await insertDocumentReviewApproval(client, { documentId: input.documentId, actorId: input.principal.actorId });
}

/**
 * F-PLN-003 : règlement au bénéficiaire demandé par le client (le PIN est
 * vérifié par la couche HTTP). Lit l'identifiant comptable du bénéficiaire
 * dans le catalogue (D42) pour le module settlement, qui ne dépend pas du catalogue.
 */
export async function payBeneficiaryForCustomer(
  client: SqlClient,
  input: { readonly agreementId: string; readonly customerId: string },
): Promise<{ readonly entryId: string }> {
  const stored = await getAgreement(client, input.agreementId);
  if (stored === null || stored.agreement.terms.customerId !== input.customerId) {
    throw new BusinessError('AGREEMENT_NOT_FOUND', 'Objectif introuvable');
  }
  const beneficiaryId = stored.agreement.terms.beneficiaryId;
  const owner = beneficiaryId === null ? null : await getPartnerLedgerOwner(client, beneficiaryId);
  if (owner === null) {
    throw new BusinessError('SETTLEMENT_NOT_FUNDED', 'objectif sans bénéficiaire réglable');
  }
  return insertBeneficiaryPayment(client, { ...input, beneficiaryLedgerOwnerId: owner });
}
