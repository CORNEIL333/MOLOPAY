import { Body, Controller, Header, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, type Database } from '../../http/database';
import type { HttpRequest } from '../../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../../http/idempotency';
import { rotateSessionFromStore } from './auth.store';
import { issuedSessionCookies, readRefreshCookie } from './client-cookies';
import type { IssuedSession } from './domain';

type CookieResponse = { setHeader(name: string, value: readonly string[]): void };

/**
 * SEC-AUTH-001 / C2 : renouvellement de la session client. Le jeton de
 * rafraîchissement (cookie `client_refresh`) est à usage unique : la base le
 * remplace atomiquement (`rotateSessionFromStore`), vérifie compte, appareil
 * et fenêtre sur son horloge. Les cookies ne sont émis qu'à la première
 * exécution (une réponse rejouée n'en contient aucun).
 */
@Controller('v1/auth')
export class ClientSessionController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Post('session-refreshes')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  public async refresh(@Req() request: HttpRequest, @Body() body: unknown, @Res({ passthrough: true }) response: CookieResponse): Promise<unknown> {
    if (body !== undefined && (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).length !== 0)) {
      throw new BusinessError('REQUEST_INVALID', 'Corps de requête invalide');
    }
    const cookie = readRefreshCookie(typeof request.headers['cookie'] === 'string' ? request.headers['cookie'] : undefined);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    let issued: IssuedSession | null = null;
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `client-refresh:${cookie.sessionId}`, key, request: {} },
      async (client) => {
        issued = await rotateSessionFromStore(client, { sessionId: cookie.sessionId, refreshToken: cookie.refreshToken });
        return { status: 201, body: { accessExpiresAt: issued.session.accessExpiresAt } };
      },
    );
    if (!result.replayed && issued !== null) {
      response.setHeader('Set-Cookie', issuedSessionCookies(issued));
    }
    return result.body;
  }
}
