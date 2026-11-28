import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { createDatabase, type Database } from '../../src/http/database';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { startTestDatabase, type TestDatabase } from './harness';
import { createStaffWithKey, loginOverHttp, STAFF_ORIGIN, STAFF_RP_TEST, staffCookie } from './staff-fixture';

/**
 * D121 (fondateur, 28 novembre) : l'équipe ouvre ou ferme le SMS par type de
 * notification, d'un geste simple, motivé et inscrit à l'audit, en HTTP réel.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];
let cookies: Record<'ops' | 'support' | 'finance', string>;

function server(): Server {
  return app.getHttpServer() as Server;
}

function problem(response: { readonly status: number; readonly body: unknown }): [number, string | undefined] {
  return [response.status, (response.body as { code?: string }).code];
}

function list(cookie: string | null): request.Test {
  const call = request(server()).get('/v1/backoffice/notifications/sms-channels').set('Origin', STAFF_ORIGIN);
  return cookie === null ? call : call.set('Cookie', cookie);
}

function toggle(cookie: string, eventType: string, body: unknown, key = `sms-${uuidv7()}`): request.Test {
  return request(server()).put(`/v1/backoffice/notifications/sms-channels/${eventType}`).set('Origin', STAFF_ORIGIN).set('Cookie', cookie).set('Idempotency-Key', key).send(body as object);
}

beforeAll(async () => {
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set([STAFF_ORIGIN]), staffRp: STAFF_RP_TEST })] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
}, 300_000);

afterAll(async () => {
  await app.close();
  await database.pool.end();
  await admin.end();
  await db.stop();
});

beforeEach(async () => {
  for (const schema of SCHEMAS) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  for (const sql of migrations) await admin.query(sql);
  const uri = db.getConnectionUri();
  const result: Partial<typeof cookies> = {};
  for (const [slot, login, roles] of [['ops', 'ops.dla', ['OPERATIONS']], ['support', 'sup.dla', ['SUPPORT_N2']], ['finance', 'fin.dla', ['FINANCE']]] as const) {
    const { key } = await createStaffWithKey(uri, { login, roles: [...roles], cityIds: ['douala'] });
    result[slot] = staffCookie(await loginOverHttp(server(), login, key, 1));
  }
  cookies = result as typeof cookies;
});

describe('D121 bascule SMS par type au back-office', () => {
  it('liste les six types, tous fermés ; ouverture motivée : état, auteur et audit dans la même transaction ; fermeture ensuite', async () => {
    const initial = await list(cookies.ops);
    expect(initial.status, JSON.stringify(initial.body)).toBe(200);
    expect(initial.headers['cache-control']).toBe('private, no-store');
    const items = (initial.body as { items: Array<{ eventType: string; smsEnabled: boolean; setBy: string | null; setAt: string | null }> }).items;
    expect(items.map((item) => [item.eventType, item.smsEnabled, item.setBy, item.setAt])).toEqual(
      ['PAYMENT_CONFIRMED', 'PAYMENT_REMINDER', 'GOAL_FUNDED', 'HANDOVER_READY', 'SETTLEMENT_CONFIRMED', 'DISPUTE_UPDATED'].map((event) => [event, false, null, null]),
    );
    const key = `sms-${uuidv7()}`;
    const opened = await toggle(cookies.ops, 'HANDOVER_READY', { enabled: true, reason: 'Remise : SMS utile hors connexion' }, key);
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    expect(opened.body).toEqual({ eventType: 'HANDOVER_READY', smsEnabled: true });
    // Rejeu avec la même clé : même réponse, rien de plus.
    expect((await toggle(cookies.ops, 'HANDOVER_READY', { enabled: true, reason: 'Remise : SMS utile hors connexion' }, key)).body).toEqual({ eventType: 'HANDOVER_READY', smsEnabled: true });
    const after = (await list(cookies.ops)).body as { items: Array<{ eventType: string; smsEnabled: boolean; setBy: string | null; setAt: string | null }> };
    const handover = after.items.find((item) => item.eventType === 'HANDOVER_READY');
    expect(handover).toMatchObject({ smsEnabled: true });
    expect(handover?.setBy).toBe('ops.dla');
    expect(handover?.setAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(after.items.filter((item) => item.smsEnabled)).toHaveLength(1);
    const audit = await admin.query<{ action: string; target_type: string; target_id: string; reason: string; actor_id: string }>(
      `SELECT action, target_type, target_id, reason, actor_id FROM audit.event WHERE action = 'SMS_CHANNEL_SET' ORDER BY seq`,
    );
    expect(audit.rows).toEqual([{ action: 'SMS_CHANNEL_SET', target_type: 'NOTIFICATION_CHANNEL', target_id: 'HANDOVER_READY', reason: 'Remise : SMS utile hors connexion', actor_id: handover?.setBy }]);
    expect((await toggle(cookies.ops, 'HANDOVER_READY', { enabled: false, reason: 'Retour au push seul' })).body).toEqual({ eventType: 'HANDOVER_READY', smsEnabled: false });
    expect(((await list(cookies.ops)).body as { items: Array<{ smsEnabled: boolean }> }).items.every((item) => !item.smsEnabled)).toBe(true);
  });

  it('refuse : état inchangé (409), type inconnu, corps hors liste, booléen absent, motif absent (400), rôle sans droit (403), sans session (401) ; rien n’est inscrit', async () => {
    expect(problem(await toggle(cookies.ops, 'GOAL_FUNDED', { enabled: false, reason: 'Déjà fermé' }))).toEqual([409, 'NOTIFICATION_CHANNEL_UNCHANGED']);
    expect(problem(await toggle(cookies.ops, 'MARKETING', { enabled: true, reason: 'Promotion' }))).toEqual([400, 'NOTIFICATION_INVALID_REQUEST']);
    expect(problem(await toggle(cookies.ops, 'GOAL_FUNDED', { enabled: true, reason: 'Motif valable', recipient: 'x' }))).toEqual([400, 'REQUEST_INVALID']);
    expect(problem(await toggle(cookies.ops, 'GOAL_FUNDED', { enabled: 'true', reason: 'Motif valable' }))).toEqual([400, 'REQUEST_INVALID']);
    expect(problem(await toggle(cookies.ops, 'GOAL_FUNDED', { enabled: true }))).toEqual([400, 'REQUEST_INVALID']);
    expect(problem(await toggle(cookies.ops, 'GOAL_FUNDED', { enabled: true, reason: 'x' }))).toEqual([400, 'REQUEST_INVALID']);
    for (const cookie of [cookies.support, cookies.finance]) {
      expect(problem(await toggle(cookie, 'GOAL_FUNDED', { enabled: true, reason: 'Motif valable' }))).toEqual([403, 'ADMIN_FORBIDDEN']);
      expect(problem(await list(cookie))).toEqual([403, 'ADMIN_FORBIDDEN']);
    }
    expect(problem(await list(null))).toEqual([401, 'STAFF_AUTH_INVALID']);
    expect((await admin.query('SELECT 1 FROM notifications.sms_channel_setting')).rowCount).toBe(0);
    expect((await admin.query(`SELECT 1 FROM audit.event WHERE action = 'SMS_CHANNEL_SET'`)).rowCount).toBe(0);
  });
});
