import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { createDatabase, type Database } from '../../src/http/database';
import { startTestDatabase, type TestDatabase } from './harness';
import { TEST_PII_KEYS } from './pii-fixture';

/**
 * SEC-CRY-001 (HSTS) / SEC-API-005 (en-têtes de sécurité) : chaque réponse de
 * l'API — succès, problème RFC 9457, route inconnue — porte les en-têtes de
 * sécurité, et rien ne trahit le cadriciel (pas de X-Powered-By).
 */
let db: TestDatabase;
let database: Database;
let app: INestApplication;

const EXPECTED: Readonly<Record<string, string>> = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

beforeAll(async () => {
  db = await startTestDatabase();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ database, allowedOrigins: new Set(['https://app.molopay.test']), otpPepper: randomBytes(32), pinPepper: randomBytes(32), smsSender: null, piiKeys: TEST_PII_KEYS })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
}, 300_000);

afterAll(async () => {
  await app.close();
  await database.pool.end();
  await db.stop();
});

describe('SEC-CRY-001 / SEC-API-005 — en-têtes de sécurité sur toute réponse', () => {
  it('succès, route inconnue (404), requête refusée (403 origine) : mêmes en-têtes, aucun X-Powered-By', async () => {
    const server = app.getHttpServer() as Server;
    const responses = [
      await request(server).get('/health'),
      await request(server).get('/v1/route-inexistante'),
      await request(server).post('/v1/auth/otp-challenges').set('Origin', 'https://pirate.example').send({}),
    ];
    expect(responses.map((response) => response.status)).toEqual([200, 404, 403]);
    for (const response of responses) {
      for (const [name, value] of Object.entries(EXPECTED)) expect(response.headers[name], `${response.status} ${name}`).toBe(value);
      expect(response.headers['x-powered-by']).toBeUndefined();
    }
  });
});
