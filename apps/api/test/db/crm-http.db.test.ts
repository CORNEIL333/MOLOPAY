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
 * Q5 / F-SUP-001 / F-BO-004 : CRM du back-office — fiche client 360° en
 * lecture motivée et journalisée (numéro masqué seulement), interactions et
 * tâches en ajout seul, autorisations du support vérifiées côté serveur.
 * HTTP réel, PostgreSQL réel, toutes les migrations.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['crm', 'kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const CUSTOMER = '019abe20-0000-7000-8000-0000000000c1';
const PHONE = '+23761812400';

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];
let cookies: Record<'n1' | 'n2' | 'ops', string>;

function server(): Server {
  return app.getHttpServer() as Server;
}

function problem(response: { readonly status: number; readonly body: unknown }): [number, string | undefined] {
  return [response.status, (response.body as { code?: string }).code];
}

function file(cookie: string, accountId: string, reason: string): request.Test {
  return request(server())
    .get(`/v1/backoffice/crm/customers/${accountId}`)
    .query({ reason })
    .set('Origin', STAFF_ORIGIN)
    .set('Cookie', cookie);
}

function post(cookie: string, path: string, body: object, key: string): request.Test {
  return request(server()).post(path).set('Origin', STAFF_ORIGIN).set('Cookie', cookie).set('Idempotency-Key', key).send(body);
}

beforeAll(async () => {
  migrations = readdirSync(DIRECTORY).filter((name) => name.endsWith('.sql')).sort().map((name) => readFileSync(resolve(DIRECTORY, name), 'utf8'));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ database, allowedOrigins: new Set([STAFF_ORIGIN]), staffRp: STAFF_RP_TEST })],
  }).compile();
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
  for (const schema of SCHEMAS) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrations) {
    await admin.query(sql);
  }
  await admin.query(
    `INSERT INTO identity.account (id, phone, phone_verified_at, kyc_level) VALUES ($1, $2, now(), 'NONE')`,
    [CUSTOMER, PHONE],
  );
  const result: Partial<typeof cookies> = {};
  for (const [slot, login, roles] of [['n1', 'sup.un', ['SUPPORT_N1']], ['n2', 'sup.deux', ['SUPPORT_N2']], ['ops', 'ops.un', ['OPERATIONS']]] as const) {
    const { key } = await createStaffWithKey(db.getConnectionUri(), { login, roles: [...roles] });
    result[slot] = staffCookie(await loginOverHttp(server(), login, key, 1));
  }
  cookies = result as typeof cookies;
});

