import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './harness';
import { reserveReminder } from '../../src/modules/notifications/reminder.store';

let container: TestDatabase;
let admin: Client;
let pool: Pool;
let sql: string;
const RECIPIENT = '019a9400-0000-7000-8000-0000000000a1';

async function reserve(key = randomUUID(), channel = 'SMS', recipient = RECIPIENT): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_rw');
    const result = await reserveReminder(client, { recipientId: recipient, reservationKey: key, channel: channel as 'SMS' | 'PUSH' });
    await client.query('COMMIT');
    return result.replayed;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

beforeAll(async () => {
  sql = await readFile(resolve('db/migrations/0018_notification_reminder_reservation.sql'), 'utf8');
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  pool = new Pool({ connectionString: container.getConnectionUri(), max: 10 });
});
afterAll(async () => { await pool?.end(); await admin?.end(); await container?.stop(); });
beforeEach(async () => {
  await admin.query('DROP SCHEMA IF EXISTS notifications CASCADE');
  await admin.query(sql);
  // Plage relative à l'horloge serveur ; elle couvre minuit sans hypothèse d'heure locale.
  await admin.query(`INSERT INTO notifications.reminder_policy
    SELECT 1, 'UTC', (m + 1430) % 1440, (m + 10) % 1440, 2, 86400000
    FROM (SELECT extract(hour FROM statement_timestamp() AT TIME ZONE 'UTC')::integer * 60
      + extract(minute FROM statement_timestamp() AT TIME ZONE 'UTC')::integer AS m) t`);
});

describe('F-NOT-003 réservations réelles', () => {
  it('réserve puis rejoue sans doubler le quota', async () => {
    const key = randomUUID();
    expect(await reserve(key)).toBe(false);
    expect(await reserve(key)).toBe(true);
    expect((await admin.query('SELECT count(*)::integer AS n FROM notifications.reminder_reservation')).rows[0]).toEqual({ n: 1 });
  });
  it('refuse le dépassement SMS/PUSH avec le code exact', async () => {
    await reserve(); await reserve(randomUUID(), 'PUSH');
    await expect(reserve()).rejects.toMatchObject({ code: 'P0001', message: 'NOTIFICATION_RATE_LIMITED: fréquence maximale atteinte' });
  });
  it('dix réservations concurrentes : deux seulement', async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserve()));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    for (const result of results) if (result.status === 'rejected') {
      expect(result.reason).toMatchObject({ code: 'P0001', message: 'NOTIFICATION_RATE_LIMITED: fréquence maximale atteinte' });
    }
  });
  it('rejeu concurrent : une seule réservation', async () => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve(key)));
    expect(results.filter((replayed) => !replayed)).toHaveLength(1);
  });
  it('refuse le changement de canal pour une même clé', async () => {
    const key = randomUUID(); await reserve(key);
    await expect(reserve(key, 'PUSH')).rejects.toMatchObject({ code: 'P0001', message: 'IDEMPOTENCY_KEY_REUSED: canal différent' });
  });
  it('isole les quotas des destinataires', async () => {
    await reserve(); await reserve();
    expect(await reserve(randomUUID(), 'SMS', randomUUID())).toBe(false);
  });
  it('refuse sans politique', async () => {
    await admin.query('DELETE FROM notifications.reminder_policy');
    await expect(reserve()).rejects.toMatchObject({ code: 'P0001', message: 'NOTIFICATION_INVALID_REQUEST: politique absente' });
  });
  it('refuse une plage fermée', async () => {
    await admin.query('UPDATE notifications.reminder_policy SET start_minute = end_minute, end_minute = start_minute');
    await expect(reserve()).rejects.toMatchObject({ code: 'P0001', message: 'NOTIFICATION_OUTSIDE_WINDOW: rappel hors plage' });
  });
  it('refuse un fuseau invalide', async () => {
    await admin.query("UPDATE notifications.reminder_policy SET time_zone = 'invalid/zone'");
    await expect(reserve()).rejects.toMatchObject({ code: 'P0001', message: 'NOTIFICATION_INVALID_REQUEST: fuseau invalide' });
  });
  it('refuse un canal inconnu', async () => {
    await expect(reserve(randomUUID(), 'EMAIL')).rejects.toMatchObject({ code: 'P0001', message: 'NOTIFICATION_INVALID_REQUEST: paramètres invalides' });
  });
  it('ignore les réservations expirées', async () => {
    await reserve(); await reserve();
    await admin.query("UPDATE notifications.reminder_reservation SET reserved_at = clock_timestamp() - interval '2 days'");
    expect(await reserve()).toBe(false);
  });
  it('supporte la durée maximale sans dépassement de timestamptz', async () => {
    await admin.query('UPDATE notifications.reminder_policy SET window_ms = 9007199254740991');
    expect(await reserve()).toBe(false);
    expect(await reserve()).toBe(false);
    await expect(reserve()).rejects.toMatchObject({ code: 'P0001', message: 'NOTIFICATION_RATE_LIMITED: fréquence maximale atteinte' });
  });
  it('annule la réservation avec la transaction métier', async () => {
    const client = await pool.connect();
    const key = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_rw');
      await reserveReminder(client, { recipientId: RECIPIENT, reservationKey: key, channel: 'SMS' });
      await client.query('ROLLBACK');
    } finally { client.release(); }
    expect(await reserve(key)).toBe(false);
  });
  it('refuse une isolation avec historique potentiellement périmé', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query('SET LOCAL ROLE app_rw');
      await expect(reserveReminder(client, { recipientId: RECIPIENT, reservationKey: randomUUID(), channel: 'SMS' }))
        .rejects.toMatchObject({ code: 'P0001', message: 'NOTIFICATION_INVALID_REQUEST: isolation non prise en charge' });
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
  it('refuse les écritures directes et la modification de politique par app_rw', async () => {
    await admin.query('SET ROLE app_rw');
    try {
      for (const statement of [
        "INSERT INTO notifications.reminder_reservation VALUES ('019a9400-0000-7000-8000-0000000000a1', '019a9400-0000-7000-8000-0000000000b1', 'SMS', now())",
        'UPDATE notifications.reminder_reservation SET reserved_at = now()',
        'DELETE FROM notifications.reminder_reservation',
        'UPDATE notifications.reminder_policy SET max_count = 100',
        'TRUNCATE notifications.reminder_reservation',
      ]) {
        await expect(admin.query(statement)).rejects.toMatchObject({ code: '42501' });
      }
    } finally { await admin.query('RESET ROLE'); }
  });
  it('seul app_rw reçoit le droit de réserver, sans droit hérité PUBLIC pour app_ro', async () => {
    const result = await admin.query<{ rw: boolean; ro: boolean }>(`SELECT
      has_function_privilege('app_rw', 'notifications.reserve_reminder(uuid,uuid,text)', 'EXECUTE') AS rw,
      has_function_privilege('app_ro', 'notifications.reserve_reminder(uuid,uuid,text)', 'EXECUTE') AS ro`);
    expect(result.rows[0]).toEqual({ rw: true, ro: false });
  });
});
