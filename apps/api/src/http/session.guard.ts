import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import type { HttpRequest } from './express-types';
import {
  authenticateSessionCookie,
  type AuthenticatedCustomer,
} from '../modules/identity/session.store';
import { PG_POOL, withTransaction, type Database } from './database';

export const SESSION_COOKIE = 'client_session';

type CustomerRequest = HttpRequest & { customer?: AuthenticatedCustomer };

/**
 * Valeur unique du cookie de session. Un cookie dupliqué (injection par un
 * sous-domaine) est refusé plutôt que départagé.
 */
export function readSessionCookie(header: string | undefined): string | undefined {
  if (typeof header !== 'string' || header.length > 8192) {
    return undefined;
  }
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`))
    .map((part) => part.slice(SESSION_COOKIE.length + 1));
  if (values.length !== 1) {
    return undefined;
  }
  return values[0];
}

/** Exige une session client valide, vérifiée en base à chaque requête. */
@Injectable()
export class CustomerSessionGuard implements CanActivate {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const header = request.headers['cookie'];
    const cookie = readSessionCookie(typeof header === 'string' ? header : undefined);
    if (cookie === undefined) {
      throw new BusinessError('IDENTITY_SESSION_INVALID', 'Session absente');
    }
    request.customer = await withTransaction(this.database, (client) =>
      authenticateSessionCookie(client, cookie),
    );
    return true;
  }
}

/** Client authentifié par CustomerSessionGuard. */
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedCustomer => {
    const customer = context.switchToHttp().getRequest<CustomerRequest>().customer;
    if (customer === undefined) {
      throw new BusinessError('IDENTITY_SESSION_INVALID', 'Session absente');
    }
    return customer;
  },
);
