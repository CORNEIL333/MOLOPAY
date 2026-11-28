import { BusinessError, type ErrorCode } from '@achat/contracts';
import { MAX_AMOUNT } from '@achat/money';

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC_MS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PARTNER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const MAX_TEXT_LENGTH = 500;

export const UNIVERSES = [
  'ESSENTIALS',
  'TECHNOLOGY',
  'HOUSING',
  'MOBILITY',
] as const;
export type Universe = (typeof UNIVERSES)[number];

// Identifiants internes des deux villes de lancement, alignés sur le contexte
// d'autorisation back-office (`cityId`).
export const CITIES = ['yaounde', 'douala'] as const;
export type City = (typeof CITIES)[number];

export const OFFER_MODELS = [
  'SAVE_THEN_BUY',
  'FINANCED_PURCHASE',
  'PLANNED_EXPENSE',
] as const;
export type OfferModel = (typeof OFFER_MODELS)[number];

export type PartnerStatus = 'PENDING' | 'VALIDATED' | 'SUSPENDED';

export type Partner = {
  readonly id: string;
  readonly status: PartnerStatus;
};

export type StockAvailability =
  | { readonly kind: 'IN_STOCK'; readonly units: number }
  | { readonly kind: 'PREORDER'; readonly leadDays: number };

export type OfferState = 'DRAFT' | 'PUBLISHED';

export type OfferInput = {
  readonly id: string;
  readonly partner: Partner;
  readonly universe: Universe;
  readonly models: readonly OfferModel[];
  readonly cityIds: readonly City[];
  readonly priceXaf: bigint;
  readonly availability: StockAvailability;
  readonly warranty: string;
  readonly discountTerms: string;
};

export type Offer = OfferInput & { readonly state: OfferState };

export type ApprovedPaymentPlan = {
  readonly id: string;
  readonly offerId: string;
  readonly partnerId: string;
  readonly model: OfferModel;
  readonly platformApproved: boolean;
  readonly lenderApprovalRef: string | null;
};

export type PlanActivation = {
  readonly planId: string;
  readonly offerId: string;
  readonly partnerId: string;
  readonly model: OfferModel;
  readonly activatedAt: string;
};

export type OfferFilter = {
  readonly universe?: Universe;
  readonly city?: City;
  readonly model?: OfferModel;
  readonly partnerId?: string;
  readonly maxPriceXaf?: bigint;
};

const PLAN_ACTIVATION_KEYS: ReadonlySet<string> = new Set([
  'planId',
  'offerId',
  'model',
]);

function fail(code: ErrorCode, message: string): never {
  throw new BusinessError(code, message);
}

function isUuidV7(value: unknown): value is string {
  return typeof value === 'string' && UUID_V7_PATTERN.test(value);
}

function assertUuidV7(value: unknown, field: string): string {
  if (!isUuidV7(value)) {
    fail('CATALOG_INVALID_REQUEST', `${field} doit être un UUID v7`);
  }
  return value;
}

function assertIsoUtcMs(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !ISO_UTC_MS_PATTERN.test(value) ||
    Number.isNaN(new Date(value).getTime()) ||
    new Date(value).toISOString() !== value
  ) {
    fail('CATALOG_INVALID_REQUEST', `${field} doit être ISO 8601 UTC`);
  }
  return value;
}

function assertOfferText(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > MAX_TEXT_LENGTH
  ) {
    fail('CATALOG_OFFER_INCOMPLETE', `${field} invalide`);
  }
  return value;
}

function assertPartner(partner: Partner): Partner {
  if (
    typeof partner !== 'object' ||
    partner === null ||
    typeof partner.id !== 'string' ||
    !PARTNER_ID_PATTERN.test(partner.id) ||
    !['PENDING', 'VALIDATED', 'SUSPENDED'].includes(partner.status)
  ) {
    fail('CATALOG_INVALID_REQUEST', 'Partenaire invalide');
  }
  return Object.freeze({ id: partner.id, status: partner.status });
}

function assertUniverse(value: unknown): Universe {
  if (!(UNIVERSES as readonly unknown[]).includes(value)) {
    fail('CATALOG_INVALID_REQUEST', 'Univers inconnu');
  }
  return value as Universe;
}

function assertModels(
  value: readonly OfferModel[],
): readonly OfferModel[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail('CATALOG_OFFER_INCOMPLETE', 'Une offre doit déclarer au moins un modèle');
  }
  const unique = new Set<OfferModel>();
  for (const model of value as readonly unknown[]) {
    if (!(OFFER_MODELS as readonly unknown[]).includes(model)) {
      fail('CATALOG_OFFER_INCOMPLETE', `Modèle inconnu: ${String(model)}`);
    }
    if (unique.has(model as OfferModel)) {
      fail('CATALOG_OFFER_INCOMPLETE', `Modèle dupliqué: ${String(model)}`);
    }
    unique.add(model as OfferModel);
  }
  return Object.freeze([...unique]);
}

