import type { components, operations } from '@achat/contracts/api';
import { BusinessError } from '@achat/contracts';

export type CatalogFilters = NonNullable<operations['listOffers']['parameters']['query']>;
export type CatalogPartner = Readonly<{ id: string; name: string }>;
const KEYS = ['universe', 'city', 'model', 'maxPriceXaf', 'partnerId'];
export function catalogFiltersFromSearch(input: unknown): CatalogFilters {
  const invalid = (): never => { throw new BusinessError('REQUEST_INVALID'); };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return invalid();
  const result: Record<string, string> = {};
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !KEYS.includes(key) || !Object.hasOwn(descriptors[key]!, 'value')) return invalid();
    const value: unknown = descriptors[key]!.value;
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string') return invalid();
    if (key === 'universe' && !['ESSENTIALS', 'TECHNOLOGY', 'HOUSING', 'MOBILITY'].includes(value)) return invalid();
    if (key === 'city' && !['yaounde', 'douala'].includes(value)) return invalid();
    if (key === 'model' && !['SAVE_THEN_BUY', 'FINANCED_PURCHASE', 'PLANNED_EXPENSE'].includes(value)) return invalid();
    if (key === 'partnerId' && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value)) return invalid();
    // Validation de forme seulement ; la borne XAF est contrôlée par money côté API.
    if (key === 'maxPriceXaf' && !/^(0|[1-9][0-9]*)$/.test(value)) return invalid();
    result[key] = value;
  }
  return Object.freeze(result);
}
export function catalogPartners(offers: readonly components['schemas']['Offer'][]): readonly CatalogPartner[] {
  const partners = new Map<string, CatalogPartner>();
  for (const offer of offers) partners.set(offer.partnerId, Object.freeze({ id: offer.partnerId, name: offer.partnerName }));
  return Object.freeze([...partners.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.id.localeCompare(b.id)));
}
