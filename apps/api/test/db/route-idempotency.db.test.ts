import 'reflect-metadata';
import { createHash, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { createDatabase, type Database } from '../../src/http/database';
import { hashPin, issueSessionTokens } from '../../src/modules/identity/domain';
import { sessionCookieValue } from '../../src/modules/identity/session.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { seedCustomerAccount } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { createStaffWithKey, loginOverHttp, STAFF_RP_TEST, staffCookie } from './staff-fixture';

/**
 * Lot 24 / INT-IDEM-001 : chaque route d'écriture déclarée exige l'en-tête
 * Idempotency-Key, vérifiée avec un corps VALIDE (sinon un refus du corps
 * masquerait l'absence de contrôle). La liste des cas doit couvrir toutes les
 * routes POST déclarées : une route ajoutée sans cas fait échouer le test.
 */
const ORIGIN = 'https://app.example.test';
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const ACCOUNT = '019aa400-0000-7000-8000-0000000000c1';
const GOAL = '019aa400-0000-7000-8000-0000000000a1';
const OFFER = '019aa400-0000-7000-8000-0000000000f1';
const PEPPER = randomBytes(32);
const PIN = '284917';
const SIGNATURE = Buffer.alloc(64, 1).toString('base64');

/** Chemin déclaré (paramètres remplacés) → corps valide. */
const CASES: Readonly<Record<string, object | undefined>> = {
  '/v1/goals': { model: 'SAVE_THEN_BUY', offerId: OFFER, planId: 'plan-a', durationMonths: 3, acceptTermsVersion: '2026-10-26-v1' },
  [`/v1/offers/${OFFER}/quotes`]: { planId: 'plan-a', durationMonths: 3 },
  '/v1/auth/signouts': undefined,
  '/v1/me/security/block': { reason: 'LOST_OR_STOLEN' },
  '/v1/me/security/revoke-other-sessions': undefined,
  '/v1/me/data-rights': { kind: 'ACCESS' },
  [`/v1/goals/${GOAL}/activation`]: { pin: PIN, signature: SIGNATURE },
  [`/v1/goals/${GOAL}/cancellation`]: { pin: PIN, signature: SIGNATURE },
  [`/v1/goals/${GOAL}/lock`]: { pin: PIN },
  [`/v1/goals/${GOAL}/beneficiary-documents`]: { kind: 'LEASE', sha256: 'a'.repeat(64) },
  [`/v1/goals/${GOAL}/beneficiary-payment`]: { pin: PIN },
};

/** Routes du back-office : session du personnel (D62) au lieu de la session client. */
const STAFF_CASES: Readonly<Record<string, object>> = {
  '/v1/backoffice/refunds': { agreementId: GOAL, kind: 'CANCELLATION' },
  [`/v1/backoffice/refunds/${GOAL}/decision`]: { decision: 'APPROVED' },
  [`/v1/backoffice/refunds/${GOAL}/instruction`]: {},
  [`/v1/backoffice/refunds/${GOAL}/execution`]: { outcome: 'EXECUTED', bankReference: 'ETAB-1' },
  '/v1/backoffice/beneficiary-payouts': { agreementId: GOAL },
  [`/v1/backoffice/beneficiary-payouts/${GOAL}/decision`]: { decision: 'APPROVED' },
  [`/v1/backoffice/beneficiary-payouts/${GOAL}/instruction`]: {},
  [`/v1/backoffice/beneficiary-payouts/${GOAL}/execution`]: { outcome: 'EXECUTED', bankReference: 'ETAB-1' },
  [`/v1/backoffice/reconciliation/incidents/${GOAL}/classifications`]: { classification: 'FEES', explanation: 'frais' },
  [`/v1/backoffice/reconciliation/classifications/${GOAL}/decision`]: { decision: 'APPROVED' },
  [`/v1/backoffice/reconciliation/suspense/${GOAL}/justification`]: { explanation: 'versement non identifié' },
  [`/v1/backoffice/reconciliation/suspense/${GOAL}/approval`]: {},
  [`/v1/backoffice/risk/alerts/${GOAL}/decision`]: { decision: 'DISMISSED', reason: 'faux positif' },
  [`/v1/backoffice/complaints/${GOAL}/disputes`]: {},
  [`/v1/backoffice/disputes/${GOAL}/resolution`]: {},
  [`/v1/backoffice/complaints/${GOAL}/closure`]: { outcome: 'ANSWERED' },
};

/** Routes de connexion du personnel : sans session, corps valide (D62). */
const STAFF_LOGIN_CASES: Readonly<Record<string, object>> = {
  '/v1/staff/login-challenges': { login: 'fin.idem' },
  '/v1/staff/sessions': {
    challengeId: GOAL,
    credentialId: 'AAAA',
    clientDataJSON: 'AAAA',
    authenticatorData: 'AAAA',
    signature: 'AAAA',
  },
};

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;

async function session(accountId: string): Promise<{ cookie: string; privateKey: KeyObject }> {
  const device = uuidv7();
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  await admin.query(
    `INSERT INTO identity.device(id, account_id, public_key_pem, fingerprint, name, status, registered_at)
     VALUES ($1, $2, $3, $4, 'Appareil test', 'ACTIVE', now())`,
    [
      device,
      accountId,
      publicKey.export({ type: 'spki', format: 'pem' }),
      createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest(),
    ],
  );
  const sessionId = uuidv7();
  const token = issueSessionTokens();
  await admin.query(
    `INSERT INTO identity.session(id, account_id, device_id, access_token_hash, refresh_token_hash,
       access_issued_at, access_expires_at, refresh_expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, now() - interval '5 minutes', now() + interval '10 minutes',
       now() + interval '1 day', now() - interval '5 minutes')`,
    [sessionId, accountId, device, token.accessTokenHash, token.refreshTokenHash],
  );
  await admin.query(
    `INSERT INTO identity.pin_credential (device_id, account_id, pin_hash, lockouts, locked_until, updated_at)
     VALUES ($1, $2, $3, 0, NULL, now())`,
    [device, accountId, await hashPin(PIN, PEPPER)],
  );
  return { cookie: `client_session=${sessionCookieValue(sessionId, token.accessToken)}`, privateKey };
}

function declaredPostRoutes(): string[] {
  const controllers = AppModule.register({ database, allowedOrigins: new Set([ORIGIN]) }).controllers ?? [];
  const paths: string[] = [];
  for (const controller of controllers) {
    const base = (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? '';
    const prototype = controller.prototype as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[key];
      if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) !== 1) {
        continue;
      }
      const path = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? '';
      const joined = `/${[base, path].filter((part) => part !== '' && part !== '/').join('/')}`.replace(/\/+/g, '/');
      paths.push(joined.replace(':offerId', OFFER).replace(':goalId', GOAL).replace(':refundId', GOAL).replace(':payoutId', GOAL).replace(/:[A-Za-z]+Id/g, GOAL));
    }
  }
  return paths.sort();
}

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  for (const schema of SCHEMAS) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const name of readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(resolve(DIRECTORY, name), 'utf8'));
  }
  await seedCustomerAccount(admin, ACCOUNT, 'STRONG');
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ database, allowedOrigins: new Set([ORIGIN, ...STAFF_RP_TEST.origins]), pinPepper: PEPPER, staffRp: STAFF_RP_TEST, platformSigningKey: { key: generateKeyPairSync('ed25519').privateKey, keyId: 'k1' } })],
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

