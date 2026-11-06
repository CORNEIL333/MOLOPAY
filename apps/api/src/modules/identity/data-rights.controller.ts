import { Body, Controller, Get, Header, HttpCode, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import type { JsonValue } from '@achat/chain';
import { CustomerQuota } from '../../http/customer-quota';
import { PG_POOL, withTransaction, type Database } from '../../http/database';
import { assertIdempotencyKey, runIdempotent } from '../../http/idempotency';
import type { HttpRequest } from '../../http/express-types';
import { CurrentCustomer, CustomerSessionGuard, readSessionCookie } from '../../http/session.guard';
import type { AuthenticatedCustomer } from './session.store';
import { assertSecurityBody } from './account-security.store';
import { listDataRights, lockDataRightsActor, parseDataRight, parseRightsCursor, submitDataRight, verifyDataRightsActor } from './data-rights.store';

@Controller('v1/me/data-rights')
@UseGuards(CustomerSessionGuard)
export class DataRightsController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}
  @Get()
  @CustomerQuota('DATA_RIGHTS_READ')
  @Header('Cache-Control', 'private, no-store')
  public list(@CurrentCustomer() actor: AuthenticatedCustomer, @Req() request: HttpRequest, @Query() query: unknown): Promise<unknown> {
    const before = parseRightsCursor(query);
    // app_rw est nécessaire pour comparer le haché du jeton sous verrou ;
    // cette lecture ne réalise aucune écriture et n'élargit pas app_ro.
    return withTransaction({ ...this.database, role: 'app_rw' }, async (client) => {
      // La fonction de lecture a verrouillé le contexte avant de lire la page.
      const result = await listDataRights(client, actor, before);
      await verifyDataRightsActor(client, actor, this.cookie(request));
      return result;
    });
  }
  @Post()
  @CustomerQuota('DATA_RIGHTS_SUBMIT')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async submit(@CurrentCustomer() actor: AuthenticatedCustomer, @Req() request: HttpRequest, @Query() query: unknown, @Body() body: unknown): Promise<JsonValue> {
    assertSecurityBody('SIGN_OUT', query);
    const kind = parseDataRight(body);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, {
      scope: `data-rights:${actor.accountId}:submit`, key, request: { kind },
      authorize: (client) => lockDataRightsActor(client, actor, this.cookie(request)),
    }, async (client) => {
      return { status: 201, body: { ...await submitDataRight(client, actor, kind) } };
    });
    if (result.status !== 201) throw new BusinessError('INTERNAL_ERROR');
    return result.body;
  }
  private cookie(request: HttpRequest): string | undefined {
    return readSessionCookie(typeof request.headers['cookie'] === 'string' ? request.headers['cookie'] : undefined);
  }
}
