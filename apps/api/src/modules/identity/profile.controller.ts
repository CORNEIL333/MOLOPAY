import { Controller, Get, Header, Inject, UseGuards } from '@nestjs/common';
import { PG_POOL, withTransaction, type Database } from '../../http/database';
import { CurrentCustomer, CustomerSessionGuard } from '../../http/session.guard';
import { readCustomerProfile, type CustomerProfile } from './profile.store';
import type { AuthenticatedCustomer } from './session.store';

/** C2 : profil du client connecté (lecture seule, instantané unique). */
@Controller('v1/me')
@UseGuards(CustomerSessionGuard)
export class ProfileController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  public read(@CurrentCustomer() actor: AuthenticatedCustomer): Promise<CustomerProfile> {
    return withTransaction({ ...this.database, role: 'app_ro' }, (client) => readCustomerProfile(client, actor.accountId), { readOnlySnapshot: true });
  }
}