describe('Lot 24 / INT-IDEM-001 Idempotency-Key exigée sur chaque route d’écriture', () => {
  it('les cas couvrent exactement les routes POST déclarées', () => {
    expect(declaredPostRoutes()).toEqual([...Object.keys(CASES), ...Object.keys(STAFF_CASES), ...Object.keys(STAFF_LOGIN_CASES)].sort());
  });

  it('corps valide, session et Origin valides, sans clé : 400 REQUEST_INVALID pour la clé, sur chaque route', async () => {
    const server = app.getHttpServer() as Server;
    const failures: string[] = [];
    for (const [path, body] of Object.entries(CASES)) {
      // Session neuve par route : une déconnexion ou un blocage ne fausse pas les suivantes.
      const { cookie } = await session(ACCOUNT);
      const call = request(server).post(path).set('Cookie', cookie).set('Origin', ORIGIN);
      const response = await (body === undefined ? call : call.send(body));
      const problem = response.body as { code?: string; detail?: string };
      if (response.status !== 400 || problem.code !== 'REQUEST_INVALID' || !(problem.detail ?? '').includes('Idempotency-Key')) {
        failures.push(`${path} → ${response.status} ${problem.code ?? ''} ${problem.detail ?? ''}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('routes du back-office : session du personnel et Origin valides, sans clé : 400 REQUEST_INVALID pour la clé', async () => {
    const server = app.getHttpServer() as Server;
    const { key } = await createStaffWithKey(db.getConnectionUri(), { login: 'fin.idem', roles: ['FINANCE'], maxAmountXaf: 1_000_000n });
    const cookie = staffCookie(await loginOverHttp(server, 'fin.idem', key, 1));
    const failures: string[] = [];
    for (const [path, body] of [...Object.entries(STAFF_CASES), ...Object.entries(STAFF_LOGIN_CASES)]) {
      const response = await request(server).post(path).set('Cookie', cookie).set('Origin', [...STAFF_RP_TEST.origins][0] ?? '').send(body);
      const problem = response.body as { code?: string; detail?: string };
      if (response.status !== 400 || problem.code !== 'REQUEST_INVALID' || !(problem.detail ?? '').includes('Idempotency-Key')) {
        failures.push(`${path} → ${response.status} ${problem.code ?? ''} ${problem.detail ?? ''}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
