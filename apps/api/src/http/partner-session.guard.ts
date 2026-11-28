import { type CanActivate, createParamDecorator, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import type { RelyingParty } from '../modules/admin/webauthn';
import { resolvePartnerPrincipal, type PartnerPrincipal } from '../modules/catalog/partner-user.store';
import { PG_POOL, withTransaction, type Database } from './database';
import type { HttpRequest } from './express-types';

/** Partie de confiance WebAuthn du portail partenaire (D63) ; null : routes partenaires fermées (503). */
export const PARTNER_RP = Symbol('PARTNER_RP');
export const PARTNER_COOKIE = 'partner_session';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type PartnerRequest = HttpRequest & { partner?: PartnerPrincipal };

/** Valeur unique du cookie partenaire ; un doublon est refusé, jamais départagé. */
export function readPartnerCookie(header: unknown): string | undefined {
  if (typeof header !== 'string' || header.length > 8192) {
    return undefined;
  }
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${PARTNER_COOKIE}=`))
    .map((part) => part.slice(PARTNER_COOKIE.length + 1));
  return values.length === 1 && values[0] !== undefined && TOKEN_PATTERN.test(values[0]) ? values[0] : undefined;
}

export function assertPartnerRp(rp: RelyingParty | null): RelyingParty {
  if (rp === null) {
    throw new BusinessError('PARTNER_AUTH_UNCONFIGURED', 'Authentification des partenaires non configurée');
  }
  return rp;
}

/**
 * SEC-AUTHZ-001 / D63 : exige une session partenaire valide ; partenaire et
 * rôle sont reconstruits en base à chaque requête, jamais lus du client.
 * Une session du personnel (cookie distinct) n'est jamais acceptée ici.
 */
@Injectable()
export class PartnerSessionGuard implements CanActivate {
  public constructor(
    @Inject(PG_POOL) private readonly database: Database,
    @Inject(PARTNER_RP) private readonly rp: RelyingParty | null,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    assertPartnerRp(this.rp);
    const request = context.switchToHttp().getRequest<PartnerRequest>();
    const token = readPartnerCookie(request.headers['cookie']);
    if (token === undefined) {
      throw new BusinessError('PARTNER_AUTH_INVALID', 'Session absente');
    }
    const principal = await withTransaction({ ...this.database, role: 'app_ro' }, (client) => resolvePartnerPrincipal(client, token));
    if (principal === null) {
      throw new BusinessError('PARTNER_AUTH_INVALID', 'Session invalide');
    }
    request.partner = principal;
    return true;
  }
}

export const CurrentPartner = createParamDecorator((_data: unknown, context: ExecutionContext): PartnerPrincipal => {
  const partner = context.switchToHttp().getRequest<PartnerRequest>().partner;
  if (partner === undefined) {
    throw new BusinessError('PARTNER_AUTH_INVALID', 'Session absente');
  }
  return partner;
});
