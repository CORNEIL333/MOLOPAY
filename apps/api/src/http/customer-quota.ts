import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BusinessError } from '@achat/contracts';
import {
  authenticateSessionCookie,
  type AuthenticatedCustomer,
} from '../modules/identity/session.store';
import { PG_POOL, withTransaction, type Database } from './database';
import type { HttpRequest } from './express-types';
import { readSessionCookie } from './session.guard';

// Déconnexion et blocage sont absents à dessein : ces chemins de sécurité
// restent disponibles même quota saturé (SEC-AUTH-005).
export const CUSTOMER_QUOTA_ACTIONS = [
  'SECURITY_READ',
  'REVOKE_OTHERS',
  'DATA_RIGHTS_READ',
  'DATA_RIGHTS_SUBMIT',
  // D60 : routes client du modèle C (le reçu, en lecture, n'est pas limité).
  'BENEFICIARY_DOCUMENT_SUBMIT',
  'BENEFICIARY_PAYMENT',
] as const;
export type CustomerQuotaAction = (typeof CUSTOMER_QUOTA_ACTIONS)[number];

const QUOTA_ACTION = Symbol('CUSTOMER_QUOTA_ACTION');
const MAX_RETRY_AFTER_SECONDS = 86_400;

export function parseCustomerQuotaAction(input: unknown): CustomerQuotaAction {
  if (!(CUSTOMER_QUOTA_ACTIONS as readonly unknown[]).includes(input)) {
    throw new BusinessError('REQUEST_INVALID');
  }
  return input as CustomerQuotaAction;
}

/** Limite atteinte. Le corps ne révèle ni compteur, ni plafond, ni identifiant. */
export class CustomerQuotaExceeded extends BusinessError {
  public constructor(public readonly retryAfterSeconds: number) {
    if (
      !Number.isSafeInteger(retryAfterSeconds) ||
      retryAfterSeconds < 1 ||
      retryAfterSeconds > MAX_RETRY_AFTER_SECONDS
    ) {
      throw new BusinessError('INTERNAL_ERROR');
    }
    super('REQUEST_RATE_LIMITED', '');
  }
}

type QuotaRequest = HttpRequest & { customer?: AuthenticatedCustomer };
type QuotaResponse = { setHeader(name: string, value: string): void };
type QuotaRow = { outcome: string; retry_after_seconds: number | null };

/**
 * Réserve une tentative après authentification, dans sa propre transaction
 * validée avant la commande. Sous le verrou du compte, le jeton est revérifié :
 * une session tournée, révoquée ou expirée pendant l'attente ne consomme rien.
 */
@Injectable()
export class CustomerQuotaGuard implements CanActivate {
  public constructor(
    @Inject(PG_POOL) private readonly database: Database,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = parseCustomerQuotaAction(
      this.reflector.get<unknown>(QUOTA_ACTION, context.getHandler()),
    );
    const http = context.switchToHttp();
    const request = http.getRequest<QuotaRequest>();
    const response = http.getResponse<QuotaResponse>();
    response.setHeader('Cache-Control', 'private, no-store');
    const actor = request.customer;
    const header = request.headers['cookie'];
    const cookie = readSessionCookie(typeof header === 'string' ? header : undefined);
    if (actor === undefined || cookie === undefined) {
      throw new BusinessError('IDENTITY_SESSION_INVALID', 'Session absente');
    }
    const row = await withTransaction({ ...this.database, role: 'app_rw' }, async (client) => {
      const parameters = [actor.accountId, actor.deviceId, actor.sessionId];
      await client.query('SELECT identity.lock_security_actor($1,$2,$3)', parameters);
      const fresh = await authenticateSessionCookie(client, cookie);
      if (
        fresh.accountId !== actor.accountId ||
        fresh.deviceId !== actor.deviceId ||
        fresh.sessionId !== actor.sessionId
      ) {
        throw new BusinessError('IDENTITY_SESSION_INVALID');
      }
      const result = await client.query<QuotaRow>(
        'SELECT outcome, retry_after_seconds FROM identity.consume_customer_quota($1,$2,$3,$4)',
        [...parameters, action],
      );
      return result.rows[0];
    });
    if (row?.outcome === 'ALLOWED') {
      return true;
    }
    if (row?.outcome === 'LIMITED' && row.retry_after_seconds !== null) {
      const refusal = new CustomerQuotaExceeded(row.retry_after_seconds);
      response.setHeader('Retry-After', String(refusal.retryAfterSeconds));
      throw refusal;
    }
    if (row?.outcome === 'UNCONFIGURED') {
      throw new BusinessError('RATE_LIMIT_UNCONFIGURED', '');
    }
    throw new BusinessError('INTERNAL_ERROR');
  }
}

/** Soumet une route à un quota ; à placer sur une route déjà authentifiée. */
export function CustomerQuota(action: CustomerQuotaAction): MethodDecorator {
  return applyDecorators(SetMetadata(QUOTA_ACTION, action), UseGuards(CustomerQuotaGuard));
}
