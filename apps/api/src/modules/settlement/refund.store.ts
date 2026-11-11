import { createHash, sign, verify, type KeyObject } from 'node:crypto';
import { canonicalize } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { parseXaf, xaf } from '@achat/money';
import type { PoolClient } from 'pg';
import { appendAgreementTransition } from '../agreements/agreement.store';
import { uuidv7 } from '../ledger/domain';
import { appendLedgerEntry, ensureClientFundsAccount, systemAccountId } from '../ledger/entry.store';

type SqlClient = Pick<PoolClient, 'query'>;

const ACTOR_PATTERN = /^[^\s]{1,200}$/;
const KEY_ID_PATTERN = /^[^\s]{1,100}$/;
const BANK_REFERENCE_PATTERN = /^[A-Za-z0-9._:/-]{1,100}$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** D51 : annulation (tous les versements non encore rendus) ou trop-perçu (au-delà de la cible). */
export type RefundKind = 'CANCELLATION' | 'SURPLUS';

export type Refund = {
  readonly refundId: string;
  readonly kind: RefundKind;
  readonly agreementId: string;
  readonly customerId: string;
  readonly amountXaf: bigint;
  readonly preparedBy: string;
  readonly decision: 'APPROVED' | 'REJECTED' | null;
};

export type RefundInstructionDocument = {
  readonly domain: 'refund-instruction-v1';
  readonly refund_id: string;
  readonly customer_id: string;
  readonly amount_xaf: string;
};

function invalid(message: string): never {
  throw new BusinessError('SETTLEMENT_INVALID_REQUEST', message);
}

function canonicalBytes(document: RefundInstructionDocument): Buffer {
  return Buffer.from(canonicalize({ ...document }), 'utf8');
}

export function verifyRefundInstruction(publicKey: KeyObject, document: RefundInstructionDocument, signature: Buffer): boolean {
  return verify(null, canonicalBytes(document), publicKey, signature);
}

