import { createHash, sign, verify, type KeyObject } from 'node:crypto';
import { canonicalize } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { parseXaf, xaf } from '@achat/money';
import type { PoolClient } from 'pg';
import { uuidv7 } from '../ledger/domain';
import { appendLedgerEntry, ensurePartnerFundsAccount, systemAccountId } from '../ledger/entry.store';

type SqlClient = Pick<PoolClient, 'query'>;

const ACTOR_PATTERN = /^[^\s]{1,200}$/;
const KEY_ID_PATTERN = /^[^\s]{1,100}$/;
const BANK_REFERENCE_PATTERN = /^[A-Za-z0-9._:/-]{1,100}$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type BeneficiaryPayout = {
  readonly payoutId: string;
  readonly agreementId: string;
  readonly beneficiaryId: string;
  readonly amountXaf: bigint;
  readonly preparedBy: string;
  readonly decision: 'APPROVED' | 'REJECTED' | null;
};

export type BeneficiaryPayoutInstructionDocument = {
  readonly domain: 'beneficiary-payout-instruction-v1';
  readonly payout_id: string;
  readonly beneficiary_id: string;
  readonly amount_xaf: string;
};

function invalid(message: string): never {
  throw new BusinessError('SETTLEMENT_INVALID_REQUEST', message);
}

function canonicalBytes(document: BeneficiaryPayoutInstructionDocument): Buffer {
  return Buffer.from(canonicalize({ ...document }), 'utf8');
}

export function verifyBeneficiaryPayoutInstruction(
  publicKey: KeyObject,
  document: BeneficiaryPayoutInstructionDocument,
  signature: Buffer,
): boolean {
  return verify(null, canonicalBytes(document), publicKey, signature);
}