describe('Q5 / F-SUP-001 fiche client 360° du CRM', () => {
  it('support N2 : fiche masquée, consultation inscrite à l’audit avec motif et identifiant du client', async () => {
    const response = await file(cookies.n2, CUSTOMER, 'Réclamation client, vérification du dossier');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const body = response.body as { accountId: string; phoneMasked: string; legalNameDeclared: boolean; agreements: unknown[]; interactions: unknown[]; tasks: unknown[] };
    expect(body.accountId).toBe(CUSTOMER);
    expect(body.phoneMasked).toMatch(/^\+\d{3}•{6}\d{2}$/);
    expect(body.legalNameDeclared).toBe(false);
    expect(body.agreements).toEqual([]);
    expect(body.interactions).toEqual([]);
    expect(body.tasks).toEqual([]);
    // Forme minimale : ni numéro en clair, ni nom, ni pièce d'identité.
    expect(Object.keys(body).sort()).toEqual(['accountId', 'agreements', 'interactions', 'legalNameDeclared', 'memberSince', 'phoneMasked', 'tasks']);
    expect(JSON.stringify(body)).not.toContain(PHONE);
    const audit = await admin.query(
      `SELECT event_type, actor_id, action, reason, refs ->> 'client_id' AS client FROM audit.event WHERE event_type = 'SENSITIVE_DATA_READ'`,
    );
    expect(audit.rows).toEqual([{
      event_type: 'SENSITIVE_DATA_READ',
      actor_id: 'sup.deux',
      action: 'READ_FINANCIAL_HISTORY',
      reason: 'Réclamation client, vérification du dossier',
      client: CUSTOMER,
    }]);
  });

  it('support N1 : lecture refusée (ADMIN_FORBIDDEN), rien n’est journalisé ; motif absent ou court : 400', async () => {
    expect(problem(await file(cookies.n1, CUSTOMER, 'Réclamation client'))).toEqual([403, 'ADMIN_FORBIDDEN']);
    expect(problem(await file(cookies.n2, CUSTOMER, ''))).toEqual([400, 'REQUEST_INVALID']);
    expect(problem(await file(cookies.n2, CUSTOMER, 'ab'))).toEqual([400, 'REQUEST_INVALID']);
    expect((await admin.query(`SELECT count(*)::int AS n FROM audit.event WHERE event_type = 'SENSITIVE_DATA_READ'`)).rows[0]).toEqual({ n: 0 });
  });

  it('compte inconnu : 404 IDENTITY_ACCOUNT_NOT_FOUND, sans lecture ni audit', async () => {
    expect(problem(await file(cookies.n2, uuidv7(), 'Réclamation client'))).toEqual([404, 'IDENTITY_ACCOUNT_NOT_FOUND']);
    expect((await admin.query(`SELECT count(*)::int AS n FROM audit.event WHERE event_type = 'SENSITIVE_DATA_READ'`)).rows[0]).toEqual({ n: 0 });
  });

  it('sans session du personnel : 401 STAFF_AUTH_INVALID', async () => {
    const anonymous = await request(server()).get(`/v1/backoffice/crm/customers/${CUSTOMER}`).query({ reason: 'Réclamation client' }).set('Origin', STAFF_ORIGIN);
    expect(problem(anonymous)).toEqual([401, 'STAFF_AUTH_INVALID']);
  });
});

