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
import { createDatabase, withTransaction, type Database } from '../../src/http/database';
import { issueSessionTokens } from '../../src/modules/identity/domain';
import { sessionCookieValue } from '../../src/modules/identity/session.store';
import { importUnSanctionsList } from '../../src/modules/kyc/sanctions.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { seedCustomerAccount } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

/** REG-LBC-001 / D68 : déclaration du nom légal par le client en HTTP réel ; aucune alerte du client (LBC). */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const EXCERPT = readFileSync(resolve(process.cwd(), 'apps/api/src/modules/kyc/fixtures/un-consolidated-excerpt.xml'), 'utf8');
const ORIGIN = 'https://app.molopay.test';
const CUSTOMER = '019ab600-0000-7000-8000-0000000000c1';
const OTHER_CUSTOMER = '019ab600-0000-7000-8000-0000000000c2';


/** Statut et code métier d'une réponse d'erreur (règle 8 : un refus vérifie le code exact). */
function problem(response: { readonly status: number; readonly body: unknown }): [number, string | undefined] {
  return [response.status, (response.body as { code?: string }).code];
}
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

function declare(cookie: string | null, body: object): request.Test {
  const call = request(server()).post('/v1/me/legal-name').set('Origin', ORIGIN).set('Idempotency-Key', `ln-${uuidv7()}`);
  return (cookie === null ? call : call.set('Cookie', cookie)).send(body);
}

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
  await withTransaction(database, (client) => importUnSanctionsList(client, { versionId: uuidv7(), xml: EXCERPT, sourceUrl: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml', actorId: 'comp-1' }));
});

describe('REG-LBC-001 / D68 nom légal du client', () => {
  it('nom sans rapprochement : niveau 1 accordé en base ; réponse privée, neutre, sans le nom', async () => {
    const response = await declare(await session(CUSTOMER), { legalName: 'Aïcha Ngono Mballa' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual({ verification: 'RECEIVED' });
    expect((await admin.query('SELECT kyc_level FROM identity.account WHERE id = $1', [CUSTOMER])).rows[0]).toEqual({ kyc_level: 'BASIC' });
  });

  it('B-1 rapprochement : réponse identique octet pour octet à celle d’un nom sans rapprochement (aucune alerte du client)', async () => {
    const clean = await declare(await session(CUSTOMER), { legalName: 'Aïcha Ngono Mballa' });
    await seedCustomerAccount(admin, OTHER_CUSTOMER, 'NONE');
    const matched = await declare(await session(OTHER_CUSTOMER), { legalName: 'Eric Badege' });
    expect(matched.status).toBe(clean.status);
    expect(matched.text).toBe(clean.text);
    expect(matched.headers['cache-control']).toBe(clean.headers['cache-control']);
    expect(matched.headers['content-type']).toBe(clean.headers['content-type']);
    expect((await admin.query('SELECT kyc_level FROM identity.account WHERE id = $1', [OTHER_CUSTOMER])).rows[0]).toEqual({ kyc_level: 'NONE' });
  });

  it('corps en liste blanche, nom invalide, sans session : refus', async () => {
    const cookie = await session(CUSTOMER);
    expect(problem(await declare(cookie, { legalName: 'Aïcha Ngono', kycLevel: 'STRONG' }))).toEqual([400, 'REQUEST_INVALID']);
    expect(problem(await declare(cookie, { legalName: 'A' }))).toEqual([400, 'KYC_INVALID_REQUEST']);
    expect(problem(await declare(null, { legalName: 'Aïcha Ngono' }))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
    expect((await admin.query('SELECT count(*)::int AS n FROM identity.legal_name_declaration')).rows[0]).toEqual({ n: 0 });
  });
});
