import { BusinessError } from '@achat/contracts';
import { xaf } from '@achat/money';
import type { PoolClient } from 'pg';
import { appendAgreementTransition, getAgreement } from '../agreements/agreement.store';
import { uuidv7 } from '../ledger/domain';
import { appendLedgerEntry, ensureClientFundsAccount, ensurePartnerFundsAccount } from '../ledger/entry.store';

type SqlClient = Pick<PoolClient, 'query'>;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const ACTOR_PATTERN = /^[^\s]{1,200}$/;

function invalid(message: string): never {
  throw new BusinessError('SETTLEMENT_INVALID_REQUEST', message);
}

/** F-PLN-002 : dépôt d'une pièce par le client de l'accord (empreinte seulement). */
export async function insertBeneficiaryDocument(
  client: SqlClient,
  input: {
    readonly id: string;
    readonly agreementId: string;
    readonly customerId: string;
    readonly kind: 'LEASE' | 'LAND_TITLE';
    readonly sha256Hex: string;
  },
): Promise<void> {
  if (!SHA256_HEX.test(input.sha256Hex)) {
    invalid('empreinte SHA-256 hexadécimale attendue');
  }
  await client.query(
    `INSERT INTO settlement.beneficiary_document (id, agreement_id, kind, sha256, submitted_by, submitted_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [input.id, input.agreementId, input.kind, Buffer.from(input.sha256Hex, 'hex'), input.customerId],
  );
}

/** F-PLN-002 : proposition de la conformité (première personne). */
export async function insertDocumentReview(
  client: SqlClient,
  input: { readonly documentId: string; readonly actorId: string; readonly decision: 'APPROVED' | 'REJECTED'; readonly reason?: string | undefined },
): Promise<void> {
  const reason = input.reason?.trim() ?? '';
  if (!ACTOR_PATTERN.test(input.actorId)) {
    invalid('acteur invalide');
  }
  if (input.decision === 'REJECTED' && reason.length === 0) {
    invalid('un refus exige un motif');
  }
  await client.query(
    `INSERT INTO settlement.document_review (document_id, decision, reason, prepared_by, prepared_at)
     VALUES ($1, $2, $3, $4, now())`,
    [input.documentId, input.decision, reason.length === 0 ? null : reason, input.actorId],
  );
}

/** F-PLN-002 : confirmation par une autre personne de la conformité (I-7). */
export async function insertDocumentReviewApproval(
  client: SqlClient,
  input: { readonly documentId: string; readonly actorId: string },
): Promise<void> {
  const review = await client.query<{ prepared_by: string }>(
    'SELECT prepared_by FROM settlement.document_review WHERE document_id = $1',
    [input.documentId],
  );
  const preparer = review.rows[0]?.prepared_by;
  if (preparer === undefined) {
    throw new BusinessError('SETTLEMENT_NOT_FOUND', 'aucune proposition à confirmer');
  }
  if (preparer === input.actorId) {
    throw new BusinessError('MAKER_CANNOT_APPROVE', 'la confirmation exige une autre personne');
  }
  await client.query(
    `INSERT INTO settlement.document_review_approval (document_id, approved_by, approved_at) VALUES ($1, $2, now())`,
    [input.documentId, input.actorId],
  );
}

/**
 * F-PLN-003 : règlement au bénéficiaire demandé par le client. Dans la même
 * transaction : écriture BENEFICIARY_PAYMENT (débit 2100 du client, crédit 2200
 * du bénéficiaire, cible), règlement et FUNDED → PAID_TO_BENEFICIARY. La base
 * exige la pièce validée quand la catégorie du bénéficiaire en demande une.
 */
export async function insertBeneficiaryPayment(
  client: SqlClient,
  input: { readonly agreementId: string; readonly customerId: string; readonly beneficiaryLedgerOwnerId: string },
): Promise<{ readonly entryId: string }> {
  const stored = await getAgreement(client, input.agreementId);
  if (stored === null || stored.agreement.terms.customerId !== input.customerId) {
    throw new BusinessError('AGREEMENT_NOT_FOUND', 'Objectif introuvable');
  }
  const terms = stored.agreement.terms;
  if (terms.model !== 'PLANNED_EXPENSE' || stored.agreement.status !== 'FUNDED' || terms.beneficiaryId === null) {
    throw new BusinessError('SETTLEMENT_NOT_FUNDED', `accord à l’état ${stored.agreement.status}`);
  }
  const required = await client.query<{ kind: string | null; ok: boolean }>(
    `SELECT settlement.required_document_kind($1) AS kind, settlement.has_validated_document($1) AS ok`,
    [input.agreementId],
  );
  const row = required.rows[0];
  if (row !== undefined && row.kind !== null && !row.ok) {
    throw new BusinessError('SETTLEMENT_DOCUMENT_REQUIRED', 'pièce du bénéficiaire non validée par la conformité');
  }
  const amount = xaf(terms.targetXaf);
  const entry = await appendLedgerEntry(client, {
    id: uuidv7(),
    operationType: 'BENEFICIARY_PAYMENT',
    businessRefs: { agreement_id: input.agreementId, beneficiary_id: terms.beneficiaryId },
    actorId: input.customerId,
    approvers: [],
    idemScope: 'settlement.beneficiary',
    idemKey: input.agreementId,
    postings: [
      { accountId: await ensureClientFundsAccount(client, input.customerId), direction: 'DEBIT', amount },
      { accountId: await ensurePartnerFundsAccount(client, input.beneficiaryLedgerOwnerId), direction: 'CREDIT', amount },
    ],
  });
  if (entry.replayed) {
    throw new BusinessError('SETTLEMENT_NOT_FUNDED', 'règlement déjà effectué');
  }
  await client.query(
    `INSERT INTO settlement.beneficiary_payment (agreement_id, beneficiary_id, requested_by, entry_id, paid_at)
     VALUES ($1, $2, $3, $4, now())`,
    [input.agreementId, terms.beneficiaryId, input.customerId, entry.id],
  );
  await appendAgreementTransition(client, { agreementId: input.agreementId, to: 'PAID_TO_BENEFICIARY', actorId: input.customerId });
  return Object.freeze({ entryId: entry.id });
}
