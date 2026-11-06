import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './harness';
import { claimNotification, retryNotification, notificationDispatchCounts } from '../../src/modules/notifications/dispatch.store';

let database: TestDatabase;
let admin: Client;
let migrations: string[];
let workerPool: Pool;
const RECIPIENT = '019a9400-0000-7000-8000-0000000000a1';
type Claim = { recipient_id: string; event_key: string; channel: string; event_type: string;
  locale: string; claim_id: string; attempt: number; lease_until: Date };
const INVALID = { code: 'P0001', message: 'NOTIFICATION_INVALID_REQUEST: politique de consommation absente' };
const LOST = { code: 'P0001', message: 'NOTIFICATION_CLAIM_LOST: bail absent ou expiré' };

async function worker<T>(action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: database.getConnectionUri() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE notification_worker');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
}
async function claim(): Promise<Claim[]> {
  return worker(async (client) => (await client.query<Claim>('SELECT * FROM notifications.claim_notification()')).rows);
}
async function enqueue(event = 'PAYMENT_CONFIRMED'): Promise<string> {
  const key = randomUUID();
  await admin.query('SELECT notifications.enqueue_notification($1,$2,$3,$4,$5)', [RECIPIENT, key, event, 'fr', 'SMS']);
  return key;
}
async function counts(): Promise<Record<string, string>> {
  return worker(async (client) => (await client.query<Record<string, string>>('SELECT * FROM notifications.dispatch_counts()')).rows[0]!);
}
async function expire(): Promise<void> {
  // Manipulation propriétaire de la seule horloge persistée de test, sans attente.
  await admin.query("UPDATE notifications.dispatch_state SET lease_until = clock_timestamp() - interval '1 second'");
}
beforeAll(async () => {
  migrations = await Promise.all(['0018_notification_reminder_reservation.sql', '0019_notification_outbox.sql', '0020_notification_dispatch.sql']
    .map((name) => readFile(resolve('db/migrations', name), 'utf8')));
  database = await startTestDatabase();
  admin = new Client({ connectionString: database.getConnectionUri() });
  await admin.connect();
  workerPool = new Pool({ connectionString: database.getConnectionUri(), options: '-c role=notification_worker', max: 1, connectionTimeoutMillis: 1000 });
});
afterAll(async () => { await workerPool?.end(); await admin?.end(); await database?.stop(); });
beforeEach(async () => {
  await admin.query('DROP SCHEMA IF EXISTS notifications CASCADE');
  for (const sql of migrations) await admin.query(sql);
  await admin.query('INSERT INTO notifications.dispatch_policy VALUES (1,60000,60000,2)');
});

