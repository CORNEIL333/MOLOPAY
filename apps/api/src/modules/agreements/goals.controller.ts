import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { JsonValue } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, withTransaction, type Database } from '../../http/database';
import type { HttpRequest } from '../../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../../http/idempotency';
import { CurrentCustomer, CustomerSessionGuard } from '../../http/session.guard';
import { createGoalDraft, getGoalForCustomer, listGoalsForCustomer, parseGoalRequest } from './goal.api';

/** Client authentifié par la garde de session (seul l'identifiant de compte sert ici). */
type AuthenticatedCustomer = { readonly accountId: string };

/**
 * D32 : objectifs du client authentifié (CDC_05 § 5.2). Lecture et création
 * du brouillon ; l'activation signée fera l'objet d'une route distincte.
 */
@Controller()
@UseGuards(CustomerSessionGuard)
export class GoalsController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Get('v1/goals')
  @Header('Cache-Control', 'private, no-store')
  public list(@CurrentCustomer() actor: AuthenticatedCustomer): Promise<unknown> {
    return withTransaction({ ...this.database, role: 'app_ro' }, async (client) => ({
      goals: await listGoalsForCustomer(client, actor.accountId),
      asOf: new Date().toISOString(),
    }));
  }

  @Get('v1/goals/:goalId')
  @Header('Cache-Control', 'private, no-store')
  public one(@CurrentCustomer() actor: AuthenticatedCustomer, @Param('goalId') goalId: string): Promise<unknown> {
    return withTransaction({ ...this.database, role: 'app_ro' }, (client) =>
      getGoalForCustomer(client, actor.accountId, goalId),
    );
  }

  @Post('v1/goals')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async create(
    @CurrentCustomer() actor: AuthenticatedCustomer,
    @Req() request: HttpRequest,
    @Body() body: unknown,
  ): Promise<JsonValue> {
    const goalRequest = parseGoalRequest(body);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `goals:${actor.accountId}`, key, request: { ...goalRequest } },
      async (client) => ({ status: 201, body: { ...(await createGoalDraft(client, actor.accountId, goalRequest)) } }),
    );
    if (result.status !== 201) {
      throw new BusinessError('INTERNAL_ERROR');
    }
    return result.body;
  }
}
