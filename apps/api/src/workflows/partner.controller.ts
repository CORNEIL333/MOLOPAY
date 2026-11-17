import { Body, Controller, Delete, Header, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { assertPartnerRp, CurrentPartner, PARTNER_COOKIE, PARTNER_RP, PartnerSessionGuard, readPartnerCookie } from '../http/partner-session.guard';
import type { RelyingParty } from '../modules/admin/webauthn';
import { issuePartnerLoginChallenge, resolvePartnerPrincipal, revokePartnerSession, type PartnerPrincipal } from '../modules/catalog/partner-user.store';
import { confirmHandoverAtPartner } from './handover';
import { loginPartner, registerPartnerCredential } from './partner-auth';

type CookieResponse = { cookie(name: string, value: string, options: Record<string, unknown>): void; clearCookie(name: string, options: Record<string, unknown>): void };

/** Poivre des codes de remise (configuration, D45) ; null : remise au comptoir fermée (503). */
export const HANDOVER_PEPPER = Symbol('HANDOVER_PEPPER');

const B64URL = /^[A-Za-z0-9_-]{1,8192}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOGIN = /^[a-z][a-z0-9._-]{2,63}$/;
// Saisie du vendeur (D45) : 10 caractères Crockford, tirets et espaces tolérés ; normalisée par le store.
const CODE = /^[0-9A-Za-z -]{10,16}$/;
const COORDINATE = /^-?\d{1,3}(\.\d{1,6})?$/;
const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'strict', path: '/v1' } as const;

function invalid(): never {
  throw new BusinessError('REQUEST_INVALID', 'Corps de requête invalide');
}

/** Corps en liste blanche stricte : exactement ces champs. */
function only(body: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid();
  }
  const value = body as Record<string, unknown>;
  const present = Object.keys(value);
  if (present.length !== keys.length || !present.every((key) => keys.includes(key))) {
    invalid();
  }
  return value;
}

function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    invalid();
  }
  return value;
}

function bytes(value: unknown): Buffer {
  return Buffer.from(text(value, B64URL), 'base64url');
}

/**
 * D63 (SEC-AUTH-006) : connexion des partenaires par WebAuthn, même
 * mécanique que le personnel (D62) dans un espace distinct (cookie
 * `partner_session`, partie de confiance propre). Idempotency-Key exigée ;
 * seul le corps est mémorisé : le jeton n'existe que dans le cookie posé à
 * la première exécution.
 */
@Controller('v1/partner')
export class PartnerAuthController {
  public constructor(
    @Inject(PG_POOL) private readonly database: Database,
    @Inject(PARTNER_RP) private readonly rp: RelyingParty | null,
  ) {}

