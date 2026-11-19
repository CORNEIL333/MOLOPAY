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

/** C2 / contrat 1.0 : profil du client connecté (`GET /v1/me`) en HTTP réel, sans niveau KYC (D77) ni numéro en clair. */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const ORIGIN = 'https://app.molopay.test';
const CUSTOMER = '019ab800-0000-7000-8000-0000000000c1';
const OTHER_CUSTOMER = '019ab800-0000-7000-8000-0000000000c2';


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

function me(cookie: string | null): request.Test {
  const call = request(server()).get('/v1/me').set('Origin', ORIGIN);
  return cookie === null ? call : call.set('Cookie', cookie);
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
});

describe('C2 profil du client connecté (GET /v1/me)', () => {
  it('profil minimal, privé : identifiant, numéro masqué, date d’inscription, nom déclaré ou non ; jamais le numéro en clair ni le niveau KYC', async () => {
    const phone = (await admin.query<{ phone: string; created: string }>(`SELECT phone, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created FROM identity.account WHERE id = $1`, [CUSTOMER])).rows[0];
    const response = await me(await session(CUSTOMER));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const digits = (phone?.phone ?? '').slice(1);
    expect(response.body).toEqual({
      accountId: CUSTOMER,
      phoneMasked: `+${digits.slice(0, 3)}${'•'.repeat(digits.length - 5)}${digits.slice(-2)}`,
      memberSince: phone?.created,
      legalNameDeclared: false,
    });
    expect(JSON.stringify(response.body)).not.toContain(digits.slice(3, -2));
    expect(JSON.stringify(response.body)).not.toMatch(/kyc|level|BASIC|NONE/i);
  });

  it('nom légal déclaré : seul le fait est indiqué (ni le nom ni le résultat du filtrage) ; niveau BASIC jamais montré (D77)', async () => {
    await admin.query(`INSERT INTO identity.legal_name_declaration (id, account_id, legal_name, declared_at) VALUES ($1, $2, 'Aïcha Ngono', now())`, [uuidv7(), CUSTOMER]);
    await admin.query(`UPDATE identity.account SET kyc_level = 'BASIC' WHERE id = $1`, [CUSTOMER]);
    const response = await me(await session(CUSTOMER));
    expect(response.body).toMatchObject({ accountId: CUSTOMER, legalNameDeclared: true });
    expect(JSON.stringify(response.body)).not.toMatch(/Aïcha|Ngono|BASIC/);
  });

  it('chaque client ne voit que son profil ; sans session : 401 IDENTITY_SESSION_INVALID', async () => {
    await seedCustomerAccount(admin, OTHER_CUSTOMER, 'NONE');
    expect(((await me(await session(OTHER_CUSTOMER))).body as { accountId?: string }).accountId).toBe(OTHER_CUSTOMER);
    expect(problem(await me(null))).toEqual([401, 'IDENTITY_SESSION_INVALID']);
  });
});
