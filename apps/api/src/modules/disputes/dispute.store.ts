import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { appendAgreementTransition, getAgreement } from '../agreements/agreement.store';
import { generateComplaintReference, parseComplaintChannel } from './domain';

type SqlClient = Pick<PoolClient, 'query'>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACTOR_ID_PATTERN = /^[^\s]{1,200}$/;
const REFERENCE_ATTEMPTS = 3;

export type RecordedComplaint = {
  readonly id: string;
  readonly reference: string;
  readonly receivedAt: string;
};

export type DisputeHistoryItem =
  | { readonly at: string; readonly kind: 'COMPLAINT'; readonly reference: string; readonly channel: string }
  | { readonly at: string; readonly kind: 'COMPLAINT_CLOSED'; readonly reference: string; readonly outcome: string }
  | { readonly at: string; readonly kind: 'DISPUTE_OPENED'; readonly disputeId: string }
  | { readonly at: string; readonly kind: 'DISPUTE_RESOLVED'; readonly disputeId: string; readonly outcome: string };

function invalid(message: string): never {
  throw new BusinessError('DISPUTE_INVALID_REQUEST', message);
}

function assertUuid(value: string | null, field: string): void {
  if (value !== null && !UUID_PATTERN.test(value)) {
    invalid(`${field} : UUID attendu`);
  }
}

function assertActor(actorId: string): void {
  if (!ACTOR_ID_PATTERN.test(actorId)) {
    invalid('acteur invalide');
  }
}

/**
 * F-SUP-001 : enregistre une réclamation et renvoie son numéro et l'heure de
 * réception (accusé de réception). La base vérifie que l'accord éventuel
 * appartient au client.
 */
export async function recordComplaint(
  client: SqlClient,
  input: {
    readonly id: string;
    readonly customerId: string;
    readonly agreementId: string | null;
    readonly channel: string;
  },
): Promise<RecordedComplaint> {
  assertUuid(input.id, 'identifiant');
  assertUuid(input.customerId, 'client');
  assertUuid(input.agreementId, 'accord');
  const channel = parseComplaintChannel(input.channel);
  for (let attempt = 1; ; attempt += 1) {
    const reference = generateComplaintReference();
    const result = await client.query<{ received_at: Date }>(
      `INSERT INTO disputes.complaint (id, reference, customer_id, agreement_id, channel, received_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (reference) DO NOTHING
       RETURNING received_at`,
      [input.id, reference, input.customerId, input.agreementId, channel],
    );
    const row = result.rows[0];
    if (row !== undefined) {
      return Object.freeze({ id: input.id, reference, receivedAt: row.received_at.toISOString() });
    }
    if (attempt >= REFERENCE_ATTEMPTS) {
      invalid('numéro de réclamation indisponible');
    }
  }
}

async function hasOpenDispute(client: SqlClient, agreementId: string): Promise<boolean> {
  const result = await client.query<{ open: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM disputes.dispute d
       WHERE d.agreement_id = $1
         AND NOT EXISTS (SELECT 1 FROM disputes.dispute_resolution r WHERE r.dispute_id = d.id)
     ) AS open`,
    [agreementId],
  );
  return result.rows[0]?.open === true;
}

/**
 * F-SUP-002 : ouvre un litige sur l'accord d'une réclamation et le suspend
 * (→ DISPUTED) dans la même transaction. À appeler dans une transaction.
 */
export async function openDispute(
  client: SqlClient,
  input: { readonly id: string; readonly complaintId: string; readonly actorId: string },
): Promise<{ readonly disputeId: string; readonly agreementId: string; readonly fromStatus: string }> {
  assertUuid(input.id, 'identifiant');
  assertUuid(input.complaintId, 'réclamation');
  assertActor(input.actorId);
  const complaint = await client.query<{ agreement_id: string | null }>(
    'SELECT agreement_id FROM disputes.complaint WHERE id = $1',
    [input.complaintId],
  );
  const agreementId = complaint.rows[0]?.agreement_id ?? null;
  if (agreementId === null) {
    invalid('réclamation inconnue ou sans accord');
  }
  if (await hasOpenDispute(client, agreementId)) {
    throw new BusinessError('DISPUTE_ALREADY_OPEN', 'un litige est déjà ouvert sur cet accord');
  }
  const current = await getAgreement(client, agreementId);
  if (current === null) {
    invalid('accord introuvable');
  }
  const fromStatus = current.agreement.status;
  if (fromStatus !== 'ACTIVE' && fromStatus !== 'FUNDED') {
    throw new BusinessError('UNAUTHORIZED_TRANSITION', `litige impossible depuis ${fromStatus}`);
  }
  await client.query(
    `INSERT INTO disputes.dispute (id, complaint_id, agreement_id, from_status, opened_by, opened_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [input.id, input.complaintId, agreementId, fromStatus, input.actorId],
  );
  await appendAgreementTransition(client, { agreementId, to: 'DISPUTED', actorId: input.actorId });
  return Object.freeze({ disputeId: input.id, agreementId, fromStatus });
}

