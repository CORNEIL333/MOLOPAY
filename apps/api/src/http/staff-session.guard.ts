import { type CanActivate, createParamDecorator, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import type { AdminPrincipal } from '../modules/admin/domain';
import { resolveStaffPrincipal } from '../modules/admin/staff.store';
import type { RelyingParty } from '../modules/admin/webauthn';
import { PG_POOL, withTransaction, type Database } from './database';
import type { HttpRequest } from './express-types';

/** Partie de confiance WebAuthn du back-office ; null : routes du personnel fermées (503). */
export const STAFF_RP = Symbol('STAFF_RP');
export const STAFF_COOKIE = 'staff_session';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type StaffRequest = HttpRequest & { staff?: AdminPrincipal };

/** Valeur unique du cookie du personnel ; un doublon est refusé, jamais départagé. */
export function readStaffCookie(header: unknown): string | undefined {
  if (typeof header !== 'string' || header.length > 8192) {
    return undefined;
  }
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${STAFF_COOKIE}=`))
    .map((part) => part.slice(STAFF_COOKIE.length + 1));
  return values.length === 1 && values[0] !== undefined && TOKEN_PATTERN.test(values[0]) ? values[0] : undefined;
}

/**
 * SEC-AUTHZ-001 / D62 : exige une session du personnel valide ; le principal
 * (rôles, villes, plafond) est reconstruit en base à chaque requête.
 */
@Injectable()
export class StaffSessionGuard implements CanActivate {
  public constructor(
    @Inject(PG_POOL) private readonly database: Database,
    @Inject(STAFF_RP) private readonly rp: RelyingParty | null,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.rp === null) {
      throw new BusinessError('STAFF_AUTH_UNCONFIGURED', 'Authentification du personnel non configurée');
    }
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const token = readStaffCookie(request.headers['cookie']);
    if (token === undefined) {
      throw new BusinessError('STAFF_AUTH_INVALID', 'Session absente');
    }
    const principal = await withTransaction({ ...this.database, role: 'app_ro' }, (client) => resolveStaffPrincipal(client, token));
    if (principal === null) {
      throw new BusinessError('STAFF_AUTH_INVALID', 'Session invalide');
    }
    request.staff = principal;
    return true;
  }
}

export const CurrentStaff = createParamDecorator((_data: unknown, context: ExecutionContext): AdminPrincipal => {
  const staff = context.switchToHttp().getRequest<StaffRequest>().staff;
  if (staff === undefined) {
    throw new BusinessError('STAFF_AUTH_INVALID', 'Session absente');
  }
  return staff;
});
