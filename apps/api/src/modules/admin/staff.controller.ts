import { Body, Controller, Delete, Header, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, type Database } from '../../http/database';
import { assertIdempotencyKey, runIdempotent } from '../../http/idempotency';
import type { HttpRequest } from '../../http/express-types';
import { readStaffCookie, STAFF_COOKIE, STAFF_RP } from '../../http/staff-session.guard';
import { issueLoginChallenge, loginStaff, registerStaffCredential, revokeStaffSession } from './staff.store';
import type { RelyingParty } from './webauthn';

type CookieResponse = { cookie(name: string, value: string, options: Record<string, unknown>): void; clearCookie(name: string, options: Record<string, unknown>): void };

const B64URL = /^[A-Za-z0-9_-]{1,8192}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'strict', path: '/v1' } as const;

function invalid(): never {
  throw new BusinessError('REQUEST_INVALID', 'Corps de requête invalide');
}

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

function bytes(value: unknown): Buffer {
  if (typeof value !== 'string' || !B64URL.test(value)) {
    invalid();
  }
  return Buffer.from(value, 'base64url');
}

/**
 * D62 / ADR-0007 (proposé) : connexion du personnel par WebAuthn.
 * Idempotency-Key exigée comme partout (INT-IDEM-001) ; seul le corps est
 * mémorisé (défi public, date d'expiration) : le jeton de session n'existe
 * que dans le cookie posé à la première exécution. Un rejeu ne le redonne
 * pas ; l'agent se reconnecte.
 */
@Controller('v1/staff')
export class StaffAuthController {
  public constructor(
    @Inject(PG_POOL) private readonly database: Database,
    @Inject(STAFF_RP) private readonly rp: RelyingParty | null,
  ) {}

  private relyingParty(): RelyingParty {
    if (this.rp === null) {
      throw new BusinessError('STAFF_AUTH_UNCONFIGURED', 'Authentification du personnel non configurée');
    }
    return this.rp;
  }

  @Post('login-challenges')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  public async challenge(@Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const rp = this.relyingParty();
    const login = only(body, ['login'])['login'];
    if (typeof login !== 'string' || !/^[a-z][a-z0-9._-]{2,63}$/.test(login)) {
      invalid();
    }
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `staff-login-challenge:${login}`, key, request: { login } }, async (client) => {
      const issued = await issueLoginChallenge(client, login);
      return { status: 201, body: { challengeId: issued.challengeId, challenge: issued.challenge.toString('base64url'), rpId: rp.rpId } };
    });
    return result.body;
  }

  /**
   * D62 : enrôlement d'une clé par l'agent, sans session — le jeton remis en
   * main propre fait office de preuve. Le jeton n'entre jamais dans
   * l'empreinte ni dans la réponse mémorisée.
   */
  @Post('credentials')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  public async enroll(@Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const rp = this.relyingParty();
    const value = only(body, ['challengeId', 'enrollmentToken', 'credentialId', 'clientDataJSON', 'authenticatorData', 'publicKeySpki']);
    const challengeId = value['challengeId'];
    const enrollmentToken = value['enrollmentToken'];
    if (typeof challengeId !== 'string' || !UUID.test(challengeId) || typeof enrollmentToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(enrollmentToken)) {
      invalid();
    }
    const credential = {
      credentialId: bytes(value['credentialId']),
      clientDataJSON: bytes(value['clientDataJSON']),
      authenticatorData: bytes(value['authenticatorData']),
      publicKeySpki: bytes(value['publicKeySpki']),
    };
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `staff-credential:${challengeId}`, key, request: { challengeId, credentialId: credential.credentialId.toString('base64url') } },
      async (client) => {
        await registerStaffCredential(client, { rp, challengeId, enrollmentToken, ...credential });
        return { status: 201, body: { enrolled: true } };
      },
    );
    return result.body;
  }

  @Post('sessions')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  public async login(@Req() request: HttpRequest, @Body() body: unknown, @Res({ passthrough: true }) response: CookieResponse): Promise<unknown> {
    const rp = this.relyingParty();
    const value = only(body, ['challengeId', 'credentialId', 'clientDataJSON', 'authenticatorData', 'signature']);
    const challengeId = value['challengeId'];
    if (typeof challengeId !== 'string' || !UUID.test(challengeId)) {
      invalid();
    }
    const assertion = {
      credentialId: bytes(value['credentialId']),
      clientDataJSON: bytes(value['clientDataJSON']),
      authenticatorData: bytes(value['authenticatorData']),
      signature: bytes(value['signature']),
    };
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    // Le jeton reste hors du corps mémorisé : capté ici, posé en cookie seulement à la première exécution.
    let sessionToken: string | null = null;
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `staff-session:${challengeId}`, key, request: { challengeId, signature: assertion.signature.toString('base64url') } },
      async (client) => {
        const session = await loginStaff(client, { rp, challengeId, ...assertion });
        sessionToken = session.sessionToken;
        return { status: 201, body: { expiresAt: session.expiresAt } };
      },
    );
    if (!result.replayed && sessionToken !== null) {
      response.cookie(STAFF_COOKIE, sessionToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60_000 });
    }
    return result.body;
  }

  @Delete('sessions/current')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  public async logout(@Req() request: HttpRequest, @Res({ passthrough: true }) response: CookieResponse): Promise<void> {
    this.relyingParty();
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const token = readStaffCookie(request.headers['cookie']);
    if (token !== undefined) {
      // Portée dérivée de l'empreinte du jeton : le jeton lui-même n'est jamais conservé.
      const scope = `staff-logout:${createHash('sha256').update(token).digest('hex')}`;
      await runIdempotent({ ...this.database, role: 'app_rw' }, { scope, key, request: {} }, async (client) => {
        await revokeStaffSession(client, token);
        return { status: 204, body: {} };
      });
    }
    response.clearCookie(STAFF_COOKIE, COOKIE_OPTIONS);
  }
}
