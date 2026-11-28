import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { notifyCustomer } from '../../src/workflows/notify';
import { seedCustomerAccount } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * D121 (fondateur, 28 novembre) : push au lancement ; SMS activé par l'équipe,
 * par type de notification ; langue choisie dans l'application. La base garde
 * les deux réglages en ajout seul et décide, à la mise en file, des canaux et
 * de la langue de chaque notification.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const CUSTOMER = '019ac100-0000-7000-8000-0000000000c1';
const OTHER = '019ac100-0000-7000-8000-0000000000c2';
const EVENTS = ['PAYMENT_CONFIRMED', 'PAYMENT_REMINDER', 'GOAL_FUNDED', 'HANDOVER_READY', 'SETTLEMENT_CONFIRMED', 'DISPUTE_UPDATED'];

let db: TestDatabase;
let admin: Client;
let migrations: string[];

async function asApp<T>(action: (client: Client) => Promise<T>, role = 'app_rw'): Promise<T> {
  const client = new Client({ connectionString: db.getConnectionUri() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function outbox(recipient: string): Promise<Array<{ channel: string; locale: string; event_type: string }>> {
  return (await admin.query<{ channel: string; locale: string; event_type: string }>(
    'SELECT channel, locale, event_type FROM notifications.outbox WHERE recipient_id = $1 ORDER BY event_type, channel', [recipient],
  )).rows;
}

beforeAll(async () => {
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
}, 300_000);

afterAll(async () => {
  await admin.end();
  await db.stop();
});

beforeEach(async () => {
  for (const schema of SCHEMAS) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  for (const sql of migrations) await admin.query(sql);
  await seedCustomerAccount(admin, CUSTOMER, 'NONE');
  await seedCustomerAccount(admin, OTHER, 'NONE');
});

describe('D121 — langue choisie dans l’application', () => {
  it('sans déclaration : français ; la dernière déclaration fait foi ; une déclaration identique n’écrit rien', async () => {
    const preferred = (account: string): Promise<string> => asApp(async (client) => (await client.query<{ l: string }>('SELECT identity.preferred_language($1) AS l', [account])).rows[0]?.l ?? '', 'app_ro');
    expect(await preferred(CUSTOMER)).toBe('fr');
    expect(await asApp(async (client) => (await client.query<{ l: string }>(`SELECT identity.declare_language($1, 'en') AS l`, [CUSTOMER])).rows[0]?.l)).toBe('en');
    await asApp((client) => client.query(`SELECT identity.declare_language($1, 'en')`, [CUSTOMER]));
    expect(await preferred(CUSTOMER)).toBe('en');
    expect(await preferred(OTHER)).toBe('fr');
    await asApp((client) => client.query(`SELECT identity.declare_language($1, 'fr')`, [CUSTOMER]));
    expect(await preferred(CUSTOMER)).toBe('fr');
    const rows = await admin.query<{ language: string }>('SELECT language FROM identity.language_preference WHERE account_id = $1 ORDER BY seq', [CUSTOMER]);
    expect(rows.rows.map((row) => row.language)).toEqual(['en', 'fr']);
  });

  it('refuse : langue inconnue (IDENTITY_LANGUAGE_INVALID), compte bloqué ou absent (IDENTITY_ACCOUNT_BLOCKED), écriture directe, modification', async () => {
    for (const language of ['de', 'FR', '', 'fr-CM']) {
      await expect(asApp((client) => client.query('SELECT identity.declare_language($1, $2)', [CUSTOMER, language]))).rejects.toThrow(/^IDENTITY_LANGUAGE_INVALID/);
    }
    await expect(asApp((client) => client.query('SELECT identity.declare_language($1, NULL)', [CUSTOMER]))).rejects.toThrow(/^IDENTITY_LANGUAGE_INVALID/);
    await expect(asApp((client) => client.query(`SELECT identity.declare_language('019ac100-0000-7000-8000-0000000000ff', 'en')`))).rejects.toThrow(/^IDENTITY_ACCOUNT_BLOCKED/);
    await admin.query(`UPDATE identity.account SET status = 'BLOCKED', blocked_at = now(), block_channel = 'SUPPORT', block_reason = 'test' WHERE id = $1`, [OTHER]);
    await expect(asApp((client) => client.query(`SELECT identity.declare_language($1, 'en')`, [OTHER]))).rejects.toThrow(/^IDENTITY_ACCOUNT_BLOCKED/);
    await expect(asApp((client) => client.query(`INSERT INTO identity.language_preference (account_id, language) VALUES ($1, 'en')`, [CUSTOMER]))).rejects.toThrow(/permission denied/);
    await expect(asApp((client) => client.query('SELECT * FROM identity.language_preference'), 'app_ro')).rejects.toThrow(/permission denied/);
    await asApp((client) => client.query(`SELECT identity.declare_language($1, 'en')`, [CUSTOMER]));
    // Ajout seul, même pour le propriétaire du schéma (déclencheurs ENABLE ALWAYS).
    await expect(admin.query(`UPDATE identity.language_preference SET language = 'fr'`)).rejects.toThrow(/^IDENTITY_APPEND_ONLY/);
    await expect(admin.query('DELETE FROM identity.language_preference')).rejects.toThrow(/^IDENTITY_APPEND_ONLY/);
    await expect(admin.query('TRUNCATE identity.language_preference')).rejects.toThrow(/^IDENTITY_APPEND_ONLY/);
    // L'horodatage est posé par la base, jamais par l'appelant.
    await admin.query(`INSERT INTO identity.language_preference (account_id, language, declared_at) VALUES ($1, 'fr', '2000-01-01')`, [CUSTOMER]);
    const latest = await admin.query<{ year: number }>('SELECT extract(year FROM declared_at)::int AS year FROM identity.language_preference ORDER BY seq DESC LIMIT 1');
    expect(latest.rows[0]?.year).toBeGreaterThan(2000);
  });
});

describe('D121 — bascule SMS par type de notification', () => {
  const states = (): Promise<Array<{ event_type: string; enabled: boolean; set_by: string | null }>> =>
    asApp(async (client) => (await client.query<{ event_type: string; enabled: boolean; set_by: string | null }>('SELECT event_type, enabled, set_by FROM notifications.sms_channel_states()')).rows);

  it('désactivé par défaut pour les six types ; une bascule s’applique à son type seulement ; l’état revient sur demande', async () => {
    expect((await states()).map((row) => [row.event_type, row.enabled])).toEqual(EVENTS.map((event) => [event, false]));
    await asApp((client) => client.query(`SELECT notifications.set_sms_channel('HANDOVER_READY', true, 'ops.dla', 'Code de remise : canal SMS ouvert')`));
    const after = await states();
    expect(after.filter((row) => row.enabled).map((row) => [row.event_type, row.set_by])).toEqual([['HANDOVER_READY', 'ops.dla']]);
    expect(await asApp(async (client) => (await client.query<{ e: boolean }>(`SELECT notifications.sms_enabled('HANDOVER_READY') AS e`)).rows[0]?.e)).toBe(true);
    expect(await asApp(async (client) => (await client.query<{ e: boolean }>(`SELECT notifications.sms_enabled('GOAL_FUNDED') AS e`)).rows[0]?.e)).toBe(false);
    await asApp((client) => client.query(`SELECT notifications.set_sms_channel('HANDOVER_READY', false, 'ops.dla2', 'Retour au push seul')`));
    expect((await states()).every((row) => !row.enabled)).toBe(true);
  });

  it('refuse : état inchangé (NOTIFICATION_CHANNEL_UNCHANGED), type inconnu, motif trop court, auteur invalide, écriture directe, modification', async () => {
    await expect(asApp((client) => client.query(`SELECT notifications.set_sms_channel('GOAL_FUNDED', false, 'ops.dla', 'Déjà fermé')`))).rejects.toThrow(/^NOTIFICATION_CHANNEL_UNCHANGED/);
    await expect(asApp((client) => client.query(`SELECT notifications.set_sms_channel('MARKETING', true, 'ops.dla', 'Promotion')`))).rejects.toThrow(/sms_channel_setting_event_type_check/);
    await expect(asApp((client) => client.query(`SELECT notifications.set_sms_channel('GOAL_FUNDED', true, 'ops.dla', '  ok ')`))).rejects.toThrow(/sms_channel_setting_reason_check/);
    await expect(asApp((client) => client.query(`SELECT notifications.set_sms_channel('GOAL_FUNDED', true, 'ops dla', 'Motif valable')`))).rejects.toThrow(/sms_channel_setting_set_by_check/);
    await expect(asApp((client) => client.query(`SELECT notifications.set_sms_channel('GOAL_FUNDED', NULL, 'ops.dla', 'Motif valable')`))).rejects.toThrow(/^NOTIFICATION_INVALID_REQUEST/);
    await expect(asApp((client) => client.query(`INSERT INTO notifications.sms_channel_setting (event_type, enabled, set_by, reason) VALUES ('GOAL_FUNDED', true, 'x', 'direct')`))).rejects.toThrow(/permission denied/);
    await expect(asApp((client) => client.query(`SELECT notifications.set_sms_channel('GOAL_FUNDED', true, 'ops.dla', 'Lecture seule')`), 'app_ro')).rejects.toThrow(/permission denied/);
    await asApp((client) => client.query(`SELECT notifications.set_sms_channel('GOAL_FUNDED', true, 'ops.dla', 'Motif valable')`));
    await expect(admin.query('UPDATE notifications.sms_channel_setting SET enabled = false')).rejects.toThrow(/^NOTIFICATION_APPEND_ONLY/);
    await expect(admin.query('DELETE FROM notifications.sms_channel_setting')).rejects.toThrow(/^NOTIFICATION_APPEND_ONLY/);
    await expect(admin.query('TRUNCATE notifications.sms_channel_setting')).rejects.toThrow(/^NOTIFICATION_APPEND_ONLY/);
  });

  it('ajout seul même en mode réplica (déclencheurs ENABLE ALWAYS) : préférence de langue et bascule SMS', async () => {
    await asApp((client) => client.query(`SELECT identity.declare_language($1, 'en')`, [CUSTOMER]));
    await asApp((client) => client.query(`SELECT notifications.set_sms_channel('GOAL_FUNDED', true, 'ops.dla', 'Motif valable')`));
    const replica = new Client({ connectionString: db.getConnectionUri() });
    await replica.connect();
    try {
      await replica.query(`SET session_replication_role = replica`);
      for (const [statement, code] of [
        [`UPDATE identity.language_preference SET language = 'fr'`, /^IDENTITY_APPEND_ONLY/],
        ['DELETE FROM identity.language_preference', /^IDENTITY_APPEND_ONLY/],
        ['TRUNCATE identity.language_preference', /^IDENTITY_APPEND_ONLY/],
        ['UPDATE notifications.sms_channel_setting SET enabled = false', /^NOTIFICATION_APPEND_ONLY/],
        ['DELETE FROM notifications.sms_channel_setting', /^NOTIFICATION_APPEND_ONLY/],
        ['TRUNCATE notifications.sms_channel_setting', /^NOTIFICATION_APPEND_ONLY/],
      ] as const) {
        await expect(replica.query(statement), statement).rejects.toThrow(code);
      }
    } finally {
      await replica.end();
    }
  });

  it('verrou : une bascule concurrente attend la première, puis la voit (NOTIFICATION_CHANNEL_UNCHANGED)', async () => {
    const first = new Client({ connectionString: db.getConnectionUri() });
    await first.connect();
    try {
      await first.query('BEGIN');
      await first.query('SET LOCAL ROLE app_rw');
      await first.query(`SELECT notifications.set_sms_channel('GOAL_FUNDED', true, 'ops.a', 'Première ouverture')`);
      let settled = false;
      const second = asApp((client) => client.query(`SELECT notifications.set_sms_channel('GOAL_FUNDED', true, 'ops.b', 'Seconde ouverture')`)).finally(() => { settled = true; });
      const outcome = second.then(() => 'ACCEPTED', (error: unknown) => (error instanceof Error ? error.message : 'ERROR'));
      await new Promise((resolveWait) => setTimeout(resolveWait, 400));
      expect(settled).toBe(false);
      await first.query('COMMIT');
      expect(await outcome).toMatch(/^NOTIFICATION_CHANNEL_UNCHANGED/);
    } finally {
      await first.end();
    }
    expect((await admin.query('SELECT set_by FROM notifications.sms_channel_setting')).rows).toEqual([{ set_by: 'ops.a' }]);
  });

  it('bascules concurrentes vers le même état : une seule est inscrite', async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) =>
      asApp((client) => client.query(`SELECT notifications.set_sms_channel('PAYMENT_CONFIRMED', true, $1, 'Ouverture concurrente')`, [`ops.${index}`]))));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const reasons = results.flatMap((result) => (result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : ''] : []));
    expect(reasons).toHaveLength(5);
    expect(reasons.every((message) => message.startsWith('NOTIFICATION_CHANNEL_UNCHANGED'))).toBe(true);
    expect((await admin.query('SELECT 1 FROM notifications.sms_channel_setting')).rowCount).toBe(1);
  });
});