function assertCities(value: readonly City[]): readonly City[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail('CATALOG_OFFER_INCOMPLETE', 'Une offre doit cibler au moins une ville');
  }
  const unique = new Set<City>();
  for (const city of value as readonly unknown[]) {
    if (!(CITIES as readonly unknown[]).includes(city)) {
      fail('CATALOG_OFFER_INCOMPLETE', `Ville inconnue: ${String(city)}`);
    }
    if (unique.has(city as City)) {
      fail('CATALOG_OFFER_INCOMPLETE', `Ville dupliquée: ${String(city)}`);
    }
    unique.add(city as City);
  }
  return Object.freeze([...unique]);
}

function assertPrice(value: unknown): bigint {
  if (
    typeof value !== 'bigint' ||
    value <= 0n ||
    value > MAX_AMOUNT
  ) {
    fail('CATALOG_OFFER_INCOMPLETE', 'Prix XAF invalide');
  }
  return value;
}

function assertAvailability(value: StockAvailability): StockAvailability {
  if (value.kind === 'IN_STOCK') {
    if (!Number.isSafeInteger(value.units) || value.units < 0) {
      fail('CATALOG_OFFER_INCOMPLETE', 'Stock invalide');
    }
    return Object.freeze({ kind: 'IN_STOCK', units: value.units });
  }
  if (value.kind === 'PREORDER') {
    if (
      !Number.isSafeInteger(value.leadDays) ||
      value.leadDays < 1 ||
      value.leadDays > 365
    ) {
      fail('CATALOG_OFFER_INCOMPLETE', 'Délai de réapprovisionnement invalide');
    }
    return Object.freeze({ kind: 'PREORDER', leadDays: value.leadDays });
  }
  fail('CATALOG_OFFER_INCOMPLETE', 'Disponibilité invalide');
}

/**
 * Crée une offre à l'état brouillon. Une offre incomplète est refusée dès la
 * saisie : la publication ne fait que confirmer qu'un partenaire validé existe.
 */
export function createOffer(input: OfferInput): Offer {
  assertUuidV7(input.id, 'id');
  const partner = assertPartner(input.partner);
  const universe = assertUniverse(input.universe);
  const models = assertModels(input.models);
  const cityIds = assertCities(input.cityIds);
  const priceXaf = assertPrice(input.priceXaf);
  const availability = assertAvailability(input.availability);
  const warranty = assertOfferText(input.warranty, 'warranty');
  const discountTerms = assertOfferText(input.discountTerms, 'discountTerms');
  return Object.freeze({
    id: input.id,
    partner,
    universe,
    models,
    cityIds,
    priceXaf,
    availability,
    warranty,
    discountTerms,
    state: 'DRAFT',
  });
}

export function publishOffer(offer: Offer): Offer {
  if (offer.state !== 'DRAFT') {
    fail('CATALOG_OFFER_NOT_PUBLISHED', 'Seule une offre brouillon peut être publiée');
  }
  const partner = assertPartner(offer.partner);
  if (partner.status !== 'VALIDATED') {
    fail(
      'CATALOG_PARTNER_NOT_VALIDATED',
      'Un partenaire non validé ne peut publier d’offre',
    );
  }
  // Revalide le contenu : une offre forgée hors `createOffer` ne doit pas
  // devenir visible avec des champs incomplets.
  return Object.freeze({
    ...createOffer({
      id: offer.id,
      partner,
      universe: offer.universe,
      models: offer.models,
      cityIds: offer.cityIds,
      priceXaf: offer.priceXaf,
      availability: offer.availability,
      warranty: offer.warranty,
      discountTerms: offer.discountTerms,
    }),
    state: 'PUBLISHED' as const,
  });
}

/**
 * Active un plan de paiement approuvé. La requête du partenaire est une liste
 * blanche stricte : il ne peut fournir ni taux, ni durée, ni frais.
 */
