import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../../apps/api/test/db/harness';
import { createAgreementC } from '../../apps/api/test/db/agreement-fixture';
import { runRealFlowsScenario } from '../../apps/api/test/db/real-flows-scenario';
import { uuidv7 } from '../../apps/api/src/modules/ledger/domain';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../apps/api/src/modules/payments/attempt.store';
import { recordIntegrityDivergence } from '../../apps/api/src/modules/settlement/integrity-divergence.store';
import { evaluateAlerts, monitorDatabaseUrl, readAlertCounts } from '../../tools/ops-alerts';

/**
 * NF-OBS-003 (alertes calculables en base) : paiement en attente depuis plus
 * de 15 minutes, écart de rapprochement non classé, file de notifications en
 * échec, divergence d'intégrité ou gel des flux sortants. Lecture par le seul
 * rôle de supervision (`notification_observer`), compteurs seulement, aucune
 * donnée de client. Chaque alerte est déclenchée par un vrai événement.
 */
let db: TestDatabase;
let admin: Client;
let uri: string;
const CUSTOMER = '019aa200-0000-7000-8000-0000000000c1';

async function asRole<T>(role: string, action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: uri });
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

const monitor = (at?: Date): ReturnType<typeof readAlertCounts> => asRole('notification_observer', (client) => readAlertCounts(client, at));

beforeAll(async () => {
  db = await startTestDatabase();
  uri = db.getConnectionUri();
  admin = new Client({ connectionString: uri });
  await admin.connect();
  await runRealFlowsScenario(uri, admin);
}, 600_000);

afterAll(async () => {
  await admin.end();
  await db.stop();
});

describe('NF-OBS-003 — alertes de supervision calculées en base', () => {
  it('état sain après les flux réels : aucune alerte, statut OK ; compteurs seulement', async () => {
    const counts = await monitor();
    expect(counts).toEqual({ paymentsPendingOver15Min: 0, reconciliationUnclassified: 0, notificationsExhausted: 0, integrityDivergenceOpen: false, outgoingFrozen: false });
    expect(evaluateAlerts(counts)).toEqual({ status: 'OK', alerts: [] });
  });

  it('paiement en attente : pas d’alerte avant 15 minutes, alerte critique au-delà', async () => {
    // Objectif C neuf et actif (le scénario n'en laisse aucun), puis tentative de versement réelle laissée en attente.
    const goal = '019aa200-0000-7000-8000-0000000000b7';
    const attemptId = uuidv7();
    await asRole('app_rw', async (client) => {
      await createAgreementC(client, { id: goal, customerId: CUSTOMER, active: true, beneficiaryId: 'school-1' });
      await createStoredPaymentAttempt(client, { id: attemptId, agreementId: goal, channel: 'MTN_MOMO', amountXaf: 1_000n, idemKey: uuidv7() });
      await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
    });
    expect((await monitor()).paymentsPendingOver15Min).toBe(0);
    const later = await monitor(new Date(Date.now() + 16 * 60_000));
    expect(later.paymentsPendingOver15Min).toBe(1);
    expect(evaluateAlerts(later).alerts).toEqual([{ code: 'PAYMENT_PENDING_OVER_15_MIN', severity: 'CRITICAL', count: 1 }]);
  });

  it('écart de rapprochement non classé : alerte critique', async () => {
    await asRole('app_rw', (client) => client.query(
      `INSERT INTO reconciliation.segregation_check (id, statement_date, statement_balance_xaf, outgoing_in_transit_xaf, third_party_funds_xaf, incoming_in_transit_xaf, gap_xaf, actor_id, checked_at)
       VALUES ($1, '2026-11-27', 1, 0, 0, 0, 0, 'finance-1', now())`,
      [uuidv7()],
    ));
    const counts = await monitor();
    expect(counts.reconciliationUnclassified).toBe(1);
    expect(evaluateAlerts(counts).alerts).toContainEqual({ code: 'RECONCILIATION_GAP_UNCLASSIFIED', severity: 'CRITICAL', count: 1 });
  });

  it('notification ayant épuisé ses tentatives : alerte (file en échec non vide)', async () => {
    await admin.query('INSERT INTO notifications.dispatch_policy VALUES (1, 60000, 1, 1) ON CONFLICT (id) DO UPDATE SET max_attempts = 1, retry_ms = 1');
    await admin.query('SELECT notifications.enqueue_notification($1,$2,$3,$4,$5)', [CUSTOMER, randomUUID(), 'PAYMENT_CONFIRMED', 'fr', 'SMS']);
    await asRole('notification_worker', async (client) => {
      for (const row of (await client.query<{ claim_id: string }>('SELECT claim_id FROM notifications.claim_notification()')).rows) {
        await client.query('SELECT notifications.retry_notification($1)', [row.claim_id]);
      }
    });
    const counts = await monitor();
    expect(counts.notificationsExhausted).toBeGreaterThanOrEqual(1);
    expect(evaluateAlerts(counts).alerts.map((alert) => alert.code)).toContain('NOTIFICATION_QUEUE_FAILED');
  });

  it('divergence d’intégrité : gel des flux sortants, deux alertes critiques', async () => {
    await asRole('integrity_reporter', (client) => recordIntegrityDivergence(client, 'LEDGER_CHAIN_BROKEN'));
    const counts = await monitor();
    expect(counts).toMatchObject({ integrityDivergenceOpen: true, outgoingFrozen: true });
    const result = evaluateAlerts(counts);
    expect(result.status).toBe('ALERT');
    expect(result.alerts.map((alert) => alert.code)).toEqual(expect.arrayContaining(['INTEGRITY_DIVERGENCE', 'OUTGOING_FLOWS_FROZEN']));
  });

  it('refuse : lecture par l’API ou le travailleur (permission refusée) ; aucune donnée de client dans le résultat', async () => {
    for (const role of ['app_rw', 'app_ro', 'notification_worker']) {
      await expect(asRole(role, (client) => readAlertCounts(client)), role).rejects.toThrow(/permission denied/);
    }
    expect(JSON.stringify(await monitor())).not.toMatch(/019aa200|[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('adresse : absente, sans TLS vérifié ou par le regroupeur de Neon → refus', () => {
    expect(() => monitorDatabaseUrl({})).toThrow(/^MONITOR_DATABASE_MISSING/);
    expect(() => monitorDatabaseUrl({ MONITOR_DATABASE_URL: 'postgresql://m@ep-x.eu-central-1.aws.neon.tech/db' })).toThrow(/^DATABASE_TLS_REQUIRED/);
    expect(() => monitorDatabaseUrl({ MONITOR_DATABASE_URL: 'postgresql://u@ep-x-pooler.eu-central-1.aws.neon.tech/db?sslmode=verify-full' })).toThrow(/^DATABASE_POOLER_FORBIDDEN/);
    expect(monitorDatabaseUrl({ MONITOR_DATABASE_URL: 'postgresql://m@ep-x.eu-central-1.aws.neon.tech/db?sslmode=verify-full' })).toContain('ep-x.');
  });
});