  @Post('login-challenges')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  public async challenge(@Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const rp = assertPartnerRp(this.rp);
    const login = text(only(body, ['login'])['login'], LOGIN);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `partner-login-challenge:${login}`, key, request: { login } }, async (client) => {
      const issued = await issuePartnerLoginChallenge(client, login);
      return { status: 201, body: { challengeId: issued.challengeId, challenge: issued.challenge.toString('base64url'), rpId: rp.rpId } };
    });
    return result.body;
  }

  /** Enrôlement d'une clé avec le jeton remis en main propre (jamais mémorisé). */
  @Post('credentials')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  public async enroll(@Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const rp = assertPartnerRp(this.rp);
    const value = only(body, ['challengeId', 'enrollmentToken', 'credentialId', 'clientDataJSON', 'authenticatorData', 'publicKeySpki']);
    const challengeId = text(value['challengeId'], UUID);
    const enrollmentToken = text(value['enrollmentToken'], /^[A-Za-z0-9_-]{43}$/);
    const credential = {
      credentialId: bytes(value['credentialId']),
      clientDataJSON: bytes(value['clientDataJSON']),
      authenticatorData: bytes(value['authenticatorData']),
      publicKeySpki: bytes(value['publicKeySpki']),
    };
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `partner-credential:${challengeId}`, key, request: { challengeId, credentialId: credential.credentialId.toString('base64url') } },
      async (client) => {
        await registerPartnerCredential(client, { rp, challengeId, enrollmentToken, ...credential });
        return { status: 201, body: { enrolled: true } };
      },
    );
    return result.body;
  }

  @Post('sessions')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  public async login(@Req() request: HttpRequest, @Body() body: unknown, @Res({ passthrough: true }) response: CookieResponse): Promise<unknown> {
    const rp = assertPartnerRp(this.rp);
    const value = only(body, ['challengeId', 'credentialId', 'clientDataJSON', 'authenticatorData', 'signature']);
    const challengeId = text(value['challengeId'], UUID);
    const assertion = {
      credentialId: bytes(value['credentialId']),
      clientDataJSON: bytes(value['clientDataJSON']),
      authenticatorData: bytes(value['authenticatorData']),
      signature: bytes(value['signature']),
    };
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    let sessionToken: string | null = null;
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `partner-session:${challengeId}`, key, request: { challengeId, signature: assertion.signature.toString('base64url') } },
      async (client) => {
        const session = await loginPartner(client, { rp, challengeId, ...assertion });
        const principal = await resolvePartnerPrincipal(client, session.sessionToken);
        if (principal === null) {
          throw new BusinessError('PARTNER_AUTH_INVALID', 'Authentification refusée');
        }
        sessionToken = session.sessionToken;
        return { status: 201, body: { partnerId: principal.partnerId, login: principal.login, role: principal.role, expiresAt: session.expiresAt } };
      },
    );
    if (!result.replayed && sessionToken !== null) {
      response.cookie(PARTNER_COOKIE, sessionToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60_000 });
    }
    return result.body;
  }

  @Delete('sessions/current')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  public async logout(@Req() request: HttpRequest, @Res({ passthrough: true }) response: CookieResponse): Promise<void> {
    assertPartnerRp(this.rp);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const token = readPartnerCookie(request.headers['cookie']);
    if (token !== undefined) {
      const scope = `partner-logout:${createHash('sha256').update(token).digest('hex')}`;
      await runIdempotent({ ...this.database, role: 'app_rw' }, { scope, key, request: {} }, async (client) => {
        await revokePartnerSession(client, token);
        return { status: 204, body: {} };
      });
    }
    response.clearCookie(PARTNER_COOKIE, COOKIE_OPTIONS);
  }
}

/**
 * F-SET-001 au comptoir (D63) : partenaire et vendeur sont ceux de la
 * session, jamais du corps ; la base vérifie en plus que le vendeur est un
 * compte actif du marchand (0058). Code inconnu ou d'un autre marchand :
 * même réponse (aucun oracle).
 */
@Controller('v1/partner/handovers')
@UseGuards(PartnerSessionGuard)
export class PartnerHandoverController {
  public constructor(
    @Inject(PG_POOL) private readonly database: Database,
    @Inject(HANDOVER_PEPPER) private readonly pepper: Uint8Array | null,
  ) {}

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  public async confirm(@CurrentPartner() partner: PartnerPrincipal, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const pepper = this.pepper;
    if (pepper === null) {
      throw new BusinessError('HANDOVER_UNCONFIGURED', 'Remise au comptoir non configurée');
    }
    const value = only(body, ['code', 'latitude', 'longitude']);
    const input = { code: text(value['code'], CODE), latitude: text(value['latitude'], COORDINATE), longitude: text(value['longitude'], COORDINATE) };
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `partner-handover:${partner.userId}`, key, request: input }, async (client) => {
      const done = await confirmHandoverAtPartner(client, { ...input, partnerId: partner.partnerId, partnerUserId: partner.userId, pepper });
      return { status: 201, body: { agreementId: done.agreementId, validatedAt: done.handedOverAt } };
    });
    return result.body;
  }
}
