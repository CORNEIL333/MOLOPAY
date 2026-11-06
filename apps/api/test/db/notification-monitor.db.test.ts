import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './harness';
import { localDatabaseEnvironment } from '../../../../tools/local-postgres';

let database: TestDatabase;
let admin: Client;
let migrations: string[];
const RECIPIENT = '019a9400-0000-7000-8000-0000000000a1';
const EVENT = '019a9400-0000-7000-8000-0000000000b1';
const ARGS = ['--max-pending', '0', '--max-deferred-reminders', '0'];
function check(args = ARGS, url = database.getConnectionUri(), extra: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('tools/check-notification-queue.ts'), ...args], {
    env: { ...localDatabaseEnvironment(process.env), ...extra, DATABASE_URL: url }, encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
async function enqueue(event = 'PAYMENT_CONFIRMED'): Promise<void> {
  await admin.query('SELECT notifications.enqueue_notification($1,$2,$3,$4,$5)', [RECIPIENT, EVENT, event, 'fr', 'SMS']);
}
beforeAll(async () => {
  migrations = await Promise.all(['0018_notification_reminder_reservation.sql', '0019_notification_outbox.sql',
    '0020_notification_dispatch.sql', '0021_notification_observer.sql'].map((name) => readFile(resolve('db/migrations', name), 'utf8')));
  database = await startTestDatabase({ database: 'molopay_test' });
  admin = new Client({ connectionString: database.getConnectionUri() }); await admin.connect();
});
afterAll(async () => { await admin?.end(); await database?.stop(); });
beforeEach(async () => {
  await admin.query('DROP SCHEMA IF EXISTS notifications CASCADE');
  for (const sql of migrations) await admin.query(sql);
  await admin.query('INSERT INTO notifications.dispatch_policy VALUES (1,60000,60000,1)');
});
describe('NF-REL-005 / F-NOT-002 · supervision locale réelle', () => {
  it('autorise les seuls compteurs à un observateur sans rôle travailleur', async () => {
    await admin.query('SET ROLE notification_observer');
    try {
      expect((await admin.query('SELECT * FROM notifications.dispatch_counts()')).rows).toEqual([
        { pending: '0', leased: '0', retry_wait: '0', exhausted: '0', deferred_reminders: '0' },
      ]);
      expect((await admin.query("SELECT pg_has_role(current_user, 'notification_worker', 'MEMBER') AS allowed")).rows[0]).toEqual({ allowed: false });
    } finally { await admin.query('RESET ROLE'); }
  });
  it('refuse directement tables, politique, enqueue, prise et reprise', async () => {
    await admin.query('SET ROLE notification_observer');
    try {
      for (const sql of ['SELECT * FROM notifications.outbox', 'SELECT * FROM notifications.dispatch_state',
        'UPDATE notifications.dispatch_policy SET max_attempts = 1000', 'DELETE FROM notifications.outbox',
        'SELECT * FROM notifications.claim_notification()', `SELECT notifications.retry_notification('${EVENT}')`,
        `SELECT notifications.enqueue_notification('${RECIPIENT}','${EVENT}','GOAL_FUNDED','fr','SMS')`]) {
        await expect(admin.query(sql)).rejects.toMatchObject({ code: '42501' });
      }
    } finally { await admin.query('RESET ROLE'); }
  });
  it('ne donne aucun privilège PUBLIC ou applicatif supplémentaire', async () => {
    for (const role of ['app_rw', 'app_ro']) {
      expect((await admin.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [role, 'notifications.dispatch_counts()'])).rows[0]).toEqual({ allowed: false });
    }
  });
  it('commande vide : JSON exact et code de sortie zéro', () => {
    const result = check();
    expect(result.status).toBe(0); expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ status: 'OK', reasons: [],
      counts: { pending: '0', leased: '0', retryWait: '0', exhausted: '0', deferredReminders: '0' } });
  });
  it('seuil dépassé : code un, aucune mutation ni donnée de destinataire', async () => {
    await enqueue();
    const result = check();
    expect(result.status).toBe(1); expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ status: 'ATTENTION', reasons: ['NOTIFICATION_QUEUE_BACKLOG'],
      counts: { pending: '1', leased: '0', retryWait: '0', exhausted: '0', deferredReminders: '0' } });
    expect(result.stdout).not.toContain(RECIPIENT); expect(result.stdout).not.toContain(EVENT);
    expect((await admin.query('SELECT count(*)::integer AS n FROM notifications.dispatch_state')).rows[0]).toEqual({ n: 0 });
    expect((await admin.query('SELECT count(*)::integer AS n FROM notifications.outbox')).rows[0]).toEqual({ n: 1 });
    expect(check(['--max-pending', '1', '--max-deferred-reminders', '0']).status).toBe(0);
  });
  it('épuisement toujours signalé même avec des seuils élevés', async () => {
    await enqueue();
    expect((await admin.query('SELECT * FROM notifications.claim_notification()')).rows).toHaveLength(1);
    await admin.query('UPDATE notifications.dispatch_state SET lease_until = clock_timestamp()');
    const result = check(['--max-pending', '999', '--max-deferred-reminders', '999']);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'ATTENTION', reasons: ['NOTIFICATION_QUEUE_EXHAUSTED'], counts: { exhausted: '1' } });
  });
  it('rappel différé visible sans consommation', async () => {
    await enqueue('PAYMENT_REMINDER');
    const result = check();
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ reasons: ['NOTIFICATION_REMINDERS_DEFERRED'], counts: { deferredReminders: '1' } });
    expect((await admin.query('SELECT count(*)::integer AS n FROM notifications.dispatch_state')).rows[0]).toEqual({ n: 0 });
  });
  it('erreur SQL : état indisponible code deux sans texte brut', async () => {
    await admin.query('DELETE FROM notifications.dispatch_policy');
    const result = check();
    expect(result).toEqual({ status: 2, stderr: '', stdout: '{"status":"ERROR","code":"NOTIFICATION_MONITOR_UNAVAILABLE"}\n' });
    expect(result.stdout).not.toContain('politique'); expect(result.stdout).not.toContain(database.getConnectionUri());
  });
  it('refuse les arguments et une base hors liste blanche avant connexion', () => {
    expect(check([])).toEqual({ status: 2, stderr: '', stdout: '{"status":"ERROR","code":"NOTIFICATION_MONITOR_ARGUMENTS_INVALID"}\n' });
    expect(check(ARGS, 'postgres://127.0.0.1:1/production')).toEqual({ status: 2, stderr: '', stdout: '{"status":"ERROR","code":"NOTIFICATION_MONITOR_DATABASE_FORBIDDEN"}\n' });
  });
  it('ignore hôte, port, service, SSL et options PG hérités', () => {
    const result = check(ARGS, database.getConnectionUri(), { PGHOST: 'invalid.example', PGPORT: '1',
      PGSERVICE: 'absent', PGSSLMODE: 'require', PGOPTIONS: '-c role=absent_role' });
    expect(result.status).toBe(0); expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'OK' });
  });
});
