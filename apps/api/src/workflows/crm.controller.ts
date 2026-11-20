import { BusinessError } from '@achat/contracts';
import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PG_POOL, withTransaction, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentStaff, StaffSessionGuard } from '../http/staff-session.guard';
import type { AdminPrincipal } from '../modules/admin/domain';
import {
  createFollowUpTask,
  recordInteraction,
  transitionFollowUpTask,
  INTERACTION_CHANNELS,
  INTERACTION_DIRECTIONS,
  TASK_PRIORITIES,
  TASK_TRANSITIONS,
} from '../modules/crm/crm.store';
import { uuidv7 } from '../modules/ledger/domain';
import { oneOf, optionalText, requiredText, UUID_PATTERN, whitelistedBody } from './backoffice-body';
import { assertCrmWriter, readCrmCustomer } from './crm-support';

const REASON = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]{3,500}$/u;

function instant(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new BusinessError('REQUEST_INVALID', `${field} doit être un instant ISO 8601`);
  }
  return new Date(value);
}

/**
 * Q5 / F-SUP-001 / F-BO-004 : CRM du back-office — fiche client 360° en
 * lecture motivée et journalisée, interactions de support et tâches de suivi
 * en ajout seul. Les règles (compte existant, bornes de texte, transitions,
 * immuabilité) sont tenues par la base (migration 0100).
 */
@Controller('v1/backoffice/crm')
@UseGuards(StaffSessionGuard)
export class CrmController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  /** Fiche client 360° : identité masquée, accords récents, journal CRM. */
  @Get('customers/:accountId')
  @Header('Cache-Control', 'private, no-store')
  public customer(@CurrentStaff() staff: AdminPrincipal, @Param('accountId') accountId: string, @Query() query: unknown): Promise<unknown> {
    const id = requiredText(accountId, UUID_PATTERN);
    const reason = requiredText(whitelistedBody(query, ['reason'])['reason'], REASON);
    return withTransaction({ ...this.database, role: 'app_rw' }, (client) => readCrmCustomer(client, { accountId: id, principal: staff, reason }));
  }

  /** Enregistre un échange avec le client (téléphone, WhatsApp, visite…). */
  @Post('customers/:accountId/interactions')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async record(@CurrentStaff() staff: AdminPrincipal, @Param('accountId') accountId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const id = requiredText(accountId, UUID_PATTERN);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const value = whitelistedBody(body, ['channel', 'direction', 'summary', 'occurredAt'], ['outcome']);
    const channel = oneOf(value['channel'], INTERACTION_CHANNELS);
    const direction = oneOf(value['direction'], INTERACTION_DIRECTIONS);
    const summary = requiredText(value['summary'], /^[\s\S]{3,2000}$/);
    const outcome = optionalText(value['outcome']);
    // L'instant de l'échange vient de l'agent : un rejeu avec la même clé porte la même empreinte.
    const occurredAt = instant(value['occurredAt'], 'occurredAt');
    assertCrmWriter(staff);
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      {
        scope: `crm-interaction:${staff.actorId}:${id}`,
        key,
        request: { accountId: id, channel, direction, summary, outcome: outcome ?? null, occurredAt: occurredAt.toISOString() },
      },
      async (client: PoolClient) => {
        const recorded = await recordInteraction(client, {
          interactionId: uuidv7(),
          accountId: id,
          channel,
          direction,
          summary,
          outcome: outcome ?? null,
          actorId: staff.actorId,
          occurredAt,
        });
        return { status: 201, body: { accountId: id, ...recorded } };
      },
    );
    return result.body;
  }

  /** Crée une tâche de suivi, ouverte par son premier événement. */
  @Post('customers/:accountId/tasks')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async task(@CurrentStaff() staff: AdminPrincipal, @Param('accountId') accountId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const id = requiredText(accountId, UUID_PATTERN);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const value = whitelistedBody(body, ['title', 'assignee'], ['details', 'priority', 'dueAt']);
    const title = requiredText(value['title'], /^[\s\S]{3,200}$/);
    const details = optionalText(value['details']);
    const priority = value['priority'] === undefined ? 'NORMAL' : oneOf(value['priority'], TASK_PRIORITIES);
    const assignee = requiredText(value['assignee'], /^[^\s\u200b-\u200f\u2028\u2029\ufeff]{1,200}$/u);
    const dueAt = value['dueAt'] === undefined ? null : instant(value['dueAt'], 'dueAt');
    assertCrmWriter(staff);
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      {
        scope: `crm-task:${staff.actorId}:${id}`,
        key,
        request: { accountId: id, title, details: details ?? null, priority, assignee, dueAt: dueAt === null ? null : dueAt.toISOString() },
      },
      async (client: PoolClient) => {
        const created = await createFollowUpTask(client, {
          taskId: uuidv7(),
          accountId: id,
          title,
          details: details ?? null,
          priority,
          assigneeId: assignee,
          dueAt,
          actorId: staff.actorId,
        });
        return { status: 201, body: { accountId: id, status: 'OPEN', ...created } };
      },
    );
    return result.body;
  }

  /** Clôt ou annule une tâche ouverte ; une tâche close ne se rejoue pas. */
  @Post('tasks/:taskId/transitions')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async transition(@CurrentStaff() staff: AdminPrincipal, @Param('taskId') taskId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const id = requiredText(taskId, UUID_PATTERN);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const value = whitelistedBody(body, ['kind', 'note']);
    const kind = oneOf(value['kind'], TASK_TRANSITIONS);
    const note = requiredText(value['note'], /^[\s\S]{3,1000}$/);
    assertCrmWriter(staff);
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `crm-task-transition:${staff.actorId}:${id}`, key, request: { taskId: id, kind, note } },
      async (client: PoolClient) => {
        const applied = await transitionFollowUpTask(client, { eventId: uuidv7(), taskId: id, kind, actorId: staff.actorId, note });
        return { status: 200, body: applied };
      },
    );
    return result.body;
  }
}
