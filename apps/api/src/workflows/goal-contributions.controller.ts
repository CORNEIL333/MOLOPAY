import { Controller, Get, Header, Inject, Param, UseGuards } from '@nestjs/common';
import { PG_POOL, withTransaction, type Database } from '../http/database';
import { CurrentCustomer, CustomerSessionGuard } from '../http/session.guard';
import { getGoalForCustomer } from '../modules/agreements/goal.api';
import type { AuthenticatedCustomer } from '../modules/identity/session.store';
import { listContributionsForAgreement } from '../modules/payments/receipt.store';

/**
 * F-PAY-006 / D39 : versements confirmés d'un objectif, au seul client de
 * l'objectif (objectif d'un autre client : même « introuvable »). Lecture
 * dans un instantané unique.
 */
@Controller('v1/goals/:goalId/contributions')
@UseGuards(CustomerSessionGuard)
export class GoalContributionsController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  public list(@CurrentCustomer() actor: AuthenticatedCustomer, @Param('goalId') goalId: string): Promise<unknown> {
    return withTransaction({ ...this.database, role: 'app_ro' }, async (client) => {
      await getGoalForCustomer(client, actor.accountId, goalId);
      const asOf = (await client.query<{ now: Date }>('SELECT statement_timestamp() AS now')).rows[0]?.now ?? new Date(0);
      return { contributions: await listContributionsForAgreement(client, { customerId: actor.accountId, agreementId: goalId }), asOf: asOf.toISOString() };
    });
  }
}