export async function getBeneficiaryPayout(client: SqlClient, payoutId: string): Promise<BeneficiaryPayout | null> {
  const result = await client.query<{
    id: string; agreement_id: string; beneficiary_id: string; amount_xaf: string; prepared_by: string; decision: 'APPROVED' | 'REJECTED' | null;
  }>(
    `SELECT p.id, p.agreement_id, p.beneficiary_id, p.amount_xaf::text, p.prepared_by, d.decision
       FROM settlement.beneficiary_payout p
       LEFT JOIN settlement.beneficiary_payout_decision d ON d.payout_id = p.id
      WHERE p.id = $1`,
    [payoutId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : Object.freeze({
        payoutId: row.id,
        agreementId: row.agreement_id,
        beneficiaryId: row.beneficiary_id,
        amountXaf: parseXaf(row.amount_xaf).amount,
        preparedBy: row.prepared_by,
        decision: row.decision,
      });
}

/** Préparation : la base vérifie le règlement au bénéficiaire et calcule bénéficiaire et montant. */
export async function insertBeneficiaryPayout(
  client: SqlClient,
  input: { readonly id: string; readonly agreementId: string; readonly actorId: string },
): Promise<BeneficiaryPayout> {
  if (!UUID_V7_PATTERN.test(input.id) || !ACTOR_PATTERN.test(input.actorId)) {
    invalid('identifiant ou acteur invalide');
  }
  const existing = await client.query('SELECT 1 FROM settlement.beneficiary_payout WHERE agreement_id = $1', [input.agreementId]);
  if ((existing.rowCount ?? 0) > 0) {
    throw new BusinessError('SETTLEMENT_ALREADY_PREPARED', 'virement déjà préparé');
  }
  const paid = await client.query('SELECT 1 FROM settlement.beneficiary_payment WHERE agreement_id = $1', [input.agreementId]);
  if ((paid.rowCount ?? 0) === 0) {
    throw new BusinessError('SETTLEMENT_NOT_FUNDED', 'aucun règlement au bénéficiaire pour cet objectif');
  }
  await client.query(
    `INSERT INTO settlement.beneficiary_payout (id, agreement_id, beneficiary_id, amount_xaf, prepared_by, prepared_at)
     VALUES ($1, $2, '-', 1, $3, now())`,
    [input.id, input.agreementId, input.actorId],
  );
  const stored = await getBeneficiaryPayout(client, input.id);
  if (stored === null) {
    invalid('virement introuvable après préparation');
  }
  return stored;
}

export async function insertBeneficiaryPayoutDecision(
  client: SqlClient,
  input: {
    readonly payout: BeneficiaryPayout;
    readonly actorId: string;
    readonly decision: 'APPROVED' | 'REJECTED';
    readonly reason?: string | undefined;
  },
): Promise<void> {
  if (input.payout.decision !== null) {
    throw new BusinessError('SETTLEMENT_ALREADY_DECIDED', 'virement déjà décidé');
  }
  if (input.payout.preparedBy === input.actorId) {
    throw new BusinessError('MAKER_CANNOT_APPROVE', 'le préparateur ne peut pas décider');
  }
  const reason = input.reason?.trim() ?? '';
  if (input.decision === 'REJECTED' && reason.length === 0) {
    invalid('un refus exige un motif');
  }
  await client.query(
    `INSERT INTO settlement.beneficiary_payout_decision (payout_id, decision, decided_by, reason, decided_at)
     VALUES ($1, $2, $3, $4, now())`,
    [input.payout.payoutId, input.decision, input.actorId, reason.length === 0 ? null : reason],
  );
}

export async function insertBeneficiaryPayoutInstruction(
  client: SqlClient,
  input: { readonly payout: BeneficiaryPayout; readonly actorId: string; readonly signingKey: KeyObject; readonly keyId: string },
): Promise<{ readonly document: BeneficiaryPayoutInstructionDocument; readonly signature: Buffer }> {
  if (!ACTOR_PATTERN.test(input.actorId) || !KEY_ID_PATTERN.test(input.keyId)) {
    invalid('acteur ou clé invalide');
  }
  if (input.payout.decision !== 'APPROVED') {
    throw new BusinessError('SETTLEMENT_NOT_APPROVED', 'virement non approuvé');
  }
  const existing = await client.query('SELECT 1 FROM settlement.beneficiary_payout_instruction WHERE payout_id = $1', [input.payout.payoutId]);
  if ((existing.rowCount ?? 0) > 0) {
    throw new BusinessError('SETTLEMENT_ALREADY_INSTRUCTED', 'instruction déjà émise');
  }
  const document: BeneficiaryPayoutInstructionDocument = {
    domain: 'beneficiary-payout-instruction-v1',
    payout_id: input.payout.payoutId,
    beneficiary_id: input.payout.beneficiaryId,
    amount_xaf: input.payout.amountXaf.toString(),
  };
  const bytes = canonicalBytes(document);
  const signature = sign(null, bytes, input.signingKey);
  await client.query(
    `INSERT INTO settlement.beneficiary_payout_instruction (payout_id, document, document_hash, signature, key_id, instructed_by, instructed_at)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, now())`,
    [input.payout.payoutId, JSON.stringify(document), createHash('sha256').update(bytes).digest(), signature, input.keyId, input.actorId],
  );
  return Object.freeze({ document, signature });
}

/**
 * Exécution rapportée par l'établissement, enregistrée par une autre personne
 * que l'émetteur (I-7). EXECUTED : écriture SETTLEMENT_SENT 2200 du
 * bénéficiaire → 1100 dans la même transaction ; REJECTED : rien.
 */
export async function insertBeneficiaryPayoutExecution(
  client: SqlClient,
  input: {
    readonly payout: BeneficiaryPayout;
    readonly actorId: string;
    readonly outcome: 'EXECUTED' | 'REJECTED';
    readonly bankReference: string;
    readonly beneficiaryLedgerOwnerId: string;
  },
): Promise<{ readonly entryId: string | null }> {
  const { payout } = input;
  if (!ACTOR_PATTERN.test(input.actorId) || !BANK_REFERENCE_PATTERN.test(input.bankReference)) {
    invalid('acteur ou référence de l’établissement invalide');
  }
  const instruction = await client.query<{ instructed_by: string; executed: boolean }>(
    `SELECT i.instructed_by,
            EXISTS (SELECT 1 FROM settlement.beneficiary_payout_execution x WHERE x.payout_id = i.payout_id) AS executed
       FROM settlement.beneficiary_payout_instruction i WHERE i.payout_id = $1`,
    [payout.payoutId],
  );
  const row = instruction.rows[0];
  if (row === undefined) {
    throw new BusinessError('SETTLEMENT_NOT_APPROVED', 'aucune instruction émise');
  }
  if (row.executed) {
    throw new BusinessError('SETTLEMENT_ALREADY_EXECUTED', 'exécution déjà enregistrée');
  }
  if (row.instructed_by === input.actorId) {
    throw new BusinessError('MAKER_CANNOT_APPROVE', 'l’émetteur ne confirme pas son instruction');
  }
  let entryId: string | null = null;
  if (input.outcome === 'EXECUTED') {
    const amount = xaf(payout.amountXaf);
    const entry = await appendLedgerEntry(client, {
      id: uuidv7(),
      operationType: 'SETTLEMENT_SENT',
      businessRefs: {
        beneficiary_payout_id: payout.payoutId,
        agreement_id: payout.agreementId,
        bank_reference: input.bankReference,
      },
      actorId: input.actorId,
      approvers: [],
      idemScope: 'settlement.beneficiary_payout',
      idemKey: payout.payoutId,
      postings: [
        { accountId: await ensurePartnerFundsAccount(client, input.beneficiaryLedgerOwnerId), direction: 'DEBIT', amount },
        { accountId: await systemAccountId(client, '1100'), direction: 'CREDIT', amount },
      ],
    });
    entryId = entry.id;
  }
  await client.query(
    `INSERT INTO settlement.beneficiary_payout_execution (payout_id, outcome, bank_reference, entry_id, recorded_by, recorded_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [payout.payoutId, input.outcome, input.bankReference, entryId, input.actorId],
  );
  return Object.freeze({ entryId });
}
