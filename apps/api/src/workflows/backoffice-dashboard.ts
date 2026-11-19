import type { PoolClient } from 'pg';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { appendAuditEvent } from '../modules/audit/audit.store';

type SqlClient = Pick<PoolClient, 'query'>;

export type BackofficeDashboard = {
  readonly asOf: string;
  readonly agreements: readonly {
    readonly model: string;
    readonly universe: string | null;
    readonly cities: string;
    readonly status: string;
    readonly count: number;
    readonly targetXaf: string;
    readonly confirmedFundsXaf: string;
  }[];
  readonly settlements: readonly { readonly state: string; readonly count: number; readonly netXaf: string }[];
  readonly handovers: number;
  readonly openDisputes: number;
  readonly openComplaints: number;
  readonly openRiskAlerts: number;
};

/**
 * F-BO-003 / D65 : tableau de bord agrégé. Les sections sont lues par des
 * requêtes successives en READ COMMITTED (pas un instantané unique : une
 * écriture validée entre deux requêtes peut apparaître dans l'une et pas
 * dans l'autre ; l'audit ajouté dans la même transaction l'interdit). Montants
 * dérivés des contributions confirmées (I-9), sommés en `bigint` et rendus
 * en texte (jamais de flottant). Univers et villes viennent de la version
 * d'offre figée à l'accord ; un accord C (sans offre) n'a ni univers ni
 * ville (`cities` vide). Aucune donnée personnelle. Consultation motivée et
 * journalisée dans l'audit chaîné (F-BO-004), même règle que la file.
 */
export async function readBackofficeDashboard(client: SqlClient, principal: AdminPrincipal, reason: string): Promise<BackofficeDashboard> {
  assertAuthorized(principal, 'READ_FINANCIAL_HISTORY', { reason });
  await appendAuditEvent(client, {
    eventType: 'FINANCIAL_HISTORY_READ',
    actorId: principal.actorId,
    action: 'READ_FINANCIAL_HISTORY',
    targetType: 'BACKOFFICE_DASHBOARD',
    targetId: 'dashboard',
    outcome: 'SUCCESS',
    reason,
  });
  const now = (await client.query<{ now: Date }>('SELECT statement_timestamp() AS now')).rows[0]?.now ?? new Date(0);
  const agreements = await client.query<{ model: string; universe: string | null; cities: string; status: string; n: number; target: string; funds: string }>(
    `SELECT s.model, v.universe,
            COALESCE(array_to_string(ARRAY(SELECT c FROM unnest(v.city_ids) c ORDER BY c), '+'), '') AS cities,
            s.status, count(*)::integer AS n, sum(s.target_xaf::bigint)::text AS target,
            sum(agreements.confirmed_funds_xaf(s.id))::text AS funds
       FROM agreements.agreement_state s
       LEFT JOIN catalog.offer_version v ON v.offer_id = s.offer_id AND v.version = s.offer_version
      WHERE s.status <> 'DRAFT'
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 2 NULLS FIRST, 3, 4`,
  );
  const settlements = await client.query<{ state: string; n: number; net: string }>(
    `SELECT CASE
              WHEN x.outcome = 'EXECUTED' THEN 'EXECUTED'
              WHEN x.outcome = 'REJECTED' THEN 'EXECUTION_REJECTED'
              WHEN i.payout_id IS NOT NULL THEN 'INSTRUCTED'
              WHEN d.decision = 'APPROVED' THEN 'APPROVED'
              WHEN d.decision = 'REJECTED' THEN 'REJECTED'
              ELSE 'PREPARED'
            END AS state, count(*)::integer AS n, sum(p.net_xaf)::text AS net
       FROM settlement.payout p
       LEFT JOIN settlement.payout_decision d ON d.payout_id = p.id
       LEFT JOIN settlement.payout_instruction i ON i.payout_id = p.id
       LEFT JOIN settlement.payout_execution x ON x.payout_id = p.id
      GROUP BY 1 ORDER BY 1`,
  );
  const counters = (await client.query<{ handovers: number; disputes: number; complaints: number; alerts: number }>(
    `SELECT (SELECT count(*)::integer FROM settlement.handover) AS handovers,
            (SELECT count(*)::integer FROM disputes.dispute d WHERE NOT EXISTS (SELECT 1 FROM disputes.dispute_resolution r WHERE r.dispute_id = d.id)) AS disputes,
            (SELECT count(*)::integer FROM disputes.complaint c WHERE NOT EXISTS (SELECT 1 FROM disputes.complaint_closure k WHERE k.complaint_id = c.id)) AS complaints,
            (SELECT count(*)::integer FROM risk.alert a WHERE NOT EXISTS (SELECT 1 FROM risk.alert_decision d WHERE d.alert_id = a.id)) AS alerts`,
  )).rows[0];
  return Object.freeze({
    asOf: now.toISOString(),
    agreements: agreements.rows.map((row) => ({
      model: row.model, universe: row.universe, cities: row.cities, status: row.status, count: row.n, targetXaf: row.target, confirmedFundsXaf: row.funds,
    })),
    settlements: settlements.rows.map((row) => ({ state: row.state, count: row.n, netXaf: row.net })),
    handovers: counters?.handovers ?? 0,
    openDisputes: counters?.disputes ?? 0,
    openComplaints: counters?.complaints ?? 0,
    openRiskAlerts: counters?.alerts ?? 0,
  });
}
