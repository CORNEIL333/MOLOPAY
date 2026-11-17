import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PG_POOL, withTransaction, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentStaff, StaffSessionGuard } from '../http/staff-session.guard';
import type { AdminPrincipal } from '../modules/admin/domain';
import { oneOf, requiredText, UUID_PATTERN, whitelistedBody } from './backoffice-body';
import { partnerScreeningStatus, reviewSanctionsMatch, screenPartner } from './sanctions-screening';

const PARTNER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const REASON = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]{3,1000}$/u;

/** REG-LBC-002 / D66 : filtrage sanctions des partenaires au back-office (fermé par défaut comme le reste). */
@Controller('v1/backoffice')
@UseGuards(StaffSessionGuard)
export class BackofficeKycController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Post('partners/:partnerId/screenings')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async screen(@CurrentStaff() staff: AdminPrincipal, @Param('partnerId') partnerId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const id = requiredText(partnerId, PARTNER_ID);
    whitelistedBody(body ?? {}, []);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `bo-screen-partner:${staff.actorId}:${id}`, key, request: {} }, async (client) => {
      const screening = await screenPartner(client, { principal: staff, partnerId: id });
      return { status: 201, body: { screeningId: screening.screeningId, partnerId: id, versionId: screening.versionId, outcome: screening.outcome, matchedReferences: [...screening.matchedReferences] } };
    });
    return result.body;
  }

  @Get('partners/:partnerId/screening')
  @Header('Cache-Control', 'private, no-store')
  public async status(@CurrentStaff() staff: AdminPrincipal, @Param('partnerId') partnerId: string): Promise<unknown> {
    const id = requiredText(partnerId, PARTNER_ID);
    const status = await withTransaction({ ...this.database, role: 'app_ro' }, (client) => partnerScreeningStatus(client, { principal: staff, partnerId: id }));
    return { partnerId: id, status };
  }

  @Post('screenings/:screeningId/review')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async review(@CurrentStaff() staff: AdminPrincipal, @Param('screeningId') screeningId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const id = requiredText(screeningId, UUID_PATTERN);
    const value = whitelistedBody(body, ['decision', 'reason']);
    const decision = oneOf(value['decision'], ['FALSE_POSITIVE', 'CONFIRMED_MATCH'] as const);
    const reason = requiredText(value['reason'], REASON);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `bo-screening-review:${staff.actorId}:${id}`, key, request: { decision, reason } }, async (client) => {
      await reviewSanctionsMatch(client, { principal: staff, screeningId: id, decision, reason });
      return { status: 200, body: { screeningId: id, decision } };
    });
    return result.body;
  }
}
