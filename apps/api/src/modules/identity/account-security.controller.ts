import { Body, Controller, Get, Header, HttpCode, Inject, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { components } from '@achat/contracts/api';
import type { JsonValue } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { CustomerQuota } from '../../http/customer-quota';
import { PG_POOL, withTransaction, type Database } from '../../http/database';
import { assertIdempotencyKey, runIdempotent } from '../../http/idempotency';
import type { HttpRequest } from '../../http/express-types';
import { CurrentCustomer, CustomerSessionGuard, readSessionCookie } from '../../http/session.guard';
import type { AuthenticatedCustomer } from './session.store';
import { assertSecurityBody, mutateAccountSecurity, readAccountSecurity, type SecurityAction } from './account-security.store';

type CookieResponse = { setHeader(name: string, value: readonly string[]): void };
const CLEAR_COOKIES = ['client_session', 'client_refresh'].map((name) =>
  `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);

@Controller()
@UseGuards(CustomerSessionGuard)
export class AccountSecurityController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}
  @Get('v1/me/security')
  @CustomerQuota('SECURITY_READ')
  @Header('Cache-Control', 'private, no-store')
  public overview(@CurrentCustomer() actor: AuthenticatedCustomer, @Query() query: unknown): Promise<unknown> {
    assertSecurityBody('SIGN_OUT', query);
    return withTransaction({ ...this.database, role: 'app_ro' }, (client) => readAccountSecurity(client, actor));
  }
  @Post('v1/me/security/revoke-other-sessions')
  @CustomerQuota('REVOKE_OTHERS')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public others(@CurrentCustomer() actor: AuthenticatedCustomer, @Req() request: HttpRequest, @Body() body: unknown, @Query() query: unknown): Promise<JsonValue> {
    assertSecurityBody('SIGN_OUT', query);
    return this.execute('REVOKE_OTHERS', actor, request, body);
  }
  @Post('v1/me/security/block')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async block(@CurrentCustomer() actor: AuthenticatedCustomer, @Req() request: HttpRequest, @Body() body: unknown, @Query() query: unknown,
    @Res({ passthrough: true }) response: CookieResponse): Promise<JsonValue> {
    assertSecurityBody('SIGN_OUT', query);
    const result = await this.execute('BLOCK', actor, request, body);
    response.setHeader('Set-Cookie', CLEAR_COOKIES);
    return result;
  }
  @Post('v1/auth/signouts')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  public async signout(@CurrentCustomer() actor: AuthenticatedCustomer, @Req() request: HttpRequest, @Body() body: unknown, @Query() query: unknown,
    @Res({ passthrough: true }) response: CookieResponse): Promise<void> {
    assertSecurityBody('SIGN_OUT', query);
    await this.execute('SIGN_OUT', actor, request, body);
    response.setHeader('Set-Cookie', CLEAR_COOKIES);
  }
  private async execute(action: SecurityAction, actor: AuthenticatedCustomer, request: HttpRequest, body: unknown): Promise<JsonValue> {
    assertSecurityBody(action, body);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const cookie = readSessionCookie(typeof request.headers['cookie'] === 'string' ? request.headers['cookie'] : undefined);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, {
      scope: `account-security:${actor.accountId}:${actor.sessionId}:${action}`, key,
      request: action === 'BLOCK' ? { action, reason: 'LOST_OR_STOLEN' } : { action },
    }, async (client) => {
      const mutation = await mutateAccountSecurity(client, actor, cookie, action);
      // JSON null serait confondu avec une réponse SQL encore incomplète.
      // Le contrôleur 204 n'expose pas ce marqueur interne dans le corps HTTP.
      if (action === 'SIGN_OUT') return { status: 204, body: {} };
      const receipt: components['schemas']['AccountSecurityMutation'] = { action, ...mutation };
      return { status: 200, body: { ...receipt } };
    });
    if (result.status !== (action === 'SIGN_OUT' ? 204 : 200)) throw new BusinessError('INTERNAL_ERROR');
    return result.body;
  }
}
