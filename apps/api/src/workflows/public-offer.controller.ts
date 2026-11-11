import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { PG_POOL, withTransaction, type Database } from '../http/database';
import { availableUnits } from '../modules/agreements/stock.store';
import {
  getPublicOffer,
  listPublicOffers,
  parsePublicOfferFilter,
  parsePublicOfferId,
  type PublicOffer,
  type PublicOfferList,
} from '../modules/catalog/public-offer.store';

type SqlClient = Parameters<Parameters<typeof withTransaction>[1]>[0];

/** F-CAT-005 / D57 : une offre en stock affiche ses unités disponibles (0 = rupture), pas le stock déclaré. */
async function withAvailability(client: SqlClient, offer: PublicOffer): Promise<PublicOffer> {
  if (offer.availability.kind !== 'IN_STOCK') {
    return offer;
  }
  const available = await availableUnits(client, offer.offerId);
  const units = Math.max(0, Math.min(offer.availability.units, available ?? offer.availability.units));
  return { ...offer, availability: { kind: 'IN_STOCK', units } };
}

/**
 * F-CAT-001/004 : catalogue public, sans session. Hors modules : compose la
 * projection du catalogue et le disponible dérivé des accords (agreements
 * dépend de catalog, pas l'inverse). Même instantané SQL (app_ro).
 */
@Controller('v1/offers')
export class PublicOfferController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Get()
  public list(@Query() query: unknown): Promise<PublicOfferList> {
    const filter = parsePublicOfferFilter(query);
    return withTransaction({ ...this.database, role: 'app_ro' }, async (client) => {
      const listed = await listPublicOffers(client, filter);
      const offers: PublicOffer[] = [];
      for (const offer of listed.offers) {
        offers.push(await withAvailability(client, offer));
      }
      return { ...listed, offers };
    });
  }

  @Get(':offerId')
  public detail(@Param('offerId') offerId: string): Promise<PublicOffer> {
    const id = parsePublicOfferId(offerId);
    return withTransaction({ ...this.database, role: 'app_ro' }, async (client) => withAvailability(client, await getPublicOffer(client, id)));
  }
}
