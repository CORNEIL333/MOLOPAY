import { Controller, Get, Header, Inject, Query, UseGuards } from '@nestjs/common';
import { PG_POOL, withTransaction, type Database } from '../http/database';
import { CurrentCustomer, CustomerSessionGuard } from '../http/session.guard';
import type { AuthenticatedCustomer } from '../modules/identity/session.store';
import { listCustomerFeed, parseFeedCursor, type CustomerFeed } from '../modules/notifications/feed.store';

/** C5 / F-NOT-001 : fil des notifications dans l'application, indépendant de tout prestataire SMS ou push. */
@Controller('v1/me/notifications')
@UseGuards(CustomerSessionGuard)
export class NotificationFeedController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  public list(@CurrentCustomer() actor: AuthenticatedCustomer, @Query() query: unknown): Promise<CustomerFeed> {
    const before = parseFeedCursor(query);
    return withTransaction({ ...this.database, role: 'app_rw' }, (client) => listCustomerFeed(client, actor, before));
  }
}
