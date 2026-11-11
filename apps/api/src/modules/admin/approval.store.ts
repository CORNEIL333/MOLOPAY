import type { JsonValue } from '@achat/chain';
import type { PoolClient } from 'pg';
import { BusinessError } from '@achat/contracts';
import {
  createApprovalRequest,
  decideApprovalRequest,
  type AdminPrincipal,
  type ApprovalDecision,
  type ApprovalKind,
  type ApprovalRequest,
} from './domain';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * Persistance du moteur maker-checker générique (SEC-AUTHZ-003). La
 * validation (droits, empreinte, préparateur ≠ décideur, échéance) est faite
 * par le domaine pur puis revérifiée par la base (0003).
 */
export async function prepareApproval(
  client: SqlClient,
  input: { readonly id: string; readonly kind: ApprovalKind; readonly payload: Readonly<Record<string, JsonValue>>; readonly reason: string; readonly principal: AdminPrincipal },
): Promise<ApprovalRequest> {
  const now = (await client.query<{ now: string }>(
    `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now`,
  )).rows[0]?.now ?? '';
  const request = createApprovalRequest({ id: input.id, kind: input.kind, payload: input.payload, reason: input.reason, now }, input.principal, {});
  await client.query(
    `INSERT INTO admin.approval_request (id, kind, maker_id, payload, payload_hash, reason, prepared_at, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
    [request.id, request.kind, request.makerId, JSON.stringify(request.payload), request.payloadHash, request.reason, request.preparedAt, request.expiresAt],
  );
  return request;
}

export async function decideApproval(
  client: SqlClient,
  input: { readonly requestId: string; readonly principal: AdminPrincipal; readonly decision: ApprovalDecision; readonly reason?: string | undefined },
): Promise<void> {
  const row = (await client.query<{
    id: string; kind: ApprovalKind; maker_id: string; payload: Record<string, JsonValue>; payload_hash: Buffer; reason: string;
    prepared_at: string; expires_at: string; now: string;
  }>(
    `SELECT r.id, r.kind, r.maker_id, r.payload, r.payload_hash, r.reason,
            to_char(r.prepared_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS prepared_at,
            to_char(r.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at,
            to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now
       FROM admin.approval_request r
      WHERE r.id = $1 AND NOT EXISTS (SELECT 1 FROM admin.approval_decision d WHERE d.request_id = r.id)`,
    [input.requestId],
  )).rows[0];
  if (row === undefined) {
    throw new BusinessError('ADMIN_INVALID_REQUEST', 'demande introuvable ou déjà décidée');
  }
  const pending: ApprovalRequest = {
    id: row.id, kind: row.kind, makerId: row.maker_id, payload: row.payload, payloadHash: row.payload_hash, reason: row.reason,
    preparedAt: row.prepared_at, expiresAt: row.expires_at, status: 'PENDING', checkerId: null, decidedAt: null, decisionReason: null,
  };
  const decided = decideApprovalRequest(pending, input.principal, {}, input.decision, input.reason, row.now);
  await client.query(
    `INSERT INTO admin.approval_decision (request_id, decision, decided_by, decided_at, decision_reason) VALUES ($1, $2, $3, $4, $5)`,
    [decided.id, input.decision, input.principal.actorId, row.now, decided.decisionReason],
  );
}
