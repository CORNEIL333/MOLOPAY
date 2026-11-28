import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, withTransaction, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentStaff, StaffSessionGuard } from '../http/staff-session.guard';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { appendAuditEvent } from '../modules/audit/audit.store';
import { confirmOutgoingFreeze, readOutgoingFreezeState, requestOutgoingFreeze, type FreezeState } from '../modules/settlement/outgoing-freeze.store';
import { oneOf, requiredText, UUID_PATTERN, whitelistedBody } from './backoffice-body';

const REASON = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]{3,1000}$/u;

/**
 * C7 / SEC-INC-003 : interrupteur d'arrêt des flux sortants. Demande motivée
 * (gel ou levée), confirmée par une autre personne dans l'heure ; tant que le
 * gel est actif, la base refuse toute nouvelle instruction signée. Lecture de
 * l'état par tout le personnel (aucune donnée personnelle) ; audit chaîné.
 */
@Controller('v1/backoffice/outgoing-freeze')
@UseGuards(StaffSessionGuard)
export class BackofficeFreezeController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  public state(): Promise<FreezeState> {
    return withTransaction({ ...this.database, role: 'app_ro' }, (client) => readOutgoingFreezeState(client), { readOnlySnapshot: true });
  }

  @Post('requests')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async request(@CurrentStaff() staff: AdminPrincipal, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const value = whitelistedBody(body, ['action', 'reason']);
    const action = oneOf(value['action'], ['FREEZE', 'UNFREEZE'] as const);
    const reason = requiredText(value['reason'], REASON).trim();
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    assertAuthorized(staff, 'MANAGE_OUTGOING_FREEZE', { reason });
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `bo-freeze-request:${staff.actorId}`, key, request: { action, reason } }, async (client) => {
      const requestId = await requestOutgoingFreeze(client, { action, reason, actorId: staff.actorId });
      await appendAuditEvent(client, {
        eventType: 'BACKOFFICE_ACTION', actorId: staff.actorId, action: 'OUTGOING_FREEZE_REQUESTED', targetType: 'OUTGOING_FREEZE', targetId: requestId,
        outcome: 'SUCCESS', reason, refs: { request_id: requestId, freeze_action: action },
      });
      return { status: 201, body: { requestId, action } };
    });
    return result.body;
  }

  @Post('requests/:requestId/confirmation')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async confirm(@CurrentStaff() staff: AdminPrincipal, @Param('requestId') requestId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const id = requiredText(requestId, UUID_PATTERN);
    whitelistedBody(body ?? {}, []);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    assertAuthorized(staff, 'MANAGE_OUTGOING_FREEZE', { reason: 'confirmation d’une demande motivée' });
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `bo-freeze-confirm:${staff.actorId}:${id}`, key, request: {} }, async (client) => {
      const frozen = await confirmOutgoingFreeze(client, { requestId: id, actorId: staff.actorId });
      const action = frozen ? 'FREEZE' : 'UNFREEZE';
      await appendAuditEvent(client, {
        eventType: 'BACKOFFICE_ACTION', actorId: staff.actorId, action: 'OUTGOING_FREEZE_CONFIRMED', targetType: 'OUTGOING_FREEZE', targetId: id,
        outcome: 'SUCCESS', refs: { request_id: id, freeze_action: action },
      });
      return { status: 200, body: { requestId: id, frozen } };
    });
    if (typeof (result.body as { frozen?: unknown }).frozen !== 'boolean') throw new BusinessError('INTERNAL_ERROR');
    return result.body;
  }
}
