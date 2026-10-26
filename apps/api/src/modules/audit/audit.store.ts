import { randomBytes } from 'node:crypto';
import type { JsonValue } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import type { Pool, PoolClient } from 'pg';
import {
  createAuditEvent,
  genesisAuditPrevHash,
  type AuditEventDraft,
  type AuditEventRecord,
  type AuditEventType,
  type AuditListQuery,
  type AuditOutcome,
} from './domain';

export type AuditAppendInput = Omit<AuditEventDraft, 'id' | 'ts'> & {
  readonly id?: string;
  readonly ts?: string;
};

export type AuditEventView = {
  readonly seq: number;
  readonly id: string;
  readonly recordedAt: string;
  readonly eventType: AuditEventType;
  readonly actorId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly outcome: AuditOutcome;
  readonly reason: string | null;
  readonly refs: Readonly<Record<string, JsonValue>>;
  readonly prevHash: string;
  readonly eventHash: string;
};

type EventRow = {
  seq: string;
  id: string;
  recorded_at: Date;
  event_type: AuditEventType;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  outcome: AuditOutcome;
  reason: string | null;
  refs: Record<string, JsonValue>;
  prev_hash: string;
  event_hash: string;
};

type ChainRow = {
  seq: string;
  event_hash: Buffer;
};

const SELECT_COLUMNS = `seq, id, recorded_at, event_type, actor_id, action,
  target_type, target_id, outcome, reason, refs,
  encode(prev_hash, 'hex') AS prev_hash,
  encode(event_hash, 'hex') AS event_hash`;

function toSafeSeq(value: string): number {
  const seq = Number(value);
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new BusinessError(
      'AUDIT_INVALID_EVENT',
      `Séquence d’audit hors bornes: ${value}`,
    );
  }
  return seq;
}

export function auditUuidv7(now: number = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('Horodatage UUID invalide');
  }
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Ajoute un événement dans la transaction de l'appelant : l'action auditée et
 * sa preuve sont validées ou annulées ensemble. Le verrou est pris avant la
 * lecture du dernier maillon, comme pour le grand livre.
 */
export async function appendAuditEvent(
  client: PoolClient,
  input: AuditAppendInput,
): Promise<AuditEventRecord> {
  await client.query('SELECT audit.lock_chain()');
  const last = await client.query<ChainRow>(
    'SELECT seq, event_hash FROM audit.event ORDER BY seq DESC LIMIT 1',
  );
  const lastRow = last.rows[0];
  const seq = lastRow === undefined ? 1 : toSafeSeq(lastRow.seq) + 1;
  const prevHash =
    lastRow === undefined ? genesisAuditPrevHash() : lastRow.event_hash;
  const record = createAuditEvent(
    {
      ...input,
      id: input.id ?? auditUuidv7(),
      ts: input.ts ?? new Date().toISOString(),
    },
    seq,
    prevHash,
  );
  await client.query(
    `INSERT INTO audit.event
       (seq, id, recorded_at, event_type, actor_id, action, target_type,
        target_id, outcome, reason, refs, prev_hash, event_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)`,
    [
      record.seq,
      record.id,
      record.ts,
      record.eventType,
      record.actorId,
      record.action,
      record.targetType,
      record.targetId,
      record.outcome,
      record.reason,
      JSON.stringify(record.refs),
      record.prevHash,
      record.eventHash,
    ],
  );
  return record;
}

function toView(row: EventRow): AuditEventView {
  return {
    seq: toSafeSeq(row.seq),
    id: row.id,
    recordedAt: row.recorded_at.toISOString(),
    eventType: row.event_type,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    outcome: row.outcome,
    reason: row.reason,
    refs: row.refs,
    prevHash: row.prev_hash,
    eventHash: row.event_hash,
  };
}

export async function listAuditEvents(
  pool: Pool,
  query: AuditListQuery,
): Promise<readonly AuditEventView[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const parameter = (value: unknown): string => {
    values.push(value);
    return `$${values.length.toString()}`;
  };
  if (query.afterSeq !== null) {
    conditions.push(`seq > ${parameter(query.afterSeq)}`);
  }
  if (query.actorId !== null) {
    conditions.push(`actor_id = ${parameter(query.actorId)}`);
  }
  if (query.targetId !== null) {
    conditions.push(`target_id = ${parameter(query.targetId)}`);
  }
  if (query.eventType !== null) {
    conditions.push(`event_type = ${parameter(query.eventType)}`);
  }
  const where =
    conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
  const limit = parameter(query.limit);
  const result = await pool.query<EventRow>(
    `SELECT ${SELECT_COLUMNS} FROM audit.event ${where}
     ORDER BY seq ASC LIMIT ${limit}`,
    values,
  );
  return result.rows.map(toView);
}

export async function getAuditEvent(
  pool: Pool,
  id: string,
): Promise<AuditEventView | null> {
  const result = await pool.query<EventRow>(
    `SELECT ${SELECT_COLUMNS} FROM audit.event WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row === undefined ? null : toView(row);
}
