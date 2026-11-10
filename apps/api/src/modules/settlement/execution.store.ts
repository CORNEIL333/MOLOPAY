import { createHash, sign, verify, type KeyObject } from 'node:crypto';
import { canonicalize } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { xaf } from '@achat/money';
import type { PoolClient } from 'pg';
import { uuidv7 } from '../ledger/domain';
import { appendLedgerEntry, ensurePartnerFundsAccount, systemAccountId } from '../ledger/entry.store';
import type { Payout } from './payout.store';

type SqlClient = Pick<PoolClient, 'query'>;

const ACTOR_PATTERN = /^[^\s]{1,200}$/;
const KEY_ID_PATTERN = /^[^\s]{1,100}$/;
const BANK_REFERENCE_PATTERN = /^[A-Za-z0-9._:/-]{1,100}$/;
const ISO_UTC_MS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Document d'instruction transmis à l'établissement de cantonnement (INT-NR-002). */
export type PayoutInstructionDocument = {
  readonly domain: 'payout-instruction-v1';
  readonly payout_id: string;
  readonly partner_id: string;
  readonly net_xaf: string;
};

function invalid(message: string): never {
  throw new BusinessError('SETTLEMENT_INVALID_REQUEST', message);
}

function canonicalBytes(document: PayoutInstructionDocument): Buffer {
  return Buffer.from(canonicalize({ ...document }), 'utf8');
}

/** Vérifie la signature Ed25519 d'une instruction (établissement, auditeur, vérificateur). */
export function verifyPayoutInstruction(
  publicKey: KeyObject,
  document: PayoutInstructionDocument,
  signature: Buffer,
): boolean {
  return verify(null, canonicalBytes(document), publicKey, signature);
}

/**
 * F-SET-004 : instruction canonique signée par la clé de la plateforme
 * (fournie par la configuration, jamais par le code). Le règlement doit être
 * approuvé ; la base revérifie que le document reprend exactement le règlement.
 */
export async function insertInstruction(
  client: SqlClient,
  input: { readonly payout: Payout; readonly actorId: string; readonly signingKey: KeyObject; readonly keyId: string },
): Promise<{ readonly document: PayoutInstructionDocument; readonly signature: Buffer }> {
  const { payout } = input;
  if (!ACTOR_PATTERN.test(input.actorId) || !KEY_ID_PATTERN.test(input.keyId)) {
    invalid('acteur ou clé invalide');
  }
  if (payout.decision !== 'APPROVED') {
    throw new BusinessError('SETTLEMENT_NOT_APPROVED', 'règlement non approuvé');
  }
  const existing = await client.query('SELECT 1 FROM settlement.payout_instruction WHERE payout_id = $1', [payout.payoutId]);
  if ((existing.rowCount ?? 0) > 0) {
    throw new BusinessError('SETTLEMENT_ALREADY_INSTRUCTED', 'instruction déjà émise');
  }
  const document: PayoutInstructionDocument = {
    domain: 'payout-instruction-v1',
    payout_id: payout.payoutId,
    partner_id: payout.partnerId,
    net_xaf: payout.netXaf.toString(),
  };
  const bytes = canonicalBytes(document);
  const signature = sign(null, bytes, input.signingKey);
  await client.query(
    `INSERT INTO settlement.payout_instruction
       (payout_id, document, document_hash, signature, key_id, instructed_by, instructed_at)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, now())`,
    [
      payout.payoutId,
      JSON.stringify(document),
      createHash('sha256').update(bytes).digest(),
      signature,
      input.keyId,
      input.actorId,
    ],
  );
  return Object.freeze({ document, signature });
}

/**
 * F-SET-004 : exécution rapportée par l'établissement, enregistrée par une
 * autre personne que l'émetteur (I-7). EXECUTED passe l'écriture
 * SETTLEMENT_SENT (débit 2200 du marchand, crédit 1100) dans la même
 * transaction ; REJECTED n'écrit rien.
 */
export async function insertExecution(
  client: SqlClient,
  input: {
    readonly payout: Payout;
    readonly actorId: string;
    readonly outcome: 'EXECUTED' | 'REJECTED';
    readonly bankReference: string;
    readonly partnerLedgerOwnerId: string;
  },
): Promise<{ readonly entryId: string | null }> {
  const { payout } = input;
  if (!ACTOR_PATTERN.test(input.actorId) || !BANK_REFERENCE_PATTERN.test(input.bankReference)) {
    invalid('acteur ou référence de l’établissement invalide');
  }
  const instruction = await client.query<{ instructed_by: string; executed: boolean }>(
    `SELECT i.instructed_by,
            EXISTS (SELECT 1 FROM settlement.payout_execution x WHERE x.payout_id = i.payout_id) AS executed
       FROM settlement.payout_instruction i WHERE i.payout_id = $1`,
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
    const partnerAccount = await ensurePartnerFundsAccount(client, input.partnerLedgerOwnerId);
    const treasury = await systemAccountId(client, '1100');
    const amount = xaf(payout.netXaf);
    const entry = await appendLedgerEntry(client, {
      id: uuidv7(),
      operationType: 'SETTLEMENT_SENT',
      businessRefs: { payout_id: payout.payoutId, bank_reference: input.bankReference },
      actorId: input.actorId,
      approvers: [],
      idemScope: 'settlement.execution',
      idemKey: payout.payoutId,
      postings: [
        { accountId: partnerAccount, direction: 'DEBIT', amount },
        { accountId: treasury, direction: 'CREDIT', amount },
      ],
    });
    entryId = entry.id;
  }
  await client.query(
    `INSERT INTO settlement.payout_execution (payout_id, outcome, bank_reference, entry_id, recorded_by, recorded_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [payout.payoutId, input.outcome, input.bankReference, entryId, input.actorId],
  );
  return Object.freeze({ entryId });
}

/** F-SET-004 : instructions non confirmées depuis plus de 24 h à l'instant `at`. */
export async function listOverdueInstructions(
  client: SqlClient,
  at: string,
): Promise<{ readonly payoutId: string; readonly instructedAt: string }[]> {
  if (!ISO_UTC_MS_PATTERN.test(at) || Number.isNaN(Date.parse(at))) {
    invalid('instant ISO 8601 UTC attendu');
  }
  const result = await client.query<{ payout_id: string; instructed_at: Date }>(
    'SELECT payout_id, instructed_at FROM settlement.overdue_instructions($1::timestamptz)',
    [at],
  );
  return result.rows.map((r) => ({ payoutId: r.payout_id, instructedAt: r.instructed_at.toISOString() }));
}
