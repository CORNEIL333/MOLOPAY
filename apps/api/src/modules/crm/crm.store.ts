import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

export const INTERACTION_CHANNELS = ['PHONE', 'WHATSAPP', 'SMS', 'EMAIL', 'WALK_IN', 'APP', 'OTHER'] as const;
export type InteractionChannel = (typeof INTERACTION_CHANNELS)[number];

export const INTERACTION_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export type InteractionDirection = (typeof INTERACTION_DIRECTIONS)[number];

export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_TRANSITIONS = ['COMPLETED', 'CANCELLED'] as const;
export type TaskTransition = (typeof TASK_TRANSITIONS)[number];

export type CrmInteraction = {
  readonly interactionId: string;
  readonly channel: string;
  readonly direction: string;
  readonly summary: string;
  readonly outcome: string | null;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
};

/** L'état d'une tâche se dérive de son dernier événement, jamais d'une colonne. */
export type CrmTask = {
  readonly taskId: string;
  readonly title: string;
  readonly details: string | null;
  readonly priority: string;
  readonly assigneeId: string;
  readonly dueAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
};

export type InteractionInput = {
  readonly interactionId: string;
  readonly accountId: string;
  readonly channel: string;
  readonly direction: string;
  readonly summary: string;
  readonly outcome: string | null;
  readonly actorId: string;
  readonly occurredAt: Date;
};

export type TaskInput = {
  readonly taskId: string;
  readonly accountId: string;
  readonly title: string;
  readonly details: string | null;
  readonly priority: string;
  readonly assigneeId: string;
  readonly dueAt: Date | null;
  readonly actorId: string;
};

export type TaskTransitionInput = {
  readonly eventId: string;
  readonly taskId: string;
  readonly kind: string;
  readonly actorId: string;
  readonly note: string;
};

const INTERACTION_LIMIT = 50;

export async function listInteractions(client: SqlClient, accountId: string): Promise<readonly CrmInteraction[]> {
  const result = await client.query<{
    id: string; channel: string; direction: string; summary: string; outcome: string | null;
    actor_id: string; occurred_at: Date; recorded_at: Date;
  }>(
    `SELECT id, channel, direction, summary, outcome, actor_id, occurred_at, recorded_at
       FROM crm.interaction
      WHERE account_id = $1
      ORDER BY recorded_at DESC, id DESC
      LIMIT $2`,
    [accountId, INTERACTION_LIMIT],
  );
  return result.rows.map((row) => Object.freeze({
    interactionId: row.id,
    channel: row.channel,
    direction: row.direction,
    summary: row.summary,
    outcome: row.outcome,
    actorId: row.actor_id,
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(),
  }));
}

export async function listTasks(client: SqlClient, accountId: string): Promise<readonly CrmTask[]> {
  const result = await client.query<{
    id: string; title: string; details: string | null; priority: string; assignee_id: string;
    due_at: Date | null; created_by: string; created_at: Date; last_kind: string;
  }>(
    `SELECT t.id, t.title, t.details, t.priority, t.assignee_id, t.due_at, t.created_by, t.created_at,
            e.kind AS last_kind
       FROM crm.follow_up_task t
       JOIN LATERAL (
         SELECT ev.kind FROM crm.follow_up_task_event ev
          WHERE ev.task_id = t.id ORDER BY ev.seq DESC LIMIT 1
       ) e ON true
      WHERE t.account_id = $1
      ORDER BY t.created_at DESC, t.id DESC`,
    [accountId],
  );
  return result.rows.map((row) => Object.freeze({
    taskId: row.id,
    title: row.title,
    details: row.details,
    priority: row.priority,
    assigneeId: row.assignee_id,
    dueAt: row.due_at === null ? null : row.due_at.toISOString(),
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    status: row.last_kind === 'OPENED' ? 'OPEN' : row.last_kind === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED',
  }));
}

export async function recordInteraction(
  client: SqlClient,
  input: InteractionInput,
): Promise<{ readonly interactionId: string; readonly recordedAt: string }> {
  const row = (await client.query<{ interaction_id: string; recorded_at: Date }>(
    `SELECT interaction_id, recorded_at
       FROM crm.record_interaction($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::timestamptz)`,
    [input.interactionId, input.accountId, input.channel, input.direction, input.summary, input.outcome, input.actorId, input.occurredAt.toISOString()],
  )).rows[0];
  if (row === undefined) {
    throw new BusinessError('INTERNAL_ERROR', 'Interaction non inscrite');
  }
  return Object.freeze({ interactionId: row.interaction_id, recordedAt: row.recorded_at.toISOString() });
}

export async function createFollowUpTask(
  client: SqlClient,
  input: TaskInput,
): Promise<{ readonly taskId: string; readonly createdAt: string }> {
  const row = (await client.query<{ task_id: string; created_at: Date }>(
    `SELECT task_id, created_at
       FROM crm.create_follow_up_task($1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamptz, $8)`,
    [input.taskId, input.accountId, input.title, input.details, input.priority, input.assigneeId, input.dueAt === null ? null : input.dueAt.toISOString(), input.actorId],
  )).rows[0];
  if (row === undefined) {
    throw new BusinessError('INTERNAL_ERROR', 'Tâche non créée');
  }
  return Object.freeze({ taskId: row.task_id, createdAt: row.created_at.toISOString() });
}

export async function transitionFollowUpTask(
  client: SqlClient,
  input: TaskTransitionInput,
): Promise<{ readonly taskId: string; readonly seq: number; readonly kind: string; readonly recordedAt: string }> {
  const row = (await client.query<{ task_id: string; seq: number; kind: string; recorded_at: Date }>(
    `SELECT task_id, seq, kind, recorded_at
       FROM crm.transition_follow_up_task($1::uuid, $2::uuid, $3, $4, $5)`,
    [input.eventId, input.taskId, input.kind, input.actorId, input.note],
  )).rows[0];
  if (row === undefined) {
    throw new BusinessError('INTERNAL_ERROR', 'Transition non inscrite');
  }
  return Object.freeze({ taskId: row.task_id, seq: row.seq, kind: row.kind, recordedAt: row.recorded_at.toISOString() });
}
