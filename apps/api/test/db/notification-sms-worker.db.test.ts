import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { revealPhone } from '../../src/modules/identity/phone-key';
import { twilioSmsSender, type TwilioConfig } from '../../src/modules/identity/twilio-sms';
import { claimSmsNotification } from '../../src/modules/notifications/dispatch.store';
import { dispatchNextSms, runSmsWorker, smsText, type SmsDispatchOutcome } from '../../src/workflows/sms-worker';
import { notifyCustomer } from '../../src/workflows/notify';
import { seedCustomerAccount } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { TEST_PII_KEYS } from './pii-fixture';

/**
 * D121, tranche 2 : le travailleur SMS (rôle notification_worker) prend une
 * notification SMS, déchiffre le numéro au dernier moment, envoie le gabarit
 * dans la langue de la notification par l'adaptateur Twilio réel de
 * l'application (seul le transport HTTP est remplacé : aucun service joint
 * pendant les tests), puis confirme avec la référence du prestataire.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const CUSTOMER = '019ac200-0000-7000-8000-0000000000c1';
const OTHER = '019ac200-0000-7000-8000-0000000000c2';
const CONFIG: TwilioConfig = { accountSid: `AC${'0'.repeat(32)}`, username: `AC${'0'.repeat(32)}`, password: 'jeton-de-test', sender: { from: '+15005550006' }, baseUrl: 'https://api.twilio.com' };

let db: TestDatabase;
let admin: Client;
let workerPool: Pool;
let migrations: string[];
type Sent = { readonly to: string | null; readonly body: string | null };
let sent: Sent[];
let reply: { status: number; body: unknown } | 'NETWORK_DOWN';
let counter = 0;

/** Transport HTTP de l'adaptateur Twilio, remplacé : enregistre la requête et répond comme Twilio. */
function transport(url: string, init: { readonly body: string }): Promise<{ status: number; json: () => Promise<unknown> }> {
  expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/AC${'0'.repeat(32)}/Messages.json`);
  const form = new URLSearchParams(init.body);
  sent.push({ to: form.get('To'), body: form.get('Body') });
  if (reply === 'NETWORK_DOWN') return Promise.reject(new Error('ECONNRESET'));
  const answer = reply;
  return Promise.resolve({ status: answer.status, json: () => Promise.resolve(answer.body) });
}

function deps(): Parameters<typeof dispatchNextSms>[0] {
  return { pool: workerPool, sms: twilioSmsSender(CONFIG, transport), piiKeys: TEST_PII_KEYS };
}

function sid(): string {
  counter += 1;
  return `SM${counter.toString(16).padStart(32, '0')}`;
}

async function asApp<T>(action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: db.getConnectionUri() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_rw');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } finally {
    await client.end();
  }
}

async function phoneOf(account: string): Promise<string> {
  const row = (await admin.query<{ phone: string; phone_ciphertext: string }>('SELECT phone, phone_ciphertext FROM identity.account WHERE id = $1', [account])).rows[0];
  return revealPhone({ key: row?.phone ?? '', ciphertext: row?.phone_ciphertext ?? '' }, TEST_PII_KEYS);
}

async function expireLeases(): Promise<void> {
  await admin.query(`UPDATE notifications.dispatch_state SET lease_until = clock_timestamp() - interval '1 second', available_at = clock_timestamp() - interval '1 second' WHERE claim_id IS NOT NULL`);
  await admin.query(`UPDATE notifications.dispatch_state SET available_at = clock_timestamp() - interval '1 second' WHERE claim_id IS NULL AND available_at > clock_timestamp()`);
}

beforeAll(async () => {
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  workerPool = new Pool({ connectionString: db.getConnectionUri(), options: '-c role=notification_worker', max: 2 });
}, 300_000);

afterAll(async () => {
  await workerPool.end();
  await admin.end();
  await db.stop();
});

beforeEach(async () => {
  for (const schema of SCHEMAS) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  for (const sql of migrations) await admin.query(sql);
  await seedCustomerAccount(admin, CUSTOMER, 'NONE');
  await seedCustomerAccount(admin, OTHER, 'NONE');
  sent = [];
  reply = { status: 201, body: { sid: sid(), status: 'queued' } };
});

describe('D121 travailleur SMS', () => {
  it('envoie au numéro déchiffré le gabarit dans la langue du client, confirme avec la référence Twilio ; le push reste en file', async () => {
    await asApp((client) => client.query(`SELECT notifications.set_sms_channel('PAYMENT_CONFIRMED', true, 'ops.dla', 'SMS des confirmations')`));
    await asApp((client) => client.query(`SELECT identity.declare_language($1, 'en')`, [CUSTOMER]));
    await asApp((client) => notifyCustomer(client, { customerId: CUSTOMER, event: 'PAYMENT_CONFIRMED', eventKey: '019ac200-0000-8000-8000-0000000000e1' }));
    const ref = (reply as { body: { sid: string } }).body.sid;
    expect(await dispatchNextSms(deps())).toBe('SENT');
    expect(sent).toEqual([{ to: await phoneOf(CUSTOMER), body: smsText('PAYMENT_CONFIRMED', 'en') }]);
    expect(smsText('PAYMENT_CONFIRMED', 'en')).toBe('Your payment is confirmed. View your receipt in Molopay.');
    const delivered = await admin.query<{ channel: string; provider_ref: string; attempt: number }>('SELECT channel, provider_ref, attempt FROM notifications.delivery');
    expect(delivered.rows).toEqual([{ channel: 'SMS', provider_ref: ref, attempt: 1 }]);
    // Plus rien à envoyer en SMS ; la notification push n'a pas été prise (prestataire à choisir, D122).
    expect(await dispatchNextSms(deps())).toBe('IDLE');
    expect(sent).toHaveLength(1);
    const push = await admin.query(`SELECT 1 FROM notifications.dispatch_state WHERE channel = 'PUSH'`);
    expect(push.rowCount).toBe(0);
  });

  it('refus ou panne de Twilio : rien de confirmé, nouvel essai après délai, puis envoi ; jamais le numéro ni le texte dans l’état', async () => {
    await asApp((client) => client.query(`SELECT notifications.set_sms_channel('HANDOVER_READY', true, 'ops.dla', 'SMS des codes de remise')`));
    await asApp((client) => notifyCustomer(client, { customerId: CUSTOMER, event: 'HANDOVER_READY', eventKey: '019ac200-0000-8000-8000-0000000000e2' }));
    reply = { status: 400, body: { code: 21211, message: 'invalid' } };
    expect(await dispatchNextSms(deps())).toBe('RETRY');
    // Bail rendu tout de suite, nouvel essai dans environ 5 minutes (politique par défaut de 0081).
    const waiting = await admin.query<{ claim_id: string | null; delay: number }>(`SELECT claim_id, extract(epoch FROM available_at - clock_timestamp())::int AS delay FROM notifications.dispatch_state`);
    expect(waiting.rows[0]?.claim_id).toBeNull();
    expect(waiting.rows[0]?.delay).toBeGreaterThan(280);
    expect(waiting.rows[0]?.delay).toBeLessThanOrEqual(300);
    // Délai de nouvel essai (5 min par défaut, 0081) : rien n'est repris tout de suite.
    expect(await dispatchNextSms(deps())).toBe('IDLE');
    await expireLeases();
    reply = 'NETWORK_DOWN';
    expect(await dispatchNextSms(deps())).toBe('RETRY');
    await expireLeases();
    reply = { status: 201, body: { sid: sid(), status: 'queued' } };
    expect(await dispatchNextSms(deps())).toBe('SENT');
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((item) => item.body))).toEqual(new Set([smsText('HANDOVER_READY', 'fr')]));
    expect((await admin.query<{ attempt: number }>('SELECT attempt FROM notifications.delivery')).rows).toEqual([{ attempt: 3 }]);
    const state = JSON.stringify((await admin.query('SELECT * FROM notifications.dispatch_state')).rows);
    expect(state).not.toContain((await phoneOf(CUSTOMER)).slice(1));
  });

  it('compte bloqué : aucun envoi, notification remise en attente ; le travailleur ne lit jamais le compte directement', async () => {
    await asApp((client) => client.query(`SELECT notifications.set_sms_channel('GOAL_FUNDED', true, 'ops.dla', 'SMS des objectifs atteints')`));
    await asApp((client) => notifyCustomer(client, { customerId: OTHER, event: 'GOAL_FUNDED', eventKey: '019ac200-0000-8000-8000-0000000000e3' }));
    await admin.query(`UPDATE identity.account SET status = 'BLOCKED', blocked_at = now(), block_channel = 'SUPPORT', block_reason = 'test' WHERE id = $1`, [OTHER]);
    expect(await dispatchNextSms(deps())).toBe('RETRY');
    expect(sent).toEqual([]);
    expect((await admin.query('SELECT 1 FROM notifications.delivery')).rowCount).toBe(0);
    const worker = await workerPool.connect();
    try {
      await expect(worker.query('SELECT phone_ciphertext FROM identity.account')).rejects.toThrow(/permission denied/);
      await expect(worker.query('SELECT * FROM notifications.outbox')).rejects.toThrow(/permission denied/);
      // Lecture du numéro réservée au travailleur : refusée au rôle de l'API (moindre privilège).
      await expect(asApp((client) => client.query(`SELECT * FROM notifications.claimed_sms_recipient('019ac200-0000-4000-8000-0000000000ff')`))).rejects.toThrow(/permission denied for function claimed_sms_recipient/);
      // Bail inconnu ou expiré : aucun numéro rendu.
      expect((await worker.query(`SELECT * FROM notifications.claimed_sms_recipient('019ac200-0000-4000-8000-0000000000ff')`)).rowCount).toBe(0);
    } finally {
      worker.release();
    }
  });

  it('bail d’une notification push : aucun numéro rendu (le numéro ne sert qu’au SMS)', async () => {
    await asApp((client) => notifyCustomer(client, { customerId: CUSTOMER, event: 'GOAL_FUNDED', eventKey: '019ac200-0000-8000-8000-0000000000e7' }));
    const worker = await workerPool.connect();
    try {
      const claim = await worker.query<{ claim_id: string; channel: string }>('SELECT claim_id, channel FROM notifications.claim_notification()');
      expect(claim.rows[0]?.channel).toBe('PUSH');
      expect((await worker.query('SELECT * FROM notifications.claimed_sms_recipient($1)', [claim.rows[0]?.claim_id])).rowCount).toBe(0);
    } finally {
      worker.release();
    }
  });

  it('bail expiré : le numéro n’est plus rendu, même pour le bail d’origine', async () => {
    await asApp((client) => client.query(`SELECT notifications.set_sms_channel('GOAL_FUNDED', true, 'ops.dla', 'SMS des objectifs atteints')`));
    await asApp((client) => notifyCustomer(client, { customerId: CUSTOMER, event: 'GOAL_FUNDED', eventKey: '019ac200-0000-8000-8000-0000000000e4' }));
    const claim = await claimSmsNotification(workerPool);
    expect(claim).not.toBeNull();
    const worker = await workerPool.connect();
    try {
      expect((await worker.query('SELECT * FROM notifications.claimed_sms_recipient($1)', [claim?.claimId])).rowCount).toBe(1);
      await expireLeases();
      expect((await worker.query('SELECT * FROM notifications.claimed_sms_recipient($1)', [claim?.claimId])).rowCount).toBe(0);
    } finally {
      worker.release();
    }
  });

  it('F-NOT-003 : rappels seulement entre 8 h et 20 h, heure de Douala (UTC+1) ; les confirmations à toute heure', async () => {
    const within = async (at: string): Promise<boolean> => (await admin.query<{ w: boolean }>('SELECT notifications.within_reminder_window($1::timestamptz) AS w', [at])).rows[0]?.w ?? false;
    expect(await within('2026-11-28T06:59:59Z')).toBe(false);
    expect(await within('2026-11-28T07:00:00Z')).toBe(true);
    expect(await within('2026-11-28T18:59:59Z')).toBe(true);
    expect(await within('2026-11-28T19:00:00Z')).toBe(false);
    expect(await within('2026-11-28T23:30:00Z')).toBe(false);
    // La prise suit la plage, quelle que soit l'heure réelle du test : la fonction de plage est
    // fixée tour à tour à « hors plage » puis « dans la plage » (même signature, même propriétaire).
    const fixWindow = (inside: boolean): Promise<unknown> => admin.query(
      `CREATE OR REPLACE FUNCTION notifications.within_reminder_window(p_at timestamptz) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$ SELECT ${inside ? 'true' : 'false'} $fn$`,
    );
    await admin.query(`SELECT notifications.enqueue_notification($1, '019ac200-0000-8000-8000-0000000000e5', 'PAYMENT_REMINDER', 'fr', 'SMS')`, [CUSTOMER]);
    await admin.query(`SELECT notifications.enqueue_notification($1, '019ac200-0000-8000-8000-0000000000e6', 'GOAL_FUNDED', 'fr', 'SMS')`, [CUSTOMER]);
    await fixWindow(false);
    // Hors plage : la confirmation part, le rappel attend sans tentative consommée.
    expect(await dispatchNextSms(deps())).toBe('SENT');
    expect(await dispatchNextSms(deps())).toBe('IDLE');
    expect(sent.map((item) => item.body)).toEqual([smsText('GOAL_FUNDED', 'fr')]);
    expect((await admin.query(`SELECT 1 FROM notifications.dispatch_state s JOIN notifications.outbox o USING (recipient_id, event_key, channel) WHERE o.event_type = 'PAYMENT_REMINDER'`)).rowCount).toBe(0);
    reply = { status: 201, body: { sid: sid(), status: 'queued' } };
    await fixWindow(true);
    expect(await dispatchNextSms(deps())).toBe('SENT');
    expect(sent.map((item) => item.body)).toEqual([smsText('GOAL_FUNDED', 'fr'), smsText('PAYMENT_REMINDER', 'fr')]);
  });

  it('boucle : enchaîne les envois puis s’arrête sur le signal ; une erreur de base ne la fait pas tomber', async () => {
    await asApp((client) => client.query(`SELECT notifications.set_sms_channel('DISPUTE_UPDATED', true, 'ops.dla', 'SMS des litiges')`));
    for (const [index, account] of [CUSTOMER, OTHER].entries()) {
      await asApp((client) => notifyCustomer(client, { customerId: account, event: 'DISPUTE_UPDATED', eventKey: `019ac200-0000-8000-8000-0000000000f${index}` }));
    }
    let next = 0;
    reply = { status: 201, body: { sid: sid(), status: 'queued' } };
    const sids = [sid(), sid()];
    const outcomes: SmsDispatchOutcome[] = [];
    const controller = new AbortController();
    const sms = twilioSmsSender(CONFIG, ((url: string, init: { readonly body: string }) => {
      reply = { status: 201, body: { sid: sids[next++] ?? sid(), status: 'queued' } };
      return transport(url, init);
    }));
    await runSmsWorker({ pool: workerPool, sms, piiKeys: TEST_PII_KEYS, idleDelayMs: 10_000, signal: controller.signal, onOutcome: (outcome) => { outcomes.push(outcome); if (outcome === 'IDLE') controller.abort(); } });
    expect(outcomes).toEqual(['SENT', 'SENT', 'IDLE']);
    expect((await admin.query<{ provider_ref: string }>('SELECT provider_ref FROM notifications.delivery ORDER BY provider_ref')).rows.map((row) => row.provider_ref)).toEqual([...sids].sort());

    const broken = new Pool({ connectionString: db.getConnectionUri(), options: '-c role=app_ro', max: 1 });
    const errors: SmsDispatchOutcome[] = [];
    const at: number[] = [];
    const stop = new AbortController();
    try {
      await runSmsWorker({ pool: broken, sms, piiKeys: TEST_PII_KEYS, idleDelayMs: 300, signal: stop.signal, onOutcome: (outcome) => { errors.push(outcome); at.push(Date.now()); if (errors.length === 2) stop.abort(); } });
    } finally {
      await broken.end();
    }
    expect(errors).toEqual(['ERROR', 'ERROR']);
    // Après une erreur, attente avant la tentative suivante (pas de boucle serrée contre la base).
    expect((at[1] ?? 0) - (at[0] ?? 0)).toBeGreaterThanOrEqual(250);
  });
});
