import { Pool } from 'pg';
import { assessNotificationQueue, type QueueThresholds } from '../apps/api/src/modules/notifications/monitor';
import { notificationDispatchCounts } from '../apps/api/src/modules/notifications/dispatch.store';

export function notificationMonitorOptions(args: readonly string[]): QueueThresholds {
  const options = new Map<string, bigint>();
  if (args.length !== 4) throw new Error('NOTIFICATION_MONITOR_ARGUMENTS_INVALID');
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]!;
    const value = args[index + 1]!;
    if (!['--max-pending', '--max-deferred-reminders'].includes(key) || options.has(key)
      || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('NOTIFICATION_MONITOR_ARGUMENTS_INVALID');
    options.set(key, BigInt(value));
  }
  return Object.freeze({ maxPending: options.get('--max-pending')!, maxDeferredReminders: options.get('--max-deferred-reminders')! });
}
export function localNotificationDatabase(raw: string | undefined): string {
  const invalid = (): never => { throw new Error('NOTIFICATION_MONITOR_DATABASE_FORBIDDEN'); };
  if (raw === undefined || raw === '' || raw.trim() !== raw) return invalid();
  let url: URL;
  try { url = new URL(raw); } catch { return invalid(); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/molopay_test'
    || raw.includes('?') || raw.includes('#')) return invalid();
  return raw;
}

/** Diagnostic ponctuel local : aucun message, aucune donnée de destinataire. */
async function main(): Promise<number> {
  let pool: Pool | undefined;
  try {
    const thresholds = notificationMonitorOptions(process.argv.slice(2));
    const url = new URL(localNotificationDatabase(process.env['DATABASE_URL']));
    // Le processus CLI est isolé : ne jamais hériter service/options/SSL PostgreSQL.
    for (const key of Object.keys(process.env)) if (key.toUpperCase().startsWith('PG')) delete process.env[key];
    pool = new Pool({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || '5432'),
      database: 'molopay_test', user: decodeURIComponent(url.username) || 'postgres', password: decodeURIComponent(url.password),
      ssl: false, options: '-c role=notification_observer', application_name: 'molopay-notification-check',
      max: 1, connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 });
    const report = assessNotificationQueue(await notificationDispatchCounts(pool), thresholds);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report.status === 'OK' ? 0 : 1;
  } catch (error) {
    const code = error instanceof Error && ['NOTIFICATION_MONITOR_ARGUMENTS_INVALID', 'NOTIFICATION_MONITOR_DATABASE_FORBIDDEN'].includes(error.message)
      ? error.message : 'NOTIFICATION_MONITOR_UNAVAILABLE';
    process.stdout.write(`${JSON.stringify({ status: 'ERROR', code })}\n`);
    return 2;
  } finally { await pool?.end(); }
}
if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch(() => {
    process.stdout.write('{"status":"ERROR","code":"NOTIFICATION_MONITOR_UNAVAILABLE"}\n');
    process.exitCode = 2;
  });
}
