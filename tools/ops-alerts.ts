import { Client } from 'pg';
import { assertSecureDatabaseUrl } from '../apps/api/src/http/database';

/**
 * NF-OBS-003 : alertes calculables en base, lues par le compte de supervision
 * (`molopay_monitor`, rôle `notification_observer`) — compteurs seulement.
 * `MONITOR_DATABASE_URL=… pnpm ops:alerts` : code 0 si aucune alerte, 1 si au
 * moins une alerte, 2 si la supervision n'a pas pu s'exécuter (à traiter comme
 * une alerte par l'ordonnanceur). Les alertes hors base (erreurs 5xx > 1 %)
 * relèvent des métriques de l'hébergeur.
 */
export type AlertCounts = {
  readonly paymentsPendingOver15Min: number;
  readonly reconciliationUnclassified: number;
  readonly notificationsExhausted: number;
  readonly integrityDivergenceOpen: boolean;
  readonly outgoingFrozen: boolean;
};
export type Alert = { readonly code: string; readonly severity: 'CRITICAL' | 'WARNING'; readonly count: number };

type Queryable = Pick<Client, 'query'>;

export async function readAlertCounts(client: Queryable, at?: Date): Promise<AlertCounts> {
  const row = (await client.query<{ payments_pending_over_15_min: number; reconciliation_unclassified: number; notifications_exhausted: number; integrity_divergence_open: boolean; outgoing_frozen: boolean }>(
    at === undefined ? 'SELECT * FROM monitoring.alert_counts()' : 'SELECT * FROM monitoring.alert_counts($1)',
    at === undefined ? [] : [at.toISOString()],
  )).rows[0];
  if (row === undefined) throw new Error('MONITOR_RESULT_INVALID');
  return {
    paymentsPendingOver15Min: row.payments_pending_over_15_min,
    reconciliationUnclassified: row.reconciliation_unclassified,
    notificationsExhausted: row.notifications_exhausted,
    integrityDivergenceOpen: row.integrity_divergence_open,
    outgoingFrozen: row.outgoing_frozen,
  };
}

export function evaluateAlerts(counts: AlertCounts): { readonly status: 'OK' | 'ALERT'; readonly alerts: Alert[] } {
  const alerts: Alert[] = [];
  if (counts.paymentsPendingOver15Min > 0) alerts.push({ code: 'PAYMENT_PENDING_OVER_15_MIN', severity: 'CRITICAL', count: counts.paymentsPendingOver15Min });
  if (counts.reconciliationUnclassified > 0) alerts.push({ code: 'RECONCILIATION_GAP_UNCLASSIFIED', severity: 'CRITICAL', count: counts.reconciliationUnclassified });
  if (counts.notificationsExhausted > 0) alerts.push({ code: 'NOTIFICATION_QUEUE_FAILED', severity: 'WARNING', count: counts.notificationsExhausted });
  if (counts.integrityDivergenceOpen) alerts.push({ code: 'INTEGRITY_DIVERGENCE', severity: 'CRITICAL', count: 1 });
  if (counts.outgoingFrozen) alerts.push({ code: 'OUTGOING_FLOWS_FROZEN', severity: 'CRITICAL', count: 1 });
  return { status: alerts.length === 0 ? 'OK' : 'ALERT', alerts };
}

async function main(): Promise<number> {
  const url = process.env['MONITOR_DATABASE_URL']?.trim() ?? '';
  try {
    if (url === '') throw new Error('MONITOR_DATABASE_MISSING');
    assertSecureDatabaseUrl(url, process.env);
    const client = new Client({ connectionString: url, options: '-c role=notification_observer', application_name: 'molopay-ops-alerts', statement_timeout: 10_000 });
    await client.connect();
    try {
      const result = evaluateAlerts(await readAlertCounts(client));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return result.status === 'OK' ? 0 : 1;
    } finally {
      await client.end();
    }
  } catch (error) {
    const code = error instanceof Error ? (/^([A-Z][A-Z0-9_]+)/.exec(error.message)?.[1] ?? 'MONITOR_UNAVAILABLE') : 'MONITOR_UNAVAILABLE';
    process.stdout.write(`${JSON.stringify({ status: 'ERROR', code })}\n`);
    return 2;
  }
}

if (require.main === module) {
  void main().then((code) => { process.exitCode = code; });
}
