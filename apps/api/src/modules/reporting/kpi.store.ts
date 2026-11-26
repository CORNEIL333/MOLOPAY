import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;

/**
 * F-REP-002 : indicateurs produits, calculés exactement selon
 * `docs/04_annexes/DEFINITIONS_INDICATEURS.md`. Lecture seule (rôle
 * `app_ro`), agrégats seulement ; une case de moins de 5 objectifs est
 * masquée (« <5 »), les totaux sont toujours publiés. Dimensions : univers de
 * l'offre figée (objectif C : « hors univers ») et ville de l'offre si elle
 * est unique (sinon « non attribuée ») — sans supposition, en attendant D119.
 */
export const MASK_BELOW = 5;

/** `amountXaf` : montant entier en texte, ou « <5 » quand la case est masquée. */
export type Cell = { readonly key: string; readonly goals: number | '<5'; readonly amountXaf?: string };

export type ProductKpis = {
  readonly period: { readonly from: string; readonly to: string };
  readonly volume: { readonly totalXaf: string; readonly byUniverse: Cell[]; readonly byCity: Cell[] };
  readonly openGoals: { readonly total: number; readonly byUniverse: Cell[]; readonly byCity: Cell[] };
  readonly completion: { readonly activated: number; readonly funded: number; readonly ratePercent: string | null };
  readonly handoverDelay: { readonly count: number; readonly medianDays: string | null; readonly p90Days: string | null };
  readonly defaultsB: 'NOT_APPLICABLE';
  readonly commissionMargin: { readonly count: number; readonly totalXaf: string; readonly averageXaf: string | null };
};

type GoalRow = { readonly id: string; readonly universe: string; readonly city: string; readonly amount: bigint };

const DIMENSIONS = `
  dims AS (
    SELECT a.id,
           CASE WHEN a.model = 'SAVE_THEN_BUY' THEN ov.universe ELSE 'PLANNED_EXPENSE_HORS_UNIVERS' END AS universe,
           CASE WHEN a.model = 'SAVE_THEN_BUY' AND cardinality(ov.city_ids) = 1 THEN ov.city_ids[1] ELSE 'NON_ATTRIBUEE' END AS city
      FROM agreements.agreement a
      LEFT JOIN catalog.offer_version ov ON ov.offer_id = a.offer_id AND ov.version = a.offer_version
  )`;

/** Ventilation masquée : une case par valeur présente, triée ; moins de 5 objectifs → « <5 ». */
export function breakdown(rows: readonly GoalRow[], dimension: 'universe' | 'city', withAmount: boolean): Cell[] {
  const cells = new Map<string, { goals: Set<string>; amount: bigint }>();
  for (const row of rows) {
    const key = row[dimension];
    const cell = cells.get(key) ?? { goals: new Set<string>(), amount: 0n };
    cell.goals.add(row.id);
    cell.amount += row.amount;
    cells.set(key, cell);
  }
  return [...cells.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, cell]) => {
      const masked = cell.goals.size < MASK_BELOW;
      const goals = masked ? ('<5' as const) : cell.goals.size;
      if (!withAmount) return { key, goals };
      return { key, goals, amountXaf: masked ? ('<5' as const) : cell.amount.toString() };
    });
}

/** Taux en pour-cent, une décimale, arrondi au plus proche (demi vers le haut) ; null si aucun objectif activé. */
export function ratePercent(numerator: number, denominator: number): string | null {
  if (denominator === 0) return null;
  const tenths = (BigInt(numerator) * 1000n * 2n + BigInt(denominator)) / (BigInt(denominator) * 2n);
  return `${tenths / 10n}.${tenths % 10n}`;
}

/** Moyenne entière arrondie à l'inférieur (définitions écrites) ; null sans élément. */
export function averageFloor(total: bigint, count: number): string | null {
  return count === 0 ? null : (total / BigInt(count)).toString();
}

