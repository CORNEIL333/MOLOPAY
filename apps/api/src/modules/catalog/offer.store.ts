import { BusinessError } from '@achat/contracts';
import { parseXaf, toCanonicalString, xaf } from '@achat/money';
import type { PoolClient } from 'pg';
import {
  createOffer,
  filterOffers,
  type City,
  type Offer,
  type OfferFilter,
  type OfferModel,
  type OfferState,
  type Partner,
  type StockAvailability,
  type Universe,
} from './domain';

// Un Client ou un PoolClient suffit : le store n'utilise que `query`.
type SqlClient = Pick<PoolClient, 'query'>;

const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]*$/;
const OFFER_STATES: readonly string[] = ['DRAFT', 'PUBLISHED'];

export type OfferVersionRow = {
  offer_id: string;
  version: number;
  partner_id: string;
  universe: string;
  models: string[];
  city_ids: string[];
  price_xaf: string;
  availability_kind: string;
  stock_units: number | null;
  lead_days: number | null;
  warranty: string;
  discount_terms: string;
  state: string;
};

type OfferCurrentRow = OfferVersionRow & { partner_status: string };

export type OfferVersionParams = {
  readonly priceXaf: string;
  readonly availabilityKind: StockAvailability['kind'];
  readonly stockUnits: number | null;
  readonly leadDays: number | null;
};

export type StoredOffer = {
  readonly offer: Offer;
  readonly version: number;
};

function invalid(message: string): never {
  throw new BusinessError('CATALOG_INVALID_REQUEST', message);
}

/** Colonnes dérivées d'une offre déjà validée par le domaine. */
export function offerVersionParams(offer: Offer): OfferVersionParams {
  const priceXaf = toCanonicalString(xaf(offer.priceXaf));
  return offer.availability.kind === 'IN_STOCK'
    ? {
        priceXaf,
        availabilityKind: 'IN_STOCK',
        stockUnits: offer.availability.units,
        leadDays: null,
      }
    : {
        priceXaf,
        availabilityKind: 'PREORDER',
        stockUnits: null,
        leadDays: offer.availability.leadDays,
      };
}

/**
 * Reconstruit une offre depuis la base en repassant par `createOffer` : une
 * ligne altérée ou incomplète est refusée au lieu d'être servie. L'état
 * publié est repris tel quel ; la visibilité dépend du statut du partenaire.
 */
export function offerFromRow(row: OfferVersionRow, partner: Partner): Offer {
  if (row.partner_id !== partner.id) {
    invalid('Offre lue pour un autre partenaire');
  }
  if (!OFFER_STATES.includes(row.state)) {
    invalid('État d’offre stocké inconnu');
  }
  if (typeof row.price_xaf !== 'string' || !POSITIVE_DECIMAL_PATTERN.test(row.price_xaf)) {
    invalid('Prix stocké invalide');
  }
  let priceXaf: bigint;
  try {
    priceXaf = parseXaf(row.price_xaf).amount;
  } catch {
    invalid('Prix stocké hors plage');
  }
  const availability =
    row.availability_kind === 'PREORDER'
      ? { kind: 'PREORDER' as const, leadDays: row.lead_days as number }
      : { kind: row.availability_kind, units: row.stock_units as number };
  const offer = createOffer({
    id: row.offer_id,
    partner,
    universe: row.universe as Universe,
    models: row.models as OfferModel[],
    cityIds: row.city_ids as City[],
    priceXaf,
    availability: availability as StockAvailability,
    warranty: row.warranty,
    discountTerms: row.discount_terms,
  });
  return Object.freeze({ ...offer, state: row.state as OfferState });
}

function partnerOf(row: OfferCurrentRow): Partner {
  if (row.partner_status !== 'PENDING' && row.partner_status !== 'VALIDATED') {
    invalid('Statut partenaire inconnu');
  }
  return { id: row.partner_id, status: row.partner_status };
}

/**
 * Enregistre une nouvelle version de l'offre (création, prix, stock ou
 * publication). L'offre doit déjà avoir été produite par le domaine
 * (`createOffer` / `publishOffer`) ; la base revérifie la publication.
 */
export async function appendOfferVersion(
  client: SqlClient,
  offer: Offer,
  createdBy: string,
): Promise<number> {
  const checked = createOffer({
    id: offer.id,
    partner: offer.partner,
    universe: offer.universe,
    models: offer.models,
    cityIds: offer.cityIds,
    priceXaf: offer.priceXaf,
    availability: offer.availability,
    warranty: offer.warranty,
    discountTerms: offer.discountTerms,
  });
  if (!OFFER_STATES.includes(offer.state)) {
    invalid('État d’offre inconnu');
  }
  await client.query(
    `INSERT INTO catalog.offer (id, partner_id, created_at)
     VALUES ($1, $2, now())
     ON CONFLICT (id) DO NOTHING`,
    [checked.id, checked.partner.id],
  );
  const owner = await client.query<{ partner_id: string }>(
    'SELECT partner_id FROM catalog.offer WHERE id = $1',
    [checked.id],
  );
  if (owner.rows[0]?.partner_id !== checked.partner.id) {
    invalid('L’offre appartient à un autre partenaire');
  }
  const params = offerVersionParams(checked);
  const result = await client.query<{ version: number }>(
    `INSERT INTO catalog.offer_version
       (offer_id, version, universe, models, city_ids, price_xaf,
        availability_kind, stock_units, lead_days, warranty, discount_terms,
        state, created_by, created_at)
     SELECT $1, COALESCE(max(version), 0) + 1, $2, $3::text[], $4::text[],
            $5::bigint, $6, $7, $8, $9, $10, $11, $12, now()
     FROM catalog.offer_version WHERE offer_id = $1
     RETURNING version`,
    [
      checked.id,
      checked.universe,
      [...checked.models],
      [...checked.cityIds],
      params.priceXaf,
      params.availabilityKind,
      params.stockUnits,
      params.leadDays,
      checked.warranty,
      checked.discountTerms,
      offer.state,
      createdBy,
    ],
  );
  const version = result.rows[0]?.version;
  if (version === undefined) {
    invalid('Version d’offre non enregistrée');
  }
  return version;
}

const CURRENT_COLUMNS = `offer_id, version, partner_id, partner_status, universe,
  models, city_ids, price_xaf, availability_kind, stock_units, lead_days,
  warranty, discount_terms, state`;

export async function getCurrentOffer(
  client: SqlClient,
  offerId: string,
): Promise<StoredOffer | null> {
  const result = await client.query<OfferCurrentRow>(
    `SELECT ${CURRENT_COLUMNS} FROM catalog.offer_current WHERE offer_id = $1`,
    [offerId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  return { offer: offerFromRow(row, partnerOf(row)), version: row.version };
}

/**
 * Catalogue public : seules les offres publiées d'un partenaire validé sont
 * lues, puis le filtre client est appliqué par le domaine (F-CAT-004).
 */
export async function listVisibleOffers(
  client: SqlClient,
  filter: OfferFilter = {},
): Promise<readonly Offer[]> {
  const result = await client.query<OfferCurrentRow>(
    `SELECT ${CURRENT_COLUMNS} FROM catalog.offer_current
     WHERE state = 'PUBLISHED' AND partner_status = 'VALIDATED'
     ORDER BY offer_id`,
  );
  return filterOffers(
    result.rows.map((row) => offerFromRow(row, partnerOf(row))),
    filter,
  );
}
