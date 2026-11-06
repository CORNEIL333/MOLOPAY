import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { PG_POOL, withTransaction, type Database } from '../../http/database';
import { getPublicOffer, listPublicOffers, parsePublicOfferFilter, parsePublicOfferId, type PublicOffer, type PublicOfferList } from './public-offer.store';

@Controller('v1/offers')
export class PublicOfferController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}
  @Get()
  public list(@Query() query: unknown): Promise<PublicOfferList> {
    const filter = parsePublicOfferFilter(query);
    return withTransaction({ ...this.database, role: 'app_ro' }, (client) => listPublicOffers(client, filter));
  }
  @Get(':offerId')
  public detail(@Param('offerId') offerId: string): Promise<PublicOffer> {
    const id = parsePublicOfferId(offerId);
    return withTransaction({ ...this.database, role: 'app_ro' }, (client) => getPublicOffer(client, id));
  }
}
