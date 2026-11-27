import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './harness';
import { claimNotification, completeNotification, notificationDispatchCounts, retryNotification } from '../../src/modules/notifications/dispatch.store';

/**
 * NF-REL-005 / préparation du travailleur de notifications (plan du journal) :
 * confirmation d'envoi en base, SANS aucun envoi. Une notification confirmée
 * (référence du prestataire) n'est plus jamais reprise : pas de double SMS.
 * Confirmation rejouée : sans effet ; bail repris par un autre travailleur :
 * refus ; même bail expiré mais non repris : accepté (le message est parti).
 */
let database: TestDatabase;
let admin: Client;
let migrations: string[];
let workerPool: Pool;
const RECIPIENT = '019a9400-0000-7000-8000-0000000000a1';

async function enqueue(event = 'PAYMENT_CONFIRMED'): Promise<string> {
  const key = randomUUID();
  await admin.query('SELECT notifications.enqueue_notification($1,$2,$3,$4,$5)', [RECIPIENT, key, event, 'fr', 'SMS']);
  return key;
}
async function expire(): Promise<void> {
  await admin.query("UPDATE notifications.dispatch_state SET lease_until = clock_timestamp() - interval '1 second', available_at = clock_timestamp() - interval '1 second' WHERE claim_id IS NOT NULL");
}

beforeAll(async () => {
  migrations = await Promise.all(['0018_notification_reminder_reservation.sql', '0019_notification_outbox.sql', '0020_notification_dispatch.sql', '0021_notification_observer.sql', '0078_notification_delivery.sql']
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
  await admin.query('INSERT INTO notifications.dispatch_policy VALUES (1,60000,60000,3)');
});

describe('confirmation d’envoi d’une notification (aucun envoi ici)', () => {
  it('confirmée : enregistrée avec la référence du prestataire, sortie de la file, jamais reprise', async () => {
    const key = await enqueue();
    const claim = await claimNotification(workerPool);
    await completeNotification(workerPool, claim!.claimId, 'SM0123456789abcdef0123456789abcdef');
    const rows = (await admin.query('SELECT event_key, claim_id, provider_ref, attempt FROM notifications.delivery')).rows;
    expect(rows).toEqual([{ event_key: key, claim_id: claim!.claimId, provider_ref: 'SM0123456789abcdef0123456789abcdef', attempt: 1 }]);
    expect(await notificationDispatchCounts(workerPool)).toMatchObject({ pending: 0n, leased: 0n, retryWait: 0n, exhausted: 0n });
    // Le bail est libéré : plus aucun travailleur ne détient cette notification.
    expect((await admin.query('SELECT claim_id, lease_until FROM notifications.dispatch_state')).rows).toEqual([{ claim_id: null, lease_until: null }]);
    await expire();
    expect(await claimNotification(workerPool)).toBeNull();
    await expect(retryNotification(workerPool, claim!.claimId)).rejects.toThrow(/^NOTIFICATION_CLAIM_LOST/);
  });

  it('rejouée avec la même référence : sans effet ; avec une autre référence : refus', async () => {
    await enqueue();
    const claim = await claimNotification(workerPool);
    await completeNotification(workerPool, claim!.claimId, 'SMaaaa');
    await completeNotification(workerPool, claim!.claimId, 'SMaaaa');
    expect((await admin.query('SELECT count(*)::int AS n FROM notifications.delivery')).rows[0]).toEqual({ n: 1 });
    await expect(completeNotification(workerPool, claim!.claimId, 'SMbbbb')).rejects.toThrow(/^NOTIFICATION_ALREADY_DELIVERED/);
  });

  it('bail expiré mais non repris : confirmation acceptée (le message est parti) ; bail repris par un autre : refus', async () => {
    await enqueue();
    const first = await claimNotification(workerPool);
    await expire();
    await completeNotification(workerPool, first!.claimId, 'SMtard');
    expect((await admin.query('SELECT count(*)::int AS n FROM notifications.delivery')).rows[0]).toEqual({ n: 1 });

    await enqueue('GOAL_FUNDED');
    const stale = await claimNotification(workerPool);
    await expire();
    const retaken = await claimNotification(workerPool);
    expect(retaken!.claimId).not.toBe(stale!.claimId);
    await expect(completeNotification(workerPool, stale!.claimId, 'SMvieux')).rejects.toThrow(/^NOTIFICATION_CLAIM_LOST/);
    await completeNotification(workerPool, retaken!.claimId, 'SMnouveau');
    expect((await admin.query(`SELECT provider_ref FROM notifications.delivery ORDER BY delivered_at`)).rows).toEqual([{ provider_ref: 'SMtard' }, { provider_ref: 'SMnouveau' }]);
  });

  it('refuse : identifiant de bail ou référence mal formés (NOTIFICATION_INVALID_REQUEST), sans écriture', async () => {
    await enqueue();
    const claim = await claimNotification(workerPool);
    await expect(completeNotification(workerPool, 'pas-un-uuid', 'SM1')).rejects.toMatchObject({ code: 'NOTIFICATION_INVALID_REQUEST' });
    for (const reference of ['', 'avec espace', 'x'.repeat(201), 'ref;DROP']) {
      await expect(completeNotification(workerPool, claim!.claimId, reference), reference).rejects.toThrow(/NOTIFICATION_INVALID_REQUEST/);
    }
    expect((await admin.query('SELECT count(*)::int AS n FROM notifications.delivery')).rows[0]).toEqual({ n: 0 });
  });

  it('base : confirmations en ajout seul, inaccessibles en direct au travailleur et à l’API', async () => {
    await enqueue();
    const claim = await claimNotification(workerPool);
    await completeNotification(workerPool, claim!.claimId, 'SM1');
    await expect(admin.query("UPDATE notifications.delivery SET provider_ref = 'x'")).rejects.toThrow(/NOTIFICATION_APPEND_ONLY/);
    await expect(admin.query('DELETE FROM notifications.delivery')).rejects.toThrow(/NOTIFICATION_APPEND_ONLY/);
    await expect(admin.query('TRUNCATE notifications.delivery')).rejects.toThrow(/NOTIFICATION_APPEND_ONLY/);
    for (const role of ['notification_worker', 'app_rw', 'app_ro']) {
      const client = new Client({ connectionString: database.getConnectionUri() });
      await client.connect();
      try {
        await client.query(`SET ROLE ${role}`);
        await expect(client.query('SELECT * FROM notifications.delivery'), role).rejects.toThrow(/permission denied/);
      } finally {
        await client.end();
      }
    }
  });
});
