import { createHash } from 'node:crypto';
import { Body, Controller, Header, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, withTransaction, type Database } from '../../http/database';
import type { HttpRequest } from '../../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../../http/idempotency';
import { rotateSessionFromStore } from './auth.store';
import { revokeOnRefreshReuse, verifyDeviceRefresh } from './client-auth.store';
import { issuedSessionCookies, readRefreshCookie } from './client-cookies';
import { sessionTokenHash, type IssuedSession } from './domain';

type CookieResponse = { setHeader(name: string, value: readonly string[]): void };

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * SEC-AUTH-001 / SEC-AUTH-005 / C2 : renouvellement de la session client,
 * lié à l'appareil : signature d'un défi REFRESH par la clé de l'appareil de
 * la session, plus le jeton de rafraîchissement (cookie `client_refresh`) à
 * usage unique, remplacé atomiquement par la base. Un ancien jeton présenté
 * par l'appareil légitime révoque la session (vol présumé). Les cookies ne
 * sont émis qu'à la première exécution (une réponse rejouée n'en a aucun).
 */
@Controller('v1/auth')
export class ClientSessionController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Post('session-refreshes')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  public async refresh(@Req() request: HttpRequest, @Body() body: unknown, @Res({ passthrough: true }) response: CookieResponse): Promise<unknown> {
    if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).sort().join() !== 'challengeId,signature') {
      throw new BusinessError('REQUEST_INVALID', 'Corps de requête invalide : challengeId et signature');
    }
    const { challengeId, signature } = body as Record<string, unknown>;
    if (typeof challengeId !== 'string' || !UUID_V7.test(challengeId) || typeof signature !== 'string' || !/^[A-Za-z0-9+/_-]{80,90}={0,2}$/.test(signature)) {
      throw new BusinessError('REQUEST_INVALID', 'challengeId ou signature invalide');
    }
    const cookie = readRefreshCookie(typeof request.headers['cookie'] === 'string' ? request.headers['cookie'] : undefined);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const signatureBytes = Buffer.from(signature, 'base64');
    // Étape 1, validée seule (SEC-AUTH-005) : preuve de l'appareil de la session, défi consommé.
    const verified = await withTransaction({ ...this.database, role: 'app_rw' }, (client) =>
      verifyDeviceRefresh(client, { sessionId: cookie.sessionId, challengeId, signature: signatureBytes }),
    );
    if (!verified.ok && verified.error.code !== 'IDENTITY_SESSION_INVALID') {
      throw verified.error;
    }
    let issued: IssuedSession | null = null;
    let result: Awaited<ReturnType<typeof runIdempotent>>;
    try {
      result = await runIdempotent(
        { ...this.database, role: 'app_rw' },
        { scope: `client-refresh:${cookie.sessionId}`, key, request: { challengeId, signature: createHash('sha256').update(signatureBytes).digest('hex') } },
        async (client) => {
          if (!verified.ok) throw verified.error;
          issued = await rotateSessionFromStore(client, { sessionId: cookie.sessionId, refreshToken: cookie.refreshToken });
          return { status: 201, body: { accessExpiresAt: issued.session.accessExpiresAt } };
        },
      );
    } catch (error: unknown) {
      // Appareil prouvé mais jeton périmé : un tiers a déjà utilisé le jeton volé ; la session est révoquée.
      if (verified.ok && error instanceof BusinessError && error.code === 'IDENTITY_SESSION_INVALID') {
        await withTransaction({ ...this.database, role: 'app_rw' }, (client) =>
          revokeOnRefreshReuse(client, { sessionId: cookie.sessionId, refreshTokenHash: sessionTokenHash(cookie.refreshToken) }),
        );
      }
      throw error;
    }
    if (!result.replayed && issued !== null) {
      response.setHeader('Set-Cookie', issuedSessionCookies(issued));
    }
    return result.body;
  }
}
