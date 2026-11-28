import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { createDatabase, type Database } from '../../src/http/database';
import { publishSetting } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

/** SEC-MOB-005 : minimum publié à deux personnes, appliqué à toutes les routes par la garde globale. */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  for (const schema of SCHEMAS) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  for (const file of readdirSync(DIRECTORY).filter((name) => name.endsWith('.sql')).sort()) await admin.query(readFileSync(resolve(DIRECTORY, file), 'utf8'));
  await publishSetting(admin, 'client_min_versions', { mobile: '0.2.0' });
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set(['https://app.molopay.test']) })] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
}, 300_000);

afterAll(async () => {
  await app.close();
  await database.pool.end();
  await admin.end();
  await db.stop();
});

function offers(version?: string): request.Test {
  const call = request(app.getHttpServer() as Server).get('/v1/offers');
  return version === undefined ? call : call.set('X-Client-Version', version);
}

describe('SEC-MOB-005 version minimale de l’application', () => {
  it('application trop ancienne : 426 CLIENT_UPGRADE_REQUIRED (problème RFC 9457) ; à jour, navigateur ou autre plateforme : servis', async () => {
    const old = await offers('mobile/0.1.9');
    expect(old.status).toBe(426);
    expect(old.headers['content-type']).toContain('application/problem+json');
    expect(old.body).toMatchObject({ status: 426, code: 'CLIENT_UPGRADE_REQUIRED' });
    expect((await offers('mobile/0.2.0')).status).toBe(200);
    expect((await offers('mobile/1.0.0')).status).toBe(200);
    expect((await offers()).status).toBe(200);
    expect((await offers('desktop/0.0.1')).status).toBe(200);
    expect((await offers('mobile/abc')).body).toMatchObject({ status: 400, code: 'REQUEST_INVALID' });
  });
});