/**
 * F-SUP-002 : lève un litige (issue RESUMED) ; l'accord revient à son état
 * d'origine dans la même transaction. La levée exige une autre personne que
 * l'ouverture (I-7). L'issue « remboursement » relève du lot 12.
 */
export async function resolveDispute(
  client: SqlClient,
  input: { readonly disputeId: string; readonly actorId: string },
): Promise<{ readonly agreementStatus: string; readonly outcome: 'RESUMED' }> {
  assertUuid(input.disputeId, 'litige');
  assertActor(input.actorId);
  const found = await client.query<{ agreement_id: string; from_status: string; opened_by: string; resolved: boolean }>(
    `SELECT d.agreement_id, d.from_status, d.opened_by,
            EXISTS (SELECT 1 FROM disputes.dispute_resolution r WHERE r.dispute_id = d.id) AS resolved
       FROM disputes.dispute d WHERE d.id = $1`,
    [input.disputeId],
  );
  const dispute = found.rows[0];
  if (dispute === undefined) {
    throw new BusinessError('DISPUTE_NOT_FOUND', 'litige introuvable');
  }
  if (dispute.resolved) {
    throw new BusinessError('DISPUTE_NOT_OPEN', 'litige déjà levé');
  }
  if (dispute.opened_by === input.actorId) {
    throw new BusinessError('MAKER_CANNOT_APPROVE', 'la levée exige une autre personne que l’ouverture');
  }
  await client.query(
    `INSERT INTO disputes.dispute_resolution (dispute_id, outcome, resolved_by, resolved_at)
     VALUES ($1, 'RESUMED', $2, now())`,
    [input.disputeId, input.actorId],
  );
  const target = dispute.from_status === 'FUNDED' ? 'FUNDED' : 'ACTIVE';
  const resumed = await appendAgreementTransition(client, {
    agreementId: dispute.agreement_id,
    to: target,
    actorId: input.actorId,
  });
  return Object.freeze({ agreementStatus: resumed.agreement.status, outcome: 'RESUMED' });
}

/** Accords DISPUTED sans litige ouvert (incohérence à classer, jamais corrigée en place). */
export async function listDisputedAgreementsWithoutDispute(client: SqlClient): Promise<string[]> {
  const result = await client.query<{ agreement_id: string }>(
    'SELECT agreement_id FROM disputes.disputed_without_dispute()',
  );
  return result.rows.map((row) => row.agreement_id);
}