export function activatePartnerPlan(input: {
  readonly plan: ApprovedPaymentPlan;
  readonly offer: Offer;
  readonly partner: Partner;
  readonly request: Readonly<Record<string, unknown>>;
  readonly now: string;
}): PlanActivation {
  const partner = assertPartner(input.partner);
  const now = assertIsoUtcMs(input.now, 'now');
  const requestKeys = Object.keys(input.request);
  for (const key of requestKeys) {
    if (!PLAN_ACTIVATION_KEYS.has(key)) {
      fail(
        'CATALOG_FIELD_FORBIDDEN',
        `Un partenaire ne peut fournir la condition « ${key} »`,
      );
    }
  }
  if (partner.status !== 'VALIDATED') {
    fail(
      'CATALOG_PARTNER_NOT_VALIDATED',
      'Un partenaire non validé ne peut activer de plan',
    );
  }
  if (input.offer.state !== 'PUBLISHED') {
    fail('CATALOG_OFFER_NOT_PUBLISHED', 'L’offre doit être publiée');
  }
  const plan = input.plan;
  if (
    !(OFFER_MODELS as readonly unknown[]).includes(plan.model) ||
    plan.platformApproved !== true ||
    plan.partnerId !== partner.id ||
    plan.offerId !== input.offer.id ||
    input.offer.partner.id !== partner.id ||
    !input.offer.models.includes(plan.model)
  ) {
    fail('CATALOG_PLAN_NOT_APPROVED', 'Plan non approuvé pour cette offre');
  }
  if (
    input.request['planId'] !== plan.id ||
    input.request['offerId'] !== input.offer.id ||
    input.request['model'] !== plan.model
  ) {
    fail('CATALOG_PLAN_NOT_APPROVED', 'Activation ne correspondant pas au plan');
  }
  if (plan.model === 'FINANCED_PURCHASE' && plan.lenderApprovalRef === null) {
    fail(
      'CATALOG_PLAN_NOT_APPROVED',
      'Le modèle B exige l’approbation du financeur',
    );
  }
  return Object.freeze({
    planId: plan.id,
    offerId: input.offer.id,
    partnerId: partner.id,
    model: plan.model,
    activatedAt: now,
  });
}

/**
 * Filtre public : seules les offres publiées d'un partenaire validé sont
 * visibles (F-PRT-001). L'ordre d'entrée est conservé.
 */
export function filterOffers(
  offers: readonly Offer[],
  filter: OfferFilter = {},
): readonly Offer[] {
  for (const field of ['universe', 'city', 'model', 'partnerId'] as const) {
    const value = filter[field];
    if (value === undefined) continue;
    const allowed: readonly unknown[] =
      field === 'universe'
        ? UNIVERSES
        : field === 'city'
          ? CITIES
          : field === 'model'
            ? OFFER_MODELS
            : [];
    if (field !== 'partnerId' && !allowed.includes(value)) {
      fail('CATALOG_INVALID_REQUEST', `Filtre ${field} invalide`);
    }
    if (field === 'partnerId' && !PARTNER_ID_PATTERN.test(String(value))) {
      fail('CATALOG_INVALID_REQUEST', 'Filtre partnerId invalide');
    }
  }
  const maxPriceXaf = filter.maxPriceXaf;
  if (
    maxPriceXaf !== undefined &&
    (typeof maxPriceXaf !== 'bigint' ||
      maxPriceXaf < 0n ||
      maxPriceXaf > MAX_AMOUNT)
  ) {
    fail('CATALOG_INVALID_REQUEST', 'Filtre maxPriceXaf invalide');
  }
  return Object.freeze(
    offers.filter((offer) => {
      if (offer.state !== 'PUBLISHED') return false;
      if (offer.partner.status !== 'VALIDATED') return false;
      if (filter.universe !== undefined && offer.universe !== filter.universe) {
        return false;
      }
      if (
        filter.city !== undefined &&
        !offer.cityIds.includes(filter.city)
      ) {
        return false;
      }
      if (filter.model !== undefined && !offer.models.includes(filter.model)) {
        return false;
      }
      if (
        filter.partnerId !== undefined &&
        offer.partner.id !== filter.partnerId
      ) {
        return false;
      }
      if (maxPriceXaf !== undefined && offer.priceXaf > maxPriceXaf) {
        return false;
      }
      return true;
    }),
  );
}

/**
 * Vérifie la disponibilité au moment de réserver (la réservation atomique et
 * le réapprovisionnement appartiennent au lot des accords).
 */
export function assertStockAvailable(offer: Offer, units: number): void {
  if (offer.state !== 'PUBLISHED') {
    fail('CATALOG_OFFER_NOT_PUBLISHED', 'L’offre doit être publiée');
  }
  if (!Number.isSafeInteger(units) || units < 1) {
    fail('CATALOG_INVALID_REQUEST', 'Quantité invalide');
  }
  if (offer.availability.kind === 'IN_STOCK' && units > offer.availability.units) {
    fail('CATALOG_STOCK_UNAVAILABLE', 'Stock insuffisant');
  }
}