describe('D121 — canaux et langue décidés à la mise en file', () => {
  const KEY_A = '019ac100-0000-8000-8000-0000000000a1';
  const KEY_B = '019ac100-0000-8000-8000-0000000000a2';

  it('ouvert puis refermé : la dernière bascule fait foi (push seul)', async () => {
    await asApp((client) => client.query(`SELECT notifications.set_sms_channel('PAYMENT_CONFIRMED', true, 'ops.dla', 'Ouverture')`));
    await asApp((client) => client.query(`SELECT notifications.set_sms_channel('PAYMENT_CONFIRMED', false, 'ops.dla', 'Fermeture')`));
    await asApp((client) => notifyCustomer(client, { customerId: CUSTOMER, event: 'PAYMENT_CONFIRMED', eventKey: KEY_A }));
    expect(await outbox(CUSTOMER)).toEqual([{ channel: 'PUSH', locale: 'fr', event_type: 'PAYMENT_CONFIRMED' }]);
  });

  it('par défaut : push seul, en français', async () => {
    await asApp((client) => notifyCustomer(client, { customerId: CUSTOMER, event: 'PAYMENT_CONFIRMED', eventKey: KEY_A }));
    expect(await outbox(CUSTOMER)).toEqual([{ channel: 'PUSH', locale: 'fr', event_type: 'PAYMENT_CONFIRMED' }]);
  });

  it('SMS ouvert pour un type : push et SMS pour ce type seulement ; langue déclarée par le client ; la bascule ne s’applique pas aux notifications déjà en file', async () => {
    await asApp((client) => notifyCustomer(client, { customerId: CUSTOMER, event: 'GOAL_FUNDED', eventKey: KEY_A }));
    await asApp((client) => client.query(`SELECT notifications.set_sms_channel('PAYMENT_CONFIRMED', true, 'ops.dla', 'Confirmation de versement par SMS')`));
    await asApp((client) => client.query(`SELECT identity.declare_language($1, 'en')`, [CUSTOMER]));
    await asApp((client) => notifyCustomer(client, { customerId: CUSTOMER, event: 'PAYMENT_CONFIRMED', eventKey: KEY_B }));
    await asApp((client) => notifyCustomer(client, { customerId: OTHER, event: 'PAYMENT_CONFIRMED', eventKey: KEY_B }));
    expect(await outbox(CUSTOMER)).toEqual([
      { channel: 'PUSH', locale: 'fr', event_type: 'GOAL_FUNDED' },
      { channel: 'PUSH', locale: 'en', event_type: 'PAYMENT_CONFIRMED' },
      { channel: 'SMS', locale: 'en', event_type: 'PAYMENT_CONFIRMED' },
    ]);
    expect(await outbox(OTHER)).toEqual([
      { channel: 'PUSH', locale: 'fr', event_type: 'PAYMENT_CONFIRMED' },
      { channel: 'SMS', locale: 'fr', event_type: 'PAYMENT_CONFIRMED' },
    ]);
    // Rejeu du même fait : rien de plus (INT-IDEM-004).
    await asApp((client) => notifyCustomer(client, { customerId: CUSTOMER, event: 'PAYMENT_CONFIRMED', eventKey: KEY_B }));
    expect(await outbox(CUSTOMER)).toHaveLength(3);
  });
});
