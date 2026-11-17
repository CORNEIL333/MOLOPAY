import { Body, Controller, Header, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import { CustomerQuota } from '../http/customer-quota';
import { PG_POOL, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentCustomer, CustomerSessionGuard, readSessionCookie } from '../http/session.guard';
import { lockDataRightsActor } from '../modules/identity/data-rights.store';
import { parseLegalName } from '../modules/identity/legal-name.store';
import type { AuthenticatedCustomer } from '../modules/identity/session.store';
import { declareLegalNameAndScreen } from './kyc-basic-level';

/**
 * REG-LBC-001 / D68 : le client déclare son nom légal (niveau 1). La réponse
 * ne distingue jamais un rapprochement d'une vérification ordinaire en cours
 * (interdiction d'alerter la personne, LBC/FT) ; le nom n'est pas renvoyé.
 */
@Controller('v1/me/legal-name')
@UseGuards(CustomerSessionGuard)
export class LegalNameController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Post()
  @CustomerQuota('LEGAL_NAME_DECLARE')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async declare(@CurrentCustomer() actor: AuthenticatedCustomer, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).length !== 1 || !('legalName' in body)) {
      throw new BusinessError('REQUEST_INVALID', 'Corps de requête invalide');
    }
    const legalName = parseLegalName(body.legalName);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const cookie = readSessionCookie(typeof request.headers['cookie'] === 'string' ? request.headers['cookie'] : undefined);
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `legal-name:${actor.accountId}`, key, request: { legalName }, authorize: (client) => lockDataRightsActor(client, actor, cookie) },
      async (client) => {
        const outcome = await declareLegalNameAndScreen(client, { accountId: actor.accountId, legalName });
        const granted = outcome.kycLevel === 'BASIC' || outcome.kycLevel === 'STRONG';
        return { status: 201, body: { kycLevel: granted ? outcome.kycLevel : 'NONE', verification: granted ? 'COMPLETED' : 'IN_PROGRESS' } };
      },
    );
    return result.body;
  }
}
