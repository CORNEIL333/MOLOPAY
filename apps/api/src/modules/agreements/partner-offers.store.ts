import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

/** F-PRT-002 : offre vue par son partenaire (version courante). */
export type PartnerOffer = {
  readonly offerId: string;
  readonly version: number;
  readonly title: string | null;
  readonly state: 'DRAFT' | 'PUBLISHED';
  readonly priceXaf: string;
  readonly availabilityKind: 'IN_STOCK' | 'PREORDER';
  readonly stockUnits: number | null;
  readonly availableUnits: number | null;
  readonly publiclyVisible: boolean;
  readonly updatedAt: string;
};

const MAX_OFFERS = 500;

/**
 * F-PRT-002 / D63 : offres du seul partenaire donné, version courante,
 * publiées ou non. Stock disponible dérivé des réservations (D57) ;
 * visibilité = présence au catalogue public (partenaire validé, non
 * défaillant, offre publiée). Lecture seule : la publication reste au
 * personnel en maker-checker.
 */
export async function listPartnerOffers(client: SqlClient, partnerId: string): Promise<readonly PartnerOffer[]> {
  const rows = await client.query<{
    offer_id: string; version: number; title: string | null; state: 'DRAFT' | 'PUBLISHED'; price_xaf: string; availability_kind: 'IN_STOCK' | 'PREORDER';
    stock_units: number | null; available: number | null; visible: boolean; created_at: Date;
  }>(
    `SELECT o.offer_id, o.version, p.title, o.state, o.price_xaf, o.availability_kind, o.stock_units,
            agreements.available_stock(o.offer_id) AS available,
            EXISTS (SELECT 1 FROM catalog.public_offer x WHERE x.offer_id = o.offer_id) AS visible,
            o.created_at
       FROM catalog.offer_current o
       LEFT JOIN catalog.offer_presentation p ON p.offer_id = o.offer_id AND p.version = o.version
      WHERE o.partner_id = $1
      ORDER BY o.created_at DESC, o.offer_id
      LIMIT ${MAX_OFFERS.toString()}`,
    [partnerId],
  );
  return rows.rows.map((row) =>
    Object.freeze({
      offerId: row.offer_id,
      version: row.version,
      title: row.title,
      state: row.state,
      priceXaf: row.price_xaf,
      availabilityKind: row.availability_kind,
      stockUnits: row.stock_units,
      availableUnits: row.available === null ? null : Math.max(row.available, 0),
      publiclyVisible: row.visible,
      updatedAt: row.created_at.toISOString(),
    }),
  );
}
