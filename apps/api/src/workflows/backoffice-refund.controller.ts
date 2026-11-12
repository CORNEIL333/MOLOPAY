import { Body, Controller, Header, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { JsonValue } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentStaff, StaffSessionGuard } from '../http/staff-session.guard';
import type { AdminPrincipal } from '../modules/admin/domain';
import { decideRefund } from './refund';

/**
 * D49 / D62 : première route du back-office. Décision sur un remboursement
 * préparé, par une autre personne (I-7, vérifié aussi en base), avec le
 * principal reconstruit depuis la session WebAuthn du personnel.
 */
@Controller('v1/backoffice')
@UseGuards(StaffSessionGuard)
export class BackofficeRefundController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Post('refunds/:refundId/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async decide(@CurrentStaff() staff: AdminPrincipal, @Param('refundId') refundId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BusinessError('REQUEST_INVALID', 'Corps de requête invalide');
    }
    const value = body as Record<string, unknown>;
    const keys = Object.keys(value);
    const decision = value['decision'];
    const reason = value['reason'];
    if (!keys.every((key) => key === 'decision' || key === 'reason') || (decision !== 'APPROVED' && decision !== 'REJECTED')
      || (reason !== undefined && typeof reason !== 'string')) {
      throw new BusinessError('REQUEST_INVALID', 'Corps de requête invalide');
    }
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `backoffice-refund-decision:${staff.actorId}:${refundId}`, key, request: { refundId, decision, reason: reason ?? null } },
      async (client) => {
        await decideRefund(client, { refundId, principal: staff, decision, ...(typeof reason === 'string' ? { reason } : {}) });
        return { status: 200, body: { refundId, decision } };
      },
    );
    if (result.status !== 200) {
      throw new BusinessError('INTERNAL_ERROR');
    }
    return result.body;
  }
}
