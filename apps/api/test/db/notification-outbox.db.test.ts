import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './harness';
import { enqueueNotification } from '../../src/modules/notifications/outbox.store';

let container: TestDatabase;
let admin: Client;
let pool: Pool;
let migrations: string[];
const RECIPIENT = '019a9400-0000-7000-8000-0000000000a1';
const KEY = '019a9400-0000-7000-8000-0000000000b1';
type Envelope = { recipient?: string; key?: string; event?: string; locale?: string; channel?: string };

async function enqueue(input: Envelope = {}, client: Pick<Client, 'query'> = pool): Promise<boolean> {
  const result = await client.query<{ replayed: boolean }>('SELECT notifications.enqueue_notification($1,$2,$3,$4,$5) AS replayed',
    [input.recipient ?? RECIPIENT, input.key ?? KEY, input.event ?? 'PAYMENT_CONFIRMED', input.locale ?? 'fr', input.channel ?? 'SMS']);
  return result.rows[0]!.replayed;
}
async function transaction<T>(action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query('BEGIN'); await client.query('SET LOCAL ROLE app_rw');
    const result = await action(client); await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
}

beforeAll(async () => {
  migrations = await Promise.all(['0018_notification_reminder_reservation.sql', '0019_notification_outbox.sql'].map((name) => readFile(resolve('db/migrations', name), 'utf8')));
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() }); await admin.connect();
  pool = new Pool({ connectionString: container.getConnectionUri(), max: 10 });
});
afterAll(async () => { await pool?.end(); await admin?.end(); await container?.stop(); });
beforeEach(async () => {
  await admin.query('DROP SCHEMA IF EXISTS notifications CASCADE');
  for (const sql of migrations) await admin.query(sql);
});

