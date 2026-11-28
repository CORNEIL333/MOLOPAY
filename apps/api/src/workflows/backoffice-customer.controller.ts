import { Body, Controller, Header, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PG_POOL, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentStaff, StaffSessionGuard } from '../http/staff-session.guard';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { appendAuditEvent } from '../modules/audit/audit.store';
import { blockAccountBySupport } from '../modules/identity/support-block.store';
import { requiredText, UUID_PATTERN, whitelistedBody } from './backoffice-body';

const REASON = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]{3,500}$/u;

/**
 * C4 / F-ACC-006 : perte ou vol du téléphone — blocage immédiat d'un compte
 * client par le support ou le risque. Une seule personne suffit (le blocage
 * ne fait que protéger, comme la défaillance marchand D31) ; motif
 * obligatoire, inscrit à l'audit chaîné avec l'identifiant du compte.
 */
@Controller('v1/backoffice/customers')
@UseGuards(StaffSessionGuard)
export class BackofficeCustomerController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Post(':accountId/block')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async block(@CurrentStaff() staff: AdminPrincipal, @Param('accountId') accountId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const id = requiredText(accountId, UUID_PATTERN);
    const reason = requiredText(whitelistedBody(body, ['reason'])['reason'], REASON).trim();
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    assertAuthorized(staff, 'BLOCK_CUSTOMER_ACCOUNT', { reason });
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `bo-customer-block:${staff.actorId}:${id}`, key, request: { reason } }, async (client) => {
      const blockedAt = await blockAccountBySupport(client, { accountId: id, reason });
      await appendAuditEvent(client, {
        eventType: 'BACKOFFICE_ACTION',
        actorId: staff.actorId,
        action: 'ACCOUNT_BLOCKED',
        targetType: 'CUSTOMER_ACCOUNT',
        targetId: id,
        outcome: 'SUCCESS',
        reason,
        refs: { account_id: id },
      });
      return { status: 200, body: { accountId: id, status: 'BLOCKED', blockedAt } };
    });
    return result.body;
  }
}