describe('Q5 / F-SUP-001 journal CRM en ajout seul', () => {
  it('N1 enregistre un échange (201) ; il apparaît dans la fiche du N2, auteur tracé, rejeu sans second effet', async () => {
    const path = `/v1/backoffice/crm/customers/${CUSTOMER}/interactions`;
    const body = { channel: 'PHONE', direction: 'INBOUND', summary: '  Client : versement annoncé non reçu  ', outcome: 'Reçu transmis par WhatsApp', occurredAt: new Date(Date.now() - 3_600_000).toISOString() };
    const key = `crm-${uuidv7()}`;
    const first = await post(cookies.n1, path, body, key);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.headers['cache-control']).toBe('private, no-store');
    const created = first.body as { accountId: string; interactionId: string; recordedAt: string };
    expect(created.accountId).toBe(CUSTOMER);
    expect(created.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const replay = await post(cookies.n1, path, body, key);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect((await admin.query('SELECT count(*)::int AS n FROM crm.interaction')).rows[0]).toEqual({ n: 1 });
    const stored = await admin.query('SELECT summary, outcome, actor_id FROM crm.interaction');
    expect(stored.rows).toEqual([{ summary: 'Client : versement annoncé non reçu', outcome: 'Reçu transmis par WhatsApp', actor_id: 'sup.un' }]);

    const sheet = await file(cookies.n2, CUSTOMER, 'Suivi du dossier client');
    expect(sheet.status).toBe(200);
    expect((sheet.body as { interactions: readonly { summary: string; actorId: string }[] }).interactions).toEqual([
      expect.objectContaining({ summary: 'Client : versement annoncé non reçu', actorId: 'sup.un' }),
    ]);
  });

  it('écriture refusée hors support (OPERATIONS) ; compte inconnu : 404 ; texte hors bornes : 400 CRM_INVALID_REQUEST', async () => {
    const path = `/v1/backoffice/crm/customers/${CUSTOMER}/interactions`;
    const valid = { channel: 'PHONE', direction: 'INBOUND', summary: 'Appel client', occurredAt: new Date(Date.now() - 60_000).toISOString() };
    expect(problem(await post(cookies.ops, path, valid, `crm-${uuidv7()}`))).toEqual([403, 'ADMIN_FORBIDDEN']);
    expect(problem(await post(cookies.n1, `/v1/backoffice/crm/customers/${uuidv7()}/interactions`, valid, `crm-${uuidv7()}`))).toEqual([404, 'IDENTITY_ACCOUNT_NOT_FOUND']);
    expect(problem(await post(cookies.n1, path, { ...valid, summary: 'a\nb' }, `crm-${uuidv7()}`))).toEqual([400, 'CRM_INVALID_REQUEST']);
    expect(problem(await post(cookies.n1, path, { ...valid, channel: 'PIGEON' }, `crm-${uuidv7()}`))).toEqual([400, 'REQUEST_INVALID']);
    expect((await admin.query('SELECT count(*)::int AS n FROM crm.interaction')).rows[0]).toEqual({ n: 0 });
  });

  it('sans clé d’idempotence : 400 REQUEST_INVALID avant toute écriture', async () => {
    const response = await request(server())
      .post(`/v1/backoffice/crm/customers/${CUSTOMER}/interactions`)
      .set('Origin', STAFF_ORIGIN)
      .set('Cookie', cookies.n1)
      .send({ channel: 'PHONE', direction: 'INBOUND', summary: 'Appel client' });
    expect(problem(response)).toEqual([400, 'REQUEST_INVALID']);
    expect(((response.body as { detail?: string }).detail ?? '')).toContain('Idempotency-Key');
    expect((await admin.query('SELECT count(*)::int AS n FROM crm.interaction')).rows[0]).toEqual({ n: 0 });
  });

  it('tâche : créée OUVERTE, close une seule fois (CRM_TASK_CLOSED), inconnue : 404, motif obligatoire', async () => {
    const created = await post(cookies.n2, `/v1/backoffice/crm/customers/${CUSTOMER}/tasks`, {
      title: 'Rappeler le client', details: 'Versement annoncé non reçu', priority: 'HIGH', assignee: 'sup.deux', dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    }, `crm-${uuidv7()}`);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const task = created.body as { taskId: string; status: string; createdAt: string };
    expect(task.status).toBe('OPEN');
    const transition = `/v1/backoffice/crm/tasks/${task.taskId}/transitions`;
    const done = await post(cookies.n2, transition, { kind: 'COMPLETED', note: 'Client rappelé, versement retrouvé' }, `crm-${uuidv7()}`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toEqual({ taskId: task.taskId, seq: 2, kind: 'COMPLETED', recordedAt: expect.any(String) as unknown });
    expect(problem(await post(cookies.n2, transition, { kind: 'CANCELLED', note: 'Doublon' }, `crm-${uuidv7()}`))).toEqual([409, 'CRM_TASK_CLOSED']);
    expect(problem(await post(cookies.n2, `/v1/backoffice/crm/tasks/${uuidv7()}/transitions`, { kind: 'COMPLETED', note: 'Client rappelé' }, `crm-${uuidv7()}`))).toEqual([404, 'CRM_TASK_NOT_FOUND']);
    expect(problem(await post(cookies.n2, transition, { kind: 'COMPLETED', note: ' ' }, `crm-${uuidv7()}`))).toEqual([400, 'REQUEST_INVALID']);

    const sheet = await file(cookies.n2, CUSTOMER, 'Suivi du dossier client');
    expect((sheet.body as { tasks: readonly { status: string; title: string }[] }).tasks).toEqual([
      expect.objectContaining({ status: 'COMPLETED', title: 'Rappeler le client' }),
    ]);
    const events = await admin.query('SELECT seq, kind, actor_id FROM crm.follow_up_task_event ORDER BY seq');
    expect(events.rows).toEqual([
      { seq: 1, kind: 'OPENED', actor_id: 'sup.deux' },
      { seq: 2, kind: 'COMPLETED', actor_id: 'sup.deux' },
    ]);
  });

  it('une tâche ne se modifie pas, même par la base d’administration (CRM_APPEND_ONLY)', async () => {
    const created = await post(cookies.n2, `/v1/backoffice/crm/customers/${CUSTOMER}/tasks`, { title: 'Confirmer la remise', assignee: 'sup.deux' }, `crm-${uuidv7()}`);
    const task = created.body as { taskId: string };
    await expect(admin.query(`UPDATE crm.follow_up_task SET title = 'Autre' WHERE id = $1`, [task.taskId])).rejects.toThrow(/CRM_APPEND_ONLY/);
  });
});