/** F-SUP-003 : réclamations, ouvertures et levées de litige d'un accord. */
export async function listDisputeHistory(client: SqlClient, agreementId: string): Promise<DisputeHistoryItem[]> {
  const complaints = await client.query<{
    received_at: Date;
    reference: string;
    channel: string;
    closed_at: Date | null;
    closure_outcome: string | null;
  }>(
    `SELECT c.received_at, c.reference, c.channel, x.closed_at, x.outcome AS closure_outcome
       FROM disputes.complaint c LEFT JOIN disputes.complaint_closure x ON x.complaint_id = c.id
      WHERE c.agreement_id = $1`,
    [agreementId],
  );
  const disputes = await client.query<{
    id: string;
    opened_at: Date;
    resolved_at: Date | null;
    outcome: string | null;
  }>(
    `SELECT d.id, d.opened_at, r.resolved_at, r.outcome
       FROM disputes.dispute d LEFT JOIN disputes.dispute_resolution r ON r.dispute_id = d.id
      WHERE d.agreement_id = $1`,
    [agreementId],
  );
  const items: DisputeHistoryItem[] = [];
  for (const row of complaints.rows) {
    items.push({ at: row.received_at.toISOString(), kind: 'COMPLAINT', reference: row.reference, channel: row.channel });
    if (row.closed_at !== null && row.closure_outcome !== null) {
      items.push({ at: row.closed_at.toISOString(), kind: 'COMPLAINT_CLOSED', reference: row.reference, outcome: row.closure_outcome });
    }
  }
  for (const row of disputes.rows) {
    items.push({ at: row.opened_at.toISOString(), kind: 'DISPUTE_OPENED', disputeId: row.id });
    if (row.resolved_at !== null && row.outcome !== null) {
      items.push({
        at: row.resolved_at.toISOString(),
        kind: 'DISPUTE_RESOLVED',
        disputeId: row.id,
        outcome: row.outcome,
      });
    }
  }
  return items;
}

/**
 * F-SUP-001 / D56 : clôture d'une réclamation (issue en liste fermée, sans
 * texte libre). Refusée tant qu'un litige ouvert sur elle n'est pas levé.
 */
export async function closeComplaint(
  client: SqlClient,
  input: { readonly complaintId: string; readonly outcome: 'ANSWERED' | 'WITHDRAWN'; readonly actorId: string },
): Promise<void> {
  assertUuid(input.complaintId, 'réclamation');
  assertActor(input.actorId);
  if (input.outcome !== 'ANSWERED' && input.outcome !== 'WITHDRAWN') {
    invalid('issue ANSWERED ou WITHDRAWN attendue');
  }
  const state = await client.query<{ closed: boolean; open_dispute: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM disputes.complaint_closure x WHERE x.complaint_id = c.id) AS closed,
            EXISTS (SELECT 1 FROM disputes.dispute d WHERE d.complaint_id = c.id
                      AND NOT EXISTS (SELECT 1 FROM disputes.dispute_resolution r WHERE r.dispute_id = d.id)) AS open_dispute
       FROM disputes.complaint c WHERE c.id = $1`,
    [input.complaintId],
  );
  const row = state.rows[0];
  if (row === undefined) {
    throw new BusinessError('COMPLAINT_NOT_FOUND', 'réclamation introuvable');
  }
  if (row.closed) {
    throw new BusinessError('COMPLAINT_ALREADY_CLOSED', 'réclamation déjà close');
  }
  if (row.open_dispute) {
    throw new BusinessError('DISPUTE_OPEN', 'litige ouvert à lever avant la clôture');
  }
  await client.query(
    'INSERT INTO disputes.complaint_closure (complaint_id, outcome, closed_by, closed_at) VALUES ($1, $2, $3, now())',
    [input.complaintId, input.outcome, input.actorId],
  );
}

/** F-SUP-001 / D41 : réclamations non closes au-delà de 15 jours (45 jours : maximum dépassé). */
export async function listOverdueComplaints(
  client: SqlClient,
  at: Date,
): Promise<readonly { readonly complaintId: string; readonly reference: string; readonly receivedAt: string; readonly beyondMaximum: boolean }[]> {
  const result = await client.query<{ complaint_id: string; reference: string; received_at: Date; beyond_maximum: boolean }>(
    'SELECT complaint_id, reference, received_at, beyond_maximum FROM disputes.overdue_complaints($1)',
    [at],
  );
  return result.rows.map((row) => ({
    complaintId: row.complaint_id,
    reference: row.reference,
    receivedAt: row.received_at.toISOString(),
    beyondMaximum: row.beyond_maximum,
  }));
}
