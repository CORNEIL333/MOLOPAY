import { Body, Controller, Header, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentCustomer, CustomerSessionGuard, readSessionCookie } from '../http/session.guard';
import { getGoalForCustomer } from '../modules/agreements/goal.api';
import { CLAIM_REASONS, recordComplaint, recordComplaintDetail, type ClaimReason } from '../modules/disputes/dispute.store';
import { lockDataRightsActor } from '../modules/identity/data-rights.store';
import type { AuthenticatedCustomer } from '../modules/identity/session.store';
import { uuidv7 } from '../modules/ledger/domain';

function invalid(): never {
  throw new BusinessError('REQUEST_INVALID', 'Corps de requête invalide');
}

function parseClaim(body: unknown): { readonly reason: ClaimReason; readonly details: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) invalid();
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.includes('reason') || !keys.includes('details')) invalid();
  const { reason, details } = body as { reason: unknown; details: unknown };
  if (typeof reason !== 'string' || !(CLAIM_REASONS as readonly string[]).includes(reason)) invalid();
  if (typeof details !== 'string' || details.trim().length < 10 || details.length > 1000) invalid();
  return { reason: reason as ClaimReason, details: details.trim() };
}

/**
 * F-SUP-001 / D70 : le client ouvre une réclamation sur son objectif depuis
 * l'application. Accusé de réception immédiat (numéro `R-…`, heure serveur) ;
 * objectif d'un autre client : même « introuvable », rien n'est enregistré.
 */
@Controller('v1/goals/:goalId/claims')
@UseGuards(CustomerSessionGuard)
export class GoalClaimsController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async create(@CurrentCustomer() actor: AuthenticatedCustomer, @Param('goalId') goalId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const claim = parseClaim(body);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const cookie = readSessionCookie(typeof request.headers['cookie'] === 'string' ? request.headers['cookie'] : undefined);
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `goal-claim:${actor.accountId}:${goalId}`, key, request: claim, authorize: (client) => lockDataRightsActor(client, actor, cookie) },
      async (client) => {
        await getGoalForCustomer(client, actor.accountId, goalId);
        const recorded = await recordComplaint(client, { id: uuidv7(), customerId: actor.accountId, agreementId: goalId, channel: 'APP' });
        await recordComplaintDetail(client, { complaintId: recorded.id, ...claim });
        return { status: 201, body: { claimId: recorded.id, reference: recorded.reference, status: 'OPEN', createdAt: recorded.receivedAt } };
      },
    );
    return result.body;
  }
}
