import 'reflect-metadata';
import { createHash, generateKeyPairSync } from 'node:crypto';
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
import { issueSessionTokens } from '../../src/modules/identity/domain';
import { sessionCookieValue } from '../../src/modules/identity/session.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { seedCustomerAccount } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

/** C5 / F-NOT-001 : fil des notifications du client dans l'application (`GET /v1/me/notifications`), HTTP réel, sans prestataire. */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['crm', 'kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const ORIGIN = 'https://app.molopay.test';
const CUSTOMER = '019ab830-0000-7000-8000-0000000000c1';
const OTHER_CUSTOMER = '019ab830-0000-7000-8000-0000000000c2';


let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];

function server(): Server {
  return app.getHttpServer() as Server;
}

async function session(accountId: string): Promise<string> {
  const device = uuidv7();
  const { publicKey } = generateKeyPairSync('ed25519');
  await admin.query(
    `INSERT INTO identity.device(id, account_id, public_key_pem, fingerprint, name, status, registered_at) VALUES ($1, $2, $3, $4, 'Appareil test', 'ACTIVE', now())`,
    [device, accountId, publicKey.export({ type: 'spki', format: 'pem' }), createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest()],
  );
  const sessionId = uuidv7();
  const token = issueSessionTokens();
  await admin.query(
    `INSERT INTO identity.session(id, account_id, device_id, access_token_hash, refresh_token_hash, access_issued_at, access_expires_at, refresh_expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, now() - interval '1 minute', now() + interval '10 minutes', now() + interval '1 day', now() - interval '1 minute')`,
    [sessionId, accountId, device, token.accessTokenHash, token.refreshTokenHash],
  );
  return `client_session=${sessionCookieValue(sessionId, token.accessToken)}`;
}

function feed(cookie: string | null, query = ''): request.Test {
  const call = request(server()).get(`/v1/me/notifications${query}`).set('Origin', ORIGIN);
  return cookie === null ? call : call.set('Cookie', cookie);
}

/** Notification réelle, par la fonction d'enfilement de la base (comme les flux métier). */
async function enqueue(recipient: string, event: string, locale: 'fr' | 'en' = 'fr', channels: readonly ('SMS' | 'PUSH')[] = ['SMS', 'PUSH']): Promise<string> {
  const key = uuidv7();
  for (const channel of channels) {
    await admin.query('SELECT notifications.enqueue_notification($1, $2, $3, $4, $5)', [recipient, key, event, locale, channel]);
  }
  return key;
}

type Feed = { items: { notificationId: string; eventType: string; createdAt: string; title: string; body: string }[]; nextBefore: string | null; asOf: string };

beforeAll(async () => {
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set([ORIGIN]) })] }).compile();
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
  await seedCustomerAccount(admin, CUSTOMER, 'NONE');
});

describe('C5 / F-NOT-001 fil des notifications du client', () => {
  it('une entrée par événement (SMS et push regroupés), du plus récent au plus ancien, textes validés sans donnée personnelle', async () => {
    const first = await enqueue(CUSTOMER, 'PAYMENT_CONFIRMED');
    const second = await enqueue(CUSTOMER, 'GOAL_FUNDED');
    const response = await feed(await session(CUSTOMER));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const body = response.body as Feed;
    expect(body.items.map((item) => [item.notificationId, item.eventType])).toEqual([[second, 'GOAL_FUNDED'], [first, 'PAYMENT_CONFIRMED']]);
    expect(body.items[0]).toMatchObject({ title: 'Objectif atteint', body: 'Votre objectif est intégralement financé. Consultez la suite dans Molopay.' });
    expect(body.nextBefore).toBeNull();
    expect(Date.parse(body.asOf)).not.toBeNaN();
  });

  it('langue de la notification respectée (anglais)', async () => {
    await enqueue(CUSTOMER, 'PAYMENT_CONFIRMED', 'en', ['PUSH']);
    expect(((await feed(await session(CUSTOMER))).body as Feed).items[0]).toMatchObject({ title: 'Payment confirmed' });
  });

  it('chaque client ne voit que ses notifications ; sans session : 401 IDENTITY_SESSION_INVALID', async () => {
    await seedCustomerAccount(admin, OTHER_CUSTOMER, 'NONE');
    await enqueue(OTHER_CUSTOMER, 'DISPUTE_UPDATED');
    expect(((await feed(await session(CUSTOMER))).body as Feed).items).toEqual([]);
    expect(((await feed(await session(OTHER_CUSTOMER))).body as Feed).items).toHaveLength(1);
    const response = await feed(null);
    expect([response.status, (response.body as { code?: string }).code]).toEqual([401, 'IDENTITY_SESSION_INVALID']);
  });

  it('pagination par 50 avec curseur ; curseur d’un autre client ou illisible : 400 REQUEST_INVALID', async () => {
    const keys: string[] = [];
    for (let index = 0; index < 52; index += 1) keys.push(await enqueue(CUSTOMER, 'PAYMENT_REMINDER', 'fr', ['PUSH']));
    const cookie = await session(CUSTOMER);
    const page = (await feed(cookie)).body as Feed;
    expect(page.items).toHaveLength(50);
    expect(page.nextBefore).toBe(page.items[49]?.notificationId);
    const next = (await feed(cookie, `?before=${page.nextBefore ?? ''}`)).body as Feed;
    expect(next.items.map((item) => item.notificationId)).toEqual([keys[1], keys[0]]);
    expect(next.nextBefore).toBeNull();
    await seedCustomerAccount(admin, OTHER_CUSTOMER, 'NONE');
    const foreign = await enqueue(OTHER_CUSTOMER, 'DISPUTE_UPDATED');
    for (const query of [`?before=${foreign}`, '?before=pas-un-uuid', '?limit=10']) {
      const refused = await feed(cookie, query);
      expect([refused.status, (refused.body as { code?: string }).code], query).toEqual([400, 'REQUEST_INVALID']);
    }
  });

  it('base garante : la fonction du fil revérifie la session (révoquée, ou compte d’un autre) — IDENTITY_SESSION_INVALID', async () => {
    await enqueue(CUSTOMER, 'PAYMENT_CONFIRMED');
    await seedCustomerAccount(admin, OTHER_CUSTOMER, 'NONE');
    await session(CUSTOMER);
    const row = (await admin.query<{ id: string; device_id: string }>('SELECT id, device_id FROM identity.session WHERE account_id = $1', [CUSTOMER])).rows[0];
    const call = async (account: string): Promise<string> => {
      const client = new Client({ connectionString: db.getConnectionUri() });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE app_rw');
        await client.query('SELECT * FROM notifications.list_customer_feed($1, $2, $3, NULL)', [account, row?.device_id, row?.id]);
        return 'accepted';
      } catch (error: unknown) {
        return (error as { message?: string }).message ?? '';
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        await client.end();
      }
    };
    expect(await call(CUSTOMER)).toBe('accepted');
    expect(await call(OTHER_CUSTOMER)).toMatch(/^IDENTITY_SESSION_INVALID/);
    await admin.query('UPDATE identity.session SET revoked_at = now() WHERE id = $1', [row?.id]);
    expect(await call(CUSTOMER)).toMatch(/^IDENTITY_SESSION_INVALID/);
  });
});