export async function getRefund(client: SqlClient, refundId: string): Promise<Refund | null> {
  const result = await client.query<{
    id: string; kind: RefundKind; agreement_id: string; customer_id: string; amount_xaf: string; prepared_by: string; decision: 'APPROVED' | 'REJECTED' | null;
  }>(
    `SELECT r.id, r.kind, r.agreement_id, r.customer_id, r.amount_xaf::text, r.prepared_by, d.decision
       FROM settlement.refund r LEFT JOIN settlement.refund_decision d ON d.refund_id = r.id WHERE r.id = $1`,
    [refundId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : Object.freeze({
        refundId: row.id,
        kind: row.kind,
        agreementId: row.agreement_id,
        customerId: row.customer_id,
        amountXaf: parseXaf(row.amount_xaf).amount,
        preparedBy: row.prepared_by,
        decision: row.decision,
      });
}

/**
 * Préparation : la base vérifie l'état de l'objectif et calcule le montant
 * (annulation : versements non encore rendus ; trop-perçu : au-delà de la
 * cible). Un seul remboursement en cours par objectif ; un remboursement
 * refusé (décision ou établissement) peut être préparé de nouveau (D51).
 */
export async function insertRefund(
  client: SqlClient,
  input: { readonly id: string; readonly agreementId: string; readonly kind: RefundKind; readonly actorId: string },
): Promise<Refund> {
  if (!UUID_V7_PATTERN.test(input.id) || !ACTOR_PATTERN.test(input.actorId)) {
    invalid('identifiant ou acteur invalide');
  }
  if (input.kind !== 'CANCELLATION' && input.kind !== 'SURPLUS') {
    invalid('nature de remboursement inconnue');
  }
  const pending = await client.query(
    `SELECT 1 FROM settlement.refund r
      WHERE r.agreement_id = $1
        AND NOT EXISTS (SELECT 1 FROM settlement.refund_decision d WHERE d.refund_id = r.id AND d.decision = 'REJECTED')
        AND NOT EXISTS (SELECT 1 FROM settlement.refund_execution x WHERE x.refund_id = r.id)`,
    [input.agreementId],
  );
  if ((pending.rowCount ?? 0) > 0) {
    throw new BusinessError('REFUND_ALREADY_PREPARED', 'un remboursement est déjà en cours');
  }
  await client.query(
    `INSERT INTO settlement.refund (id, agreement_id, kind, customer_id, amount_xaf, prepared_by, prepared_at)
     VALUES ($1, $2, $3, gen_random_uuid(), 1, $4, now())`,
    [input.id, input.agreementId, input.kind, input.actorId],
  );
  const stored = await getRefund(client, input.id);
  if (stored === null) {
    invalid('remboursement introuvable après préparation');
  }
  return stored;
}

export async function insertRefundDecision(
  client: SqlClient,
  input: { readonly refund: Refund; readonly actorId: string; readonly decision: 'APPROVED' | 'REJECTED'; readonly reason?: string | undefined },
): Promise<void> {
  if (input.refund.decision !== null) {
    throw new BusinessError('REFUND_ALREADY_DECIDED', 'remboursement déjà décidé');
  }
  if (input.refund.preparedBy === input.actorId) {
    throw new BusinessError('MAKER_CANNOT_APPROVE', 'le préparateur ne peut pas décider');
  }
  const reason = input.reason?.trim() ?? '';
  if (input.decision === 'REJECTED' && reason.length === 0) {
    invalid('un refus exige un motif');
  }
  await client.query(
    `INSERT INTO settlement.refund_decision (refund_id, decision, decided_by, reason, decided_at) VALUES ($1, $2, $3, $4, now())`,
    [input.refund.refundId, input.decision, input.actorId, reason.length === 0 ? null : reason],
  );
}

export async function insertRefundInstruction(
  client: SqlClient,
  input: { readonly refund: Refund; readonly actorId: string; readonly signingKey: KeyObject; readonly keyId: string },
): Promise<{ readonly document: RefundInstructionDocument; readonly signature: Buffer }> {
  if (!ACTOR_PATTERN.test(input.actorId) || !KEY_ID_PATTERN.test(input.keyId)) {
    invalid('acteur ou clé invalide');
  }
  if (input.refund.decision !== 'APPROVED') {
    throw new BusinessError('REFUND_NOT_APPROVED', 'remboursement non approuvé');
  }
  const existing = await client.query('SELECT 1 FROM settlement.refund_instruction WHERE refund_id = $1', [input.refund.refundId]);
  if ((existing.rowCount ?? 0) > 0) {
    throw new BusinessError('REFUND_ALREADY_INSTRUCTED', 'instruction déjà émise');
  }
  const document: RefundInstructionDocument = {
    domain: 'refund-instruction-v1',
    refund_id: input.refund.refundId,
    customer_id: input.refund.customerId,
    amount_xaf: input.refund.amountXaf.toString(),
  };
  const bytes = canonicalBytes(document);
  const signature = sign(null, bytes, input.signingKey);
  await client.query(
    `INSERT INTO settlement.refund_instruction (refund_id, document, document_hash, signature, key_id, instructed_by, instructed_at)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, now())`,
    [input.refund.refundId, JSON.stringify(document), createHash('sha256').update(bytes).digest(), signature, input.keyId, input.actorId],
  );
  return Object.freeze({ document, signature });
}

/**
 * Exécution rapportée par l'établissement, enregistrée par une autre personne
 * que l'émetteur (I-7). EXECUTED : écriture REFUND_SENT 2100 → 1100 et,
 * pour une annulation, transition vers REFUNDED dans la même transaction ;
 * REJECTED : rien (un nouveau remboursement peut être préparé).
 */
export async function insertRefundExecution(
  client: SqlClient,
  input: { readonly refund: Refund; readonly actorId: string; readonly outcome: 'EXECUTED' | 'REJECTED'; readonly bankReference: string },
): Promise<{ readonly entryId: string | null }> {
  const { refund } = input;
  if (!ACTOR_PATTERN.test(input.actorId) || !BANK_REFERENCE_PATTERN.test(input.bankReference)) {
    invalid('acteur ou référence de l’établissement invalide');
  }
  const instruction = await client.query<{ instructed_by: string; executed: boolean }>(
    `SELECT i.instructed_by, EXISTS (SELECT 1 FROM settlement.refund_execution x WHERE x.refund_id = i.refund_id) AS executed
       FROM settlement.refund_instruction i WHERE i.refund_id = $1`,
    [refund.refundId],
  );
  const row = instruction.rows[0];
  if (row === undefined) {
    throw new BusinessError('REFUND_NOT_APPROVED', 'aucune instruction émise');
  }
  if (row.executed) {
    throw new BusinessError('REFUND_ALREADY_EXECUTED', 'exécution déjà enregistrée');
  }
  if (row.instructed_by === input.actorId) {
    throw new BusinessError('MAKER_CANNOT_APPROVE', 'l’émetteur ne confirme pas son instruction');
  }
  let entryId: string | null = null;
  if (input.outcome === 'EXECUTED') {
    const amount = xaf(refund.amountXaf);
    const entry = await appendLedgerEntry(client, {
      id: uuidv7(),
      operationType: 'REFUND_SENT',
      businessRefs: { refund_id: refund.refundId, agreement_id: refund.agreementId, bank_reference: input.bankReference },
      actorId: input.actorId,
      approvers: [],
      idemScope: 'settlement.refund',
      idemKey: refund.refundId,
      postings: [
        { accountId: await ensureClientFundsAccount(client, refund.customerId), direction: 'DEBIT', amount },
        { accountId: await systemAccountId(client, '1100'), direction: 'CREDIT', amount },
      ],
    });
    entryId = entry.id;
  }
  await client.query(
    `INSERT INTO settlement.refund_execution (refund_id, outcome, bank_reference, entry_id, recorded_by, recorded_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [refund.refundId, input.outcome, input.bankReference, entryId, input.actorId],
  );
  // Le trop-perçu ne change pas l'état de l'objectif (D51).
  if (input.outcome === 'EXECUTED' && refund.kind === 'CANCELLATION') {
    await appendAgreementTransition(client, { agreementId: refund.agreementId, to: 'REFUNDED', actorId: input.actorId });
  }
  return Object.freeze({ entryId });
}