describe('NF-REL-005 · baux de consommation PostgreSQL réels', () => {
  it('le store commite la prise avant restitution et la reprise avant retour', async () => {
    const key = await enqueue();
    expect(await notificationDispatchCounts(workerPool)).toMatchObject({ pending: 1n });
    const value = await claimNotification(workerPool);
    expect(value).toMatchObject({ recipientId: RECIPIENT, eventKey: key, event: 'PAYMENT_CONFIRMED', attempt: 1 });
    // Lecture sur une autre connexion : prouve le COMMIT, pas seulement l'INSERT.
    expect((await admin.query('SELECT claim_id FROM notifications.dispatch_state')).rows).toEqual([{ claim_id: value!.claimId }]);
    expect(await claimNotification(workerPool)).toBeNull();
    await retryNotification(workerPool, value!.claimId);
    expect((await admin.query('SELECT claim_id FROM notifications.dispatch_state')).rows).toEqual([{ claim_id: null }]);
    expect(await notificationDispatchCounts(workerPool)).toMatchObject({ retryWait: 1n, leased: 0n });
    const client = await workerPool.connect();
    try { expect((await client.query('SELECT current_user AS role')).rows[0]).toEqual({ role: 'notification_worker' }); }
    finally { client.release(); }
  });
  it('le store restitue les refus SQL et libère sa transaction', async () => {
    await admin.query('DELETE FROM notifications.dispatch_policy');
    await expect(claimNotification(workerPool)).rejects.toMatchObject(INVALID);
    await admin.query('INSERT INTO notifications.dispatch_policy VALUES (1,60000,60000,2)');
    await enqueue();
    expect(await claimNotification(workerPool)).not.toBeNull();
  });
  it('refuse une configuration absente pour prise et surveillance', async () => {
    await admin.query('DELETE FROM notifications.dispatch_policy');
    await expect(claim()).rejects.toMatchObject(INVALID);
    await expect(counts()).rejects.toMatchObject(INVALID);
  });
  it('prend une enveloppe sans altérer son contenu ni revendiquer une livraison', async () => {
    const key = await enqueue();
    const before = Date.now();
    const [value] = await claim();
    expect(value).toMatchObject({ recipient_id: RECIPIENT, event_key: key, event_type: 'PAYMENT_CONFIRMED', locale: 'fr', channel: 'SMS', attempt: 1 });
    expect(value!.claim_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(value!.lease_until.getTime()).toBeGreaterThan(before);
    expect(await claim()).toEqual([]);
    expect((await admin.query('SELECT count(*)::integer AS n FROM notifications.outbox')).rows[0]).toEqual({ n: 1 });
  });
  it('dix travailleurs concurrents : une seule prise de la même enveloppe', async () => {
    await enqueue();
    const results = await Promise.all(Array.from({ length: 10 }, claim));
    expect(results.flat()).toHaveLength(1);
    expect((await admin.query('SELECT attempt FROM notifications.dispatch_state')).rows).toEqual([{ attempt: 1 }]);
  });
  it('ne bloque pas derrière une autre enveloppe verrouillée', async () => {
    const first = await enqueue();
    const second = await enqueue('GOAL_FUNDED');
    const client = new Client({ connectionString: database.getConnectionUri() });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT * FROM notifications.outbox WHERE event_key = $1 FOR UPDATE', [first]);
      const result = await worker(async (other) => {
        await other.query("SET LOCAL lock_timeout = '500ms'");
        return (await other.query<Claim>('SELECT * FROM notifications.claim_notification()')).rows;
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.event_key).toBe(second);
    } finally { await client.query('ROLLBACK'); await client.end(); }
  });
  it('rollback de prise : aucune tentative consommée', async () => {
    await enqueue();
    const failure = new Error('TEST_CLAIM_ROLLBACK');
    await expect(worker(async (client) => {
      const result = await client.query<Claim>('SELECT * FROM notifications.claim_notification()');
      expect(result.rows).toHaveLength(1);
      throw failure;
    })).rejects.toBe(failure);
    expect((await admin.query('SELECT count(*)::integer AS n FROM notifications.dispatch_state')).rows[0]).toEqual({ n: 0 });
    expect((await claim())[0]!.attempt).toBe(1);
  });
  it('reprend un bail expiré avec une nouvelle identité de tentative', async () => {
    await enqueue();
    const [first] = await claim();
    expect(first).toBeDefined();
    await expire();
    const [second] = await claim();
    expect(second).toMatchObject({ event_key: first!.event_key, attempt: 2 });
    expect(second!.claim_id).not.toBe(first!.claim_id);
    await expect(worker((client) => client.query('SELECT notifications.retry_notification($1)', [first!.claim_id])))
      .rejects.toMatchObject(LOST);
  });
  it('refuse un bail expiré avant même toute nouvelle prise', async () => {
    await enqueue();
    const [value] = await claim();
    expect(value).toBeDefined();
    await expire();
    await expect(worker((client) => client.query('SELECT notifications.retry_notification($1)', [value!.claim_id])))
      .rejects.toMatchObject(LOST);
  });
  it('deux reprises simultanées : une seule transition acceptée', async () => {
    await enqueue();
    const [value] = await claim();
    expect(value).toBeDefined();
    const results = await Promise.allSettled(Array.from({ length: 2 }, () => worker((client) =>
      client.query('SELECT notifications.retry_notification($1)', [value!.claim_id]))));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failures = results.filter((result) => result.status === 'rejected');
    expect(failures).toHaveLength(1);
    expect(failures[0]!.reason).toMatchObject(LOST);
  });
  it('refuse une reprise expirée pendant son attente de verrou avec une horloge fraîche', async () => {
    await enqueue();
    const [value] = await claim();
    expect(value).toBeDefined();
    const blocker = new Client({ connectionString: database.getConnectionUri() });
    const waiting = new Client({ connectionString: database.getConnectionUri() });
    await blocker.connect(); await waiting.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT * FROM notifications.outbox FOR UPDATE');
      await waiting.query('BEGIN'); await waiting.query('SET LOCAL ROLE notification_worker');
      const pid = (await waiting.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      const result = waiting.query('SELECT notifications.retry_notification($1)', [value!.claim_id])
        .then(() => ({ accepted: true as const }), (reason: unknown) => ({ accepted: false as const, reason }));
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        blocked = (await admin.query<{ blocked: boolean }>("SELECT wait_event_type = 'Lock' AS blocked FROM pg_stat_activity WHERE pid = $1", [pid])).rows[0]?.blocked === true;
        if (!blocked) await admin.query('SELECT pg_sleep(0.01)');
      }
      expect(blocked).toBe(true);
      // Échéance après le début de waiting : now() figé accepterait à tort la reprise.
      await blocker.query('UPDATE notifications.dispatch_state SET lease_until = clock_timestamp()');
      await blocker.query('COMMIT');
      expect(await result).toMatchObject({ accepted: false, reason: LOST });
    } finally {
      await blocker.query('ROLLBACK'); await waiting.query('ROLLBACK');
      await blocker.end(); await waiting.end();
    }
  });
  it('rollback de reprise : token, bail et date de disponibilité inchangés', async () => {
    await enqueue();
    const [value] = await claim();
    expect(value).toBeDefined();
    const before = (await admin.query('SELECT * FROM notifications.dispatch_state')).rows;
    const failure = new Error('TEST_RETRY_ROLLBACK');
    await expect(worker(async (client) => {
      await client.query('SELECT notifications.retry_notification($1)', [value!.claim_id]);
      await client.query('RESET ROLE');
      expect((await client.query('SELECT claim_id FROM notifications.dispatch_state')).rows).toEqual([{ claim_id: null }]);
      throw failure;
    })).rejects.toBe(failure);
    expect((await admin.query('SELECT * FROM notifications.dispatch_state')).rows).toEqual(before);
    expect(await claim()).toEqual([]);
  });
  it('nouvelle prise et ancienne reprise concurrentes après expiration', async () => {
    await enqueue();
    const [value] = await claim();
    expect(value).toBeDefined();
    await expire();
    const [retry, taken] = await Promise.all([
      worker((client) => client.query('SELECT notifications.retry_notification($1)', [value!.claim_id]))
        .then(() => ({ accepted: true as const }), (reason: unknown) => ({ accepted: false as const, reason })), claim(),
    ]);
    expect(retry).toMatchObject({ accepted: false, reason: LOST });
    // SKIP LOCKED peut rendre [] pendant le refus de l'ancienne reprise.
    const next = taken.length === 0 ? await claim() : taken;
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ attempt: 2, event_key: value!.event_key });
    expect(await claim()).toEqual([]);
  });
  for (const token of [null, RECIPIENT]) {
    it('refuse une identité de tentative absente ou inconnue', async () => {
      await expect(worker((client) => client.query('SELECT notifications.retry_notification($1)', [token])))
        .rejects.toMatchObject(LOST);
    });
  }
  it('diffère une reprise et refuse de réutiliser la même tentative', async () => {
    await enqueue();
    const [value] = await claim();
    expect(value).toBeDefined();
    await worker((client) => client.query('SELECT notifications.retry_notification($1)', [value!.claim_id]));
    expect(await claim()).toEqual([]);
    expect(await counts()).toMatchObject({ retry_wait: '1', leased: '0' });
    await expect(worker((client) => client.query('SELECT notifications.retry_notification($1)', [value!.claim_id])))
      .rejects.toMatchObject(LOST);
    await admin.query("UPDATE notifications.dispatch_state SET available_at = clock_timestamp() - interval '1 second'");
    expect((await claim())[0]!.attempt).toBe(2);
  });
  it('conserve les enveloppes épuisées sans les remettre en circulation', async () => {
    await admin.query('UPDATE notifications.dispatch_policy SET max_attempts = 1');
    await enqueue();
    expect(await claim()).toHaveLength(1);
    expect(await counts()).toMatchObject({ leased: '1', exhausted: '0' });
    await expire();
    // Relever la politique ne doit pas réanimer une enveloppe déjà épuisée.
    await admin.query('UPDATE notifications.dispatch_policy SET max_attempts = 3');
    expect(await claim()).toEqual([]);
    expect(await counts()).toMatchObject({ exhausted: '1', leased: '0' });
    expect((await admin.query('SELECT count(*)::integer AS n FROM notifications.outbox')).rows[0]).toEqual({ n: 1 });
  });
  it('F-NOT-003 exclut les rappels même après réservation', async () => {
    const key = await enqueue('PAYMENT_REMINDER');
    await admin.query('INSERT INTO notifications.reminder_reservation VALUES ($1,$2,$3,clock_timestamp())', [RECIPIENT, key, 'SMS']);
    expect(await claim()).toEqual([]);
    expect(await counts()).toEqual({ pending: '0', leased: '0', retry_wait: '0', exhausted: '0', deferred_reminders: '1' });
  });
  it('compte les nouvelles enveloppes sans exposer de destinataire', async () => {
    await enqueue(); await enqueue('GOAL_FUNDED');
    expect(await counts()).toEqual({ pending: '2', leased: '0', retry_wait: '0', exhausted: '0', deferred_reminders: '0' });
  });
  it('refuse REPEATABLE READ pour la prise', async () => {
    await expect(worker(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await client.query('SELECT * FROM notifications.claim_notification()');
    })).rejects.toMatchObject({ code: 'P0001', message: 'NOTIFICATION_INVALID_REQUEST: isolation non prise en charge' });
  });
  it('refuse REPEATABLE READ pour la reprise', async () => {
    await expect(worker(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await client.query('SELECT notifications.retry_notification($1)', [RECIPIENT]);
    })).rejects.toMatchObject({ code: 'P0001', message: 'NOTIFICATION_INVALID_REQUEST: isolation non prise en charge' });
  });
  it('refuse les politiques invalides par contraintes SQL exactes', async () => {
    for (const assignment of ['lease_ms = 0', 'lease_ms = 86400001', 'retry_ms = 0', 'max_attempts = 0', 'max_attempts = 1001']) {
      await expect(admin.query(`UPDATE notifications.dispatch_policy SET ${assignment}`)).rejects.toMatchObject({ code: '23514' });
    }
    await expect(admin.query('UPDATE notifications.dispatch_policy SET lease_ms = NULL')).rejects.toMatchObject({ code: '23502' });
    await expect(admin.query('INSERT INTO notifications.dispatch_policy VALUES (2,60000,60000,2)')).rejects.toMatchObject({ code: '23514' });
  });
  it('refuse accès tables, configuration et enqueue au travailleur', async () => {
    for (const sql of ['SELECT * FROM notifications.outbox', 'SELECT * FROM notifications.dispatch_state',
      'UPDATE notifications.dispatch_policy SET max_attempts = 1000', 'DELETE FROM notifications.dispatch_state',
      `SELECT notifications.enqueue_notification('${RECIPIENT}','${RECIPIENT}','GOAL_FUNDED','fr','SMS')`]) {
      await expect(worker((client) => client.query(sql))).rejects.toMatchObject({ code: '42501' });
    }
  });
  it('refuse les fonctions de travailleur aux rôles applicatifs et PUBLIC', async () => {
    for (const role of ['app_rw', 'app_ro']) {
      for (const fn of ['claim_notification()', 'retry_notification(uuid)', 'dispatch_counts()']) {
        const result = await admin.query<{ allowed: boolean }>('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [role, `notifications.${fn}`]);
        expect(result.rows[0]!.allowed).toBe(false);
      }
    }
  });
});
