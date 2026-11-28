import { Body, Controller, Get, Header, HttpCode, Inject, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { JsonValue } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, withTransaction, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentStaff, StaffSessionGuard } from '../http/staff-session.guard';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { appendAuditEvent } from '../modules/audit/audit.store';
import { listSmsChannels, parseNotificationEvent, setSmsChannel, type SmsChannelState } from '../modules/notifications/sms-channel.store';
import { requiredText, whitelistedBody } from './backoffice-body';

const REASON = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]{3,500}$/u;

/**
 * D121 (fondateur, 28 novembre) : le push est le canal de lancement ; l'équipe
 * ouvre ou ferme le SMS par type de notification, d'un geste simple, motivé
 * et inscrit à l'audit chaîné dans la même transaction. La bascule vaut pour
 * les notifications suivantes, jamais pour celles déjà en file.
 */
@Controller('v1/backoffice/notifications')
@UseGuards(StaffSessionGuard)
export class BackofficeNotificationsController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Get('sms-channels')
  @Header('Cache-Control', 'private, no-store')
  public async list(@CurrentStaff() staff: AdminPrincipal): Promise<{ readonly items: readonly SmsChannelState[] }> {
    // Lecture : même droit que la bascule (aucune donnée client), sans motif.
    assertAuthorized(staff, 'MANAGE_NOTIFICATION_CHANNELS', { reason: 'lecture des canaux de notification' });
    const items = await withTransaction({ ...this.database, role: 'app_rw' }, (client) => listSmsChannels(client), { readOnlySnapshot: true });
    return { items };
  }

  @Put('sms-channels/:eventType')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async set(@CurrentStaff() staff: AdminPrincipal, @Param('eventType') eventTypeParam: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const eventType = parseNotificationEvent(eventTypeParam);
    const value = whitelistedBody(body, ['enabled', 'reason']);
    const enabled = value['enabled'];
    if (typeof enabled !== 'boolean') throw new BusinessError('REQUEST_INVALID', 'enabled doit être un booléen');
    const reason = requiredText(value['reason'], REASON).trim();
    assertAuthorized(staff, 'MANAGE_NOTIFICATION_CHANNELS', { reason });
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `sms-channel:${staff.actorId}`, key, request: { eventType, enabled, reason } },
      async (client) => {
        await setSmsChannel(client, { eventType, enabled, actorId: staff.actorId, reason });
        await appendAuditEvent(client, {
          eventType: 'BACKOFFICE_ACTION', actorId: staff.actorId, action: 'SMS_CHANNEL_SET', targetType: 'NOTIFICATION_CHANNEL', targetId: eventType,
          outcome: 'SUCCESS', reason, refs: { channel: 'SMS', enabled },
        });
        return { status: 200, body: { eventType, smsEnabled: enabled } };
      },
    );
    return result.body;
  }
}