export async function computeProductKpis(client: Queryable, period: { readonly from: Date; readonly to: Date }): Promise<ProductKpis> {
  if (!(period.from instanceof Date) || !(period.to instanceof Date) || Number.isNaN(period.from.getTime()) || Number.isNaN(period.to.getTime()) || period.from >= period.to) {
    throw new Error('REPORT_PERIOD_INVALID: période vide ou inversée');
  }
  const bounds = [period.from.toISOString(), period.to.toISOString()];

  const volumeRows = (await client.query<{ id: string; universe: string; city: string; amount: string }>(
    `WITH ${DIMENSIONS}
     SELECT d.id, d.universe, d.city, sum(c.amount_xaf)::text AS amount
       FROM payments.contribution c
       JOIN payments.payment_attempt pa ON pa.id = c.attempt_id
       JOIN dims d ON d.id = pa.agreement_id
      WHERE c.confirmed_at >= $1 AND c.confirmed_at < $2
      GROUP BY d.id, d.universe, d.city`,
    bounds,
  )).rows.map((row) => ({ ...row, amount: BigInt(row.amount) }));

  const openRows = (await client.query<{ id: string; universe: string; city: string }>(
    `WITH ${DIMENSIONS}
     SELECT d.id, d.universe, d.city FROM dims d
      WHERE (SELECT e.to_status FROM agreements.status_event e
              WHERE e.agreement_id = d.id AND e.created_at < $1 ORDER BY e.seq DESC LIMIT 1) = 'ACTIVE'`,
    [bounds[1]],
  )).rows.map((row) => ({ ...row, amount: 0n }));

  const completion = (await client.query<{ activated: number; funded: number }>(
    `SELECT count(*)::int AS activated,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM agreements.status_event f
               WHERE f.agreement_id = e.agreement_id AND f.to_status = 'FUNDED' AND f.created_at < $2))::int AS funded
       FROM agreements.status_event e
      WHERE e.kind = 'TRANSITION' AND e.from_status = 'DRAFT' AND e.to_status = 'ACTIVE'
        AND e.created_at >= $1 AND e.created_at < $2`,
    bounds,
  )).rows[0] ?? { activated: 0, funded: 0 };

  const delay = (await client.query<{ count: number; median: string | null; p90: string | null }>(
    `WITH delays AS (
       SELECT extract(epoch FROM h.created_at - (
                SELECT max(f.created_at) FROM agreements.status_event f
                 WHERE f.agreement_id = h.agreement_id AND f.to_status = 'FUNDED' AND f.seq < h.seq)) / 86400.0 AS days
         FROM agreements.status_event h
        WHERE h.to_status = 'HANDED_OVER' AND h.created_at >= $1 AND h.created_at < $2
     )
     SELECT count(*)::int AS count,
            round((percentile_cont(0.5) WITHIN GROUP (ORDER BY days))::numeric, 1)::text AS median,
            round((percentile_cont(0.9) WITHIN GROUP (ORDER BY days))::numeric, 1)::text AS p90
       FROM delays`,
    bounds,
  )).rows[0] ?? { count: 0, median: null, p90: null };

  const margin = (await client.query<{ count: number; total: string }>(
    `SELECT count(*)::int AS count, COALESCE(sum(p.commission_xaf), 0)::text AS total
       FROM settlement.payout p
       JOIN settlement.payout_execution x ON x.payout_id = p.id
      WHERE x.outcome = 'EXECUTED' AND x.recorded_at >= $1 AND x.recorded_at < $2`,
    bounds,
  )).rows[0] ?? { count: 0, total: '0' };
  const marginTotal = BigInt(margin.total);

  return {
    period: { from: bounds[0] ?? '', to: bounds[1] ?? '' },
    volume: {
      totalXaf: volumeRows.reduce((sum, row) => sum + row.amount, 0n).toString(),
      byUniverse: breakdown(volumeRows, 'universe', true),
      byCity: breakdown(volumeRows, 'city', true),
    },
    openGoals: { total: openRows.length, byUniverse: breakdown(openRows, 'universe', false), byCity: breakdown(openRows, 'city', false) },
    completion: { activated: completion.activated, funded: completion.funded, ratePercent: ratePercent(completion.funded, completion.activated) },
    handoverDelay: { count: delay.count, medianDays: delay.count === 0 ? null : delay.median, p90Days: delay.count === 0 ? null : delay.p90 },
    defaultsB: 'NOT_APPLICABLE',
    commissionMargin: { count: margin.count, totalXaf: marginTotal.toString(), averageXaf: averageFloor(marginTotal, margin.count) },
  };
}
