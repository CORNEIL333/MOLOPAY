import type { PoolClient } from 'pg';
import type { components } from '@achat/contracts/api';
import { BusinessError } from '@achat/contracts';
import { parseXaf, toCanonicalString, xaf } from '@achat/money';
import { CITIES, OFFER_MODELS, UNIVERSES, type City, type OfferFilter, type OfferModel, type Universe } from './domain';
import { offerFromRow, type OfferVersionRow } from './offer.store';

export type PublicOffer = components['schemas']['Offer'];
export type PublicOfferList = components['schemas']['OfferList'];
const FILTER_KEYS = ['universe', 'city', 'model', 'partnerId', 'maxPriceXaf'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(): never { throw new BusinessError('REQUEST_INVALID', 'Paramètres du catalogue invalides'); }

export function parsePublicOfferFilter(input: unknown): OfferFilter {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !FILTER_KEYS.includes(key) || !Object.hasOwn(descriptors[key]!, 'value')
      || !descriptors[key]!.enumerable || typeof descriptors[key]!.value !== 'string') invalid();
  }
  const value = input as Record<string, string | undefined>;
  const universe = Object.hasOwn(value, 'universe') ? value['universe'] : undefined;
  const city = Object.hasOwn(value, 'city') ? value['city'] : undefined;
  const model = Object.hasOwn(value, 'model') ? value['model'] : undefined;
  const partnerId = Object.hasOwn(value, 'partnerId') ? value['partnerId'] : undefined;
  const price = Object.hasOwn(value, 'maxPriceXaf') ? value['maxPriceXaf'] : undefined;
  if (universe !== undefined && !(UNIVERSES as readonly string[]).includes(universe)) invalid();
  if (city !== undefined && !(CITIES as readonly string[]).includes(city)) invalid();
  if (model !== undefined && !(OFFER_MODELS as readonly string[]).includes(model)) invalid();
  if (partnerId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(partnerId)) invalid();
  let maxPriceXaf: bigint | undefined;
  if (price !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/.test(price)) invalid();
    try { maxPriceXaf = parseXaf(price).amount; } catch { invalid(); }
  }
  return Object.freeze({ ...(universe === undefined ? {} : { universe: universe as Universe }),
    ...(city === undefined ? {} : { city: city as City }), ...(model === undefined ? {} : { model: model as OfferModel }),
    ...(partnerId === undefined ? {} : { partnerId }), ...(maxPriceXaf === undefined ? {} : { maxPriceXaf }) });
}
export function parsePublicOfferId(input: unknown): string {
  if (typeof input !== 'string' || !UUID.test(input)) return invalid();
  return input;
}
export async function appendOfferPresentation(client: Pick<PoolClient, 'query'>, input: { offerId: string; version: number; title: string }, actor: string): Promise<void> {
  parsePublicOfferId(input.offerId);
  if (!Number.isSafeInteger(input.version) || input.version < 1 || typeof input.title !== 'string'
    || input.title.trim() === '' || input.title !== input.title.trim() || input.title.length > 200
    || typeof actor !== 'string' || actor.length === 0 || actor.length > 200 || /\s/.test(actor)) invalid();
  await client.query('INSERT INTO catalog.offer_presentation VALUES ($1,$2,$3,$4,clock_timestamp())', [input.offerId, input.version, input.title, actor]);
}

type PublicRow = OfferVersionRow & { title: string; partner_name: string };
function publicOffer(row: PublicRow): PublicOffer {
  const offer = offerFromRow(row, { id: row.partner_id, status: 'VALIDATED' });
  if (typeof row.title !== 'string' || row.title.trim() === '' || typeof row.partner_name !== 'string' || row.partner_name.trim() === '') {
    throw new BusinessError('CATALOG_OFFER_INCOMPLETE');
  }
  return { offerId: offer.id, title: row.title, partnerId: offer.partner.id, partnerName: row.partner_name,
    universe: offer.universe, models: [...offer.models], cities: [...offer.cityIds], priceXaf: toCanonicalString(xaf(offer.priceXaf)),
    availability: { ...offer.availability }, warranty: offer.warranty, discountTerms: offer.discountTerms, status: 'PUBLISHED' };
}

/** Projection publique uniquement ; asOf et résultats partagent le même instantané SQL. */
export async function listPublicOffers(client: Pick<PoolClient, 'query'>, filter: OfferFilter): Promise<PublicOfferList> {
  const result = await client.query<{ as_of: Date; offers: PublicRow[] }>(
    `SELECT statement_timestamp() AS as_of, COALESCE(jsonb_agg(v ORDER BY v.offer_id), '[]'::jsonb) AS offers
     FROM (SELECT * FROM catalog.public_offer WHERE ($1::text IS NULL OR universe = $1)
       AND ($2::text IS NULL OR $2 = ANY(city_ids)) AND ($3::text IS NULL OR $3 = ANY(models))
       AND ($4::text IS NULL OR partner_id = $4) AND ($5::bigint IS NULL OR price_xaf::bigint <= $5)) v`,
    [filter.universe ?? null, filter.city ?? null, filter.model ?? null, filter.partnerId ?? null,
      filter.maxPriceXaf === undefined ? null : toCanonicalString(xaf(filter.maxPriceXaf))]);
  const row = result.rows[0];
  if (row === undefined || !Array.isArray(row.offers) || !(row.as_of instanceof Date)) throw new Error('CATALOG_READ_FAILED');
  return { offers: row.offers.map(publicOffer), asOf: row.as_of.toISOString() };
}
export async function getPublicOffer(client: Pick<PoolClient, 'query'>, id: string): Promise<PublicOffer> {
  const result = await client.query<PublicRow>('SELECT * FROM catalog.public_offer WHERE offer_id = $1', [parsePublicOfferId(id)]);
  const row = result.rows[0];
  if (row === undefined) throw new BusinessError('CATALOG_OFFER_NOT_FOUND', 'Offre introuvable');
  return publicOffer(row);
}
