import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { Controller, Get, type INestApplication, Post, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { createDatabase, type Database } from '../../src/http/database';
import {
  CurrentCustomer,
  CustomerSessionGuard,
  readSessionCookie,
} from '../../src/http/session.guard';
import { issueSessionTokens } from '../../src/modules/identity/domain';
import {
  sessionCookieValue,
  type AuthenticatedCustomer,
} from '../../src/modules/identity/session.store';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  'db/migrations/0002_audit.sql',
  'db/migrations/0004_identity.sql',
  'db/migrations/0005_audit_metadata.sql',
  'db/migrations/0007_identity_clock.sql',
].map((path) => resolve(process.cwd(), path));

const ORIGIN = 'https://app.example.test';
const ACCOUNT_ID = '019a9200-0000-7000-8000-0000000000a1';
const DEVICE_ID = '019a9200-0000-7000-8000-0000000000d1';
const SESSION_ID = '019a9200-0000-7000-8000-0000000000e1';
const PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAdGVzdA==\n-----END PUBLIC KEY-----\n';

/** Sonde enregistrée uniquement dans ce test pour exercer le vrai garde. */
@Controller('probe')
class ProbeController {
  @Get('me')
  @UseGuards(CustomerSessionGuard)
  public me(@CurrentCustomer() customer: AuthenticatedCustomer): AuthenticatedCustomer {
    return customer;
  }

  @Post('write')
  @UseGuards(CustomerSessionGuard)
  public write(): { ok: true } {
    return { ok: true };
  }

  @Get('boom')
  public boom(): never {
    throw new Error('détail interne SELECT * FROM secret');
  }
}

let container: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrationSql: string[];
let cookie = '';

function codeOf(response: { body: unknown }): unknown {
  return (response.body as { code?: unknown }).code;
}

function server(): Server {
  return app.getHttpServer() as Server;
}

async function seedSession(options: { readonly revoked?: boolean } = {}): Promise<void> {
  const tokens = issueSessionTokens();
  await admin.query(
    `INSERT INTO identity.account (id, phone, phone_verified_at)
     VALUES ($1, '+237612345678', now())`,
    [ACCOUNT_ID],
  );
  await admin.query(
    `INSERT INTO identity.device
       (id, account_id, public_key_pem, fingerprint, name, status, registered_at)
     VALUES ($1, $2, $3, $4, 'Appareil', 'ACTIVE', now())`,
    [DEVICE_ID, ACCOUNT_ID, PUBLIC_KEY, Buffer.alloc(32, 7)],
  );
  await admin.query(
    `INSERT INTO identity.session
       (id, account_id, device_id, access_token_hash, refresh_token_hash,
        access_issued_at, access_expires_at, refresh_expires_at, created_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5, now(), now() + interval '10 minutes',
             now() + interval '1 day', now(), $6)`,
    [
      SESSION_ID,
      ACCOUNT_ID,
      DEVICE_ID,
      tokens.accessTokenHash,
      tokens.refreshTokenHash,
      options.revoked === true ? new Date(Date.now() + 1000) : null,
    ],
  );
  cookie = `client_session=${sessionCookieValue(SESSION_ID, tokens.accessToken)}`;
}

beforeAll(async () => {
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  migrationSql = await Promise.all(MIGRATIONS.map((path) => readFile(path, 'utf8')));
  database = createDatabase({ connectionString: container.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.register({
        database,
        allowedOrigins: new Set([ORIGIN]),
        extraControllers: [ProbeController],
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
}, 120_000);

afterAll(async () => {
  await app.close();
  await database.pool.end();
  await admin.end();
  await container.stop();
});

beforeEach(async () => {
  await admin.query('DROP SCHEMA IF EXISTS identity CASCADE');
  await admin.query('DROP SCHEMA IF EXISTS audit CASCADE');
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
});

describe('SEC-AUTH · garde de session client (HTTP + PostgreSQL réel)', () => {
  it('SEC-AUTH accepte une session valide et expose le client', async () => {
    await seedSession();
    const response = await request(server()).get('/probe/me').set('Cookie', cookie).expect(200);
    expect(response.body).toEqual({
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
      sessionId: SESSION_ID,
    });
  });

  it.each([
    ['sans cookie', ''],
    ['avec un jeton faux', `client_session=${SESSION_ID}.${'A'.repeat(43)}`],
    ['avec une session inconnue', `client_session=019a9200-0000-7000-8000-0000000000ff.${'A'.repeat(43)}`],
    ['avec un cookie illisible', 'client_session=pas-un-cookie'],
  ])('SEC-AUTH refuse une requête %s → 401 problème RFC 9457', async (_label, value) => {
    await seedSession();
    const response = await request(server()).get('/probe/me').set('Cookie', value).expect(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ status: 401, code: 'IDENTITY_SESSION_INVALID' });
  });

  it('SEC-AUTH refuse un cookie de session dupliqué', async () => {
    await seedSession();
    const response = await request(server())
      .get('/probe/me')
      .set('Cookie', `${cookie}; ${cookie}`)
      .expect(401);
    expect(codeOf(response)).toBe('IDENTITY_SESSION_INVALID');
  });

  it('SEC-AUTH refuse une session révoquée', async () => {
    await seedSession({ revoked: true });
    const response = await request(server()).get('/probe/me').set('Cookie', cookie).expect(401);
    expect(codeOf(response)).toBe('IDENTITY_SESSION_INVALID');
  });

  it('SEC-AUTH refuse un appareil révoqué → 403', async () => {
    await seedSession();
    await admin.query(
      `UPDATE identity.device SET status = 'REVOKED', revoked_at = now() WHERE id = $1`,
      [DEVICE_ID],
    );
    const response = await request(server()).get('/probe/me').set('Cookie', cookie).expect(403);
    expect(codeOf(response)).toBe('IDENTITY_DEVICE_REVOKED');
  });
});

describe('SEC-API · origine et erreurs (HTTP)', () => {
  it('SEC-API refuse une écriture sans en-tête Origin → 403 ORIGIN_FORBIDDEN', async () => {
    await seedSession();
    const response = await request(server()).post('/probe/write').set('Cookie', cookie).expect(403);
    expect(codeOf(response)).toBe('ORIGIN_FORBIDDEN');
  });

  it('SEC-API refuse une origine hors liste blanche', async () => {
    await seedSession();
    const response = await request(server())
      .post('/probe/write')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example.test')
      .expect(403);
    expect(codeOf(response)).toBe('ORIGIN_FORBIDDEN');
  });

  it('SEC-API accepte une écriture de l’origine autorisée avec session', async () => {
    await seedSession();
    await request(server())
      .post('/probe/write')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .expect(201, { ok: true });
  });

  it('SEC-API une erreur interne ne divulgue ni message ni SQL', async () => {
    const response = await request(server()).get('/probe/boom').expect(500);
    expect(response.body).toEqual({
      type: 'urn:achat:problem:internal-error',
      title: 'Erreur interne',
      status: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(response.body)).not.toContain('SELECT');
  });

  it('SEC-API une route inconnue répond 404 en problème RFC 9457', async () => {
    const response = await request(server()).get('/nope').expect(404);
    expect(codeOf(response)).toBe('ROUTE_NOT_FOUND');
  });

  it('readSessionCookie isole la valeur unique', () => {
    expect(readSessionCookie('a=1; client_session=x.y; b=2')).toBe('x.y');
    expect(readSessionCookie('a=1')).toBeUndefined();
    expect(readSessionCookie(undefined)).toBeUndefined();
  });
});
