import type { PoolClient } from 'pg';
import { parseXaf } from '@achat/money';

type SqlClient = Pick<PoolClient, 'query'>;

/** F-PRT-004 : ligne du tableau des commandes, sans aucune donnée du client. */
export type PartnerOrder = {
  readonly orderId: string;
  readonly offerId: string | null;
  readonly offerTitle: string | null;
  readonly status: string;
  readonly targetXaf: string;
  readonly progressBasisPoints: number;
  readonly createdAt: string;
  readonly handedOverAt: string | null;
};

const MAX_ORDERS = 200;

/**
 * F-PRT-004 / D63 : accords du seul partenaire donné (jamais d'un autre),
 * brouillons exclus, 200 plus récents. Aucun identifiant ni coordonnée du
 * client (anonymisation, minimisation). Progression dérivée du grand livre
 * (I-9) ; titre de la version d'offre figée à l'accord (I-11).
 */
export async function listPartnerOrders(client: SqlClient, partnerId: string): Promise<readonly PartnerOrder[]> {
  const rows = await client.query<{
    id: string; offer_id: string | null; title: string | null; status: string; target_xaf: string; funds: string; created_at: Date; handed_over_at: Date | null;
  }>(
    `SELECT s.id, s.offer_id, p.title, s.status, s.target_xaf, agreements.confirmed_funds_xaf(s.id)::text AS funds, s.created_at,
            (SELECT min(e.created_at) FROM agreements.status_event e WHERE e.agreement_id = s.id AND e.to_status = 'HANDED_OVER') AS handed_over_at
       FROM agreements.agreement_state s
       LEFT JOIN catalog.offer_presentation p ON p.offer_id = s.offer_id AND p.version = s.offer_version
      WHERE s.partner_id = $1 AND s.status <> 'DRAFT'
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT ${MAX_ORDERS.toString()}`,
    [partnerId],
  );
  return rows.rows.map((row) => {
    const target = parseXaf(row.target_xaf).amount;
    const saved = parseXaf(row.funds).amount;
    const progress = target === 0n ? 0n : (saved * 10_000n) / target;
    return Object.freeze({
      orderId: row.id,
      offerId: row.offer_id,
      offerTitle: row.title,
      status: row.status,
      targetXaf: target.toString(),
      progressBasisPoints: Number(progress > 10_000n ? 10_000n : progress),
      createdAt: row.created_at.toISOString(),
      handedOverAt: row.handed_over_at === null ? null : row.handed_over_at.toISOString(),
    });
  });
}
