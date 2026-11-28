import { Body, Controller, Get, Header, HttpCode, Inject, Post, Put, Req, UseGuards } from '@nestjs/common';
import { BusinessError, CURRENT_TERMS_VERSION } from '@achat/contracts';
import { PG_POOL, withTransaction, type Database } from '../../http/database';
import type { HttpRequest } from '../../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../../http/idempotency';
import { CurrentCustomer, CustomerSessionGuard } from '../../http/session.guard';
import { declareLanguage, parseAppLanguage } from './language.store';
import { readCustomerProfile, type CustomerProfile } from './profile.store';
import type { AuthenticatedCustomer } from './session.store';
import { acceptCurrentTerms } from './terms.store';

/** C2 : profil du client connecté (lecture seule, instantané unique) ; F-ACC-004 : acceptation des conditions en vigueur. */
@Controller('v1/me')
@UseGuards(CustomerSessionGuard)
export class ProfileController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  public read(@CurrentCustomer() actor: AuthenticatedCustomer): Promise<CustomerProfile> {
    return withTransaction({ ...this.database, role: 'app_ro' }, (client) => readCustomerProfile(client, actor.accountId), { readOnlySnapshot: true });
  }

  /** F-ACC-004 : le client accepte la version courante (et seulement elle) ; horodatage posé par la base. */
  @Post('terms-acceptances')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async accept(@CurrentCustomer() actor: AuthenticatedCustomer, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).join() !== 'version') {
      throw new BusinessError('REQUEST_INVALID', 'Corps de requête invalide');
    }
    const version = (body as { version: unknown }).version;
    if (version !== CURRENT_TERMS_VERSION) {
      throw new BusinessError('REQUEST_INVALID', 'version des conditions non courante');
    }
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `terms:${actor.accountId}`, key, request: { version } }, async (client) => ({
      status: 201,
      body: { ...(await acceptCurrentTerms(client, actor.accountId)) },
    }));
    return result.body;
  }

  /**
   * D121 : l'application déclare la langue choisie par le client (fr ou en) ;
   * les notifications suivantes partent dans cette langue. Rejouable.
   */
  @Put('language')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async language(@CurrentCustomer() actor: AuthenticatedCustomer, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).join() !== 'language') {
      throw new BusinessError('REQUEST_INVALID', 'Corps de requête invalide');
    }
    const language = parseAppLanguage((body as { language: unknown }).language);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `language:${actor.accountId}`, key, request: { language } }, async (client) => ({
      status: 200,
      body: { language: await declareLanguage(client, actor.accountId, language) },
    }));
    return result.body;
  }
}