describe('F-NOT-001/002 · outbox PostgreSQL réelle', () => {
  it('le store paramétré utilise le rôle applicatif réel', async () => {
    const result = await transaction((client) => enqueueNotification(client, { recipientId: RECIPIENT, eventKey: KEY, event: 'GOAL_FUNDED', locale: 'en', channel: 'PUSH' }));
    expect(result).toEqual({ replayed: false });
    expect((await admin.query('SELECT count(*)::integer AS n FROM notifications.outbox')).rows[0]).toEqual({ n: 1 });
  });
  it('enregistre une fois et conserve les valeurs serveur', async () => {
    const before = Date.now();
    expect(await transaction((client) => enqueue({}, client))).toBe(false);
    expect(await transaction((client) => enqueue({}, client))).toBe(true);
    const result = await admin.query<{ event_type: string; locale: string; channel: string; created_at: Date }>('SELECT * FROM notifications.outbox');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ event_type: 'PAYMENT_CONFIRMED', locale: 'fr', channel: 'SMS' });
    expect(result.rows[0]!.created_at.getTime()).toBeGreaterThanOrEqual(before);
  });
  it('NF-REL-005 dix enqueues concurrents : une seule enveloppe', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => transaction((client) => enqueue({}, client))));
    expect(results.filter((replayed) => !replayed)).toHaveLength(1);
    expect((await admin.query('SELECT count(*)::integer AS n FROM notifications.outbox')).rows[0]).toEqual({ n: 1 });
  });
  for (const change of [{ event: 'GOAL_FUNDED' }, { locale: 'en' }]) {
    it('refuse un rejeu dont le contenu change', async () => {
      await transaction((client) => enqueue({}, client));
      await expect(transaction((client) => enqueue(change, client))).rejects.toMatchObject({ code: 'P0001', message: 'IDEMPOTENCY_KEY_REUSED: enveloppe différente' });
    });
  }
  for (const input of [{ event: 'PIN' }, { locale: 'de' }, { channel: 'EMAIL' }]) {
    it('F-NOT-002 refuse un champ hors liste blanche en SQL', async () => {
      await expect(transaction((client) => enqueue(input, client))).rejects.toMatchObject({ code: 'P0001', message: 'NOTIFICATION_INVALID_REQUEST: enveloppe invalide' });
    });
  }
  it('isole les événements entre destinataires et canaux', async () => {
    await transaction((client) => enqueue({}, client));
    expect(await transaction((client) => enqueue({ recipient: randomUUID() }, client))).toBe(false);
    expect(await transaction((client) => enqueue({ channel: 'PUSH' }, client))).toBe(false);
  });
  it('NF-REL-005 rollback métier : ni réservation ni enveloppe', async () => {
    await admin.query(`INSERT INTO notifications.reminder_policy SELECT 1, 'UTC', (m + 1430) % 1440, (m + 10) % 1440, 2, 86400000
      FROM (SELECT extract(hour FROM statement_timestamp() AT TIME ZONE 'UTC')::integer * 60 + extract(minute FROM statement_timestamp() AT TIME ZONE 'UTC')::integer AS m) t`);
    const failure = new Error('TEST_TRANSACTION_ROLLBACK');
    await expect(transaction(async (client) => {
      await client.query('SELECT notifications.reserve_reminder($1,$2,$3)', [RECIPIENT, KEY, 'SMS']);
      await enqueue({ event: 'PAYMENT_REMINDER' }, client);
      // Contrôle depuis la même transaction avec son rôle propriétaire de test :
      // prouver les deux INSERT avant de provoquer le rollback, pas un no-op vert.
      await client.query('RESET ROLE');
      expect((await client.query('SELECT count(*)::integer AS n FROM notifications.outbox')).rows[0]).toEqual({ n: 1 });
      expect((await client.query('SELECT count(*)::integer AS n FROM notifications.reminder_reservation')).rows[0]).toEqual({ n: 1 });
      throw failure;
    })).rejects.toBe(failure);
    expect((await admin.query('SELECT count(*)::integer AS n FROM notifications.outbox')).rows[0]).toEqual({ n: 0 });
    expect((await admin.query('SELECT count(*)::integer AS n FROM notifications.reminder_reservation')).rows[0]).toEqual({ n: 0 });
  });
  it('refuse les mutations directes par app_rw', async () => {
    await admin.query('SET ROLE app_rw');
    try {
      for (const sql of ["INSERT INTO notifications.outbox VALUES ('019a9400-0000-7000-8000-0000000000a1','019a9400-0000-7000-8000-0000000000b1','SMS','PIN','fr',now())", 'UPDATE notifications.outbox SET locale = \'en\'', 'DELETE FROM notifications.outbox', 'TRUNCATE notifications.outbox']) {
        await expect(admin.query(sql)).rejects.toMatchObject({ code: '42501' });
      }
    } finally { await admin.query('RESET ROLE'); }
  });
  it('refuse les privilèges implicites PUBLIC pour app_ro', async () => {
    const result = await admin.query<{ allowed: boolean }>("SELECT has_function_privilege('app_ro','notifications.enqueue_notification(uuid,uuid,text,text,text)','EXECUTE') AS allowed");
    expect(result.rows[0]?.allowed).toBe(false);
  });
  it('refuse les paramètres SQL nuls sans créer une enveloppe', async () => {
    await expect(transaction((client) => client.query('SELECT notifications.enqueue_notification(NULL,$1,$2,$3,$4)', [KEY, 'GOAL_FUNDED', 'fr', 'SMS'])))
      .rejects.toMatchObject({ code: 'P0001', message: 'NOTIFICATION_INVALID_REQUEST: enveloppe invalide' });
  });
  it('refuse un instantané périmé sous REPEATABLE READ', async () => {
    const client = new Client({ connectionString: container.getConnectionUri() }); await client.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ'); await client.query('SET LOCAL ROLE app_rw');
      await expect(enqueue({}, client)).rejects.toMatchObject({ code: 'P0001', message: 'NOTIFICATION_INVALID_REQUEST: isolation non prise en charge' });
    } finally { await client.query('ROLLBACK'); await client.end(); }
  });
});
