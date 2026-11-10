import 'reflect-metadata';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '@achat/contracts/api';
import { AppModule } from '../../src/app.module';
import { createDatabase, type Database } from '../../src/http/database';
import { hashPin, issueSessionTokens } from '../../src/modules/identity/domain';
import { sessionCookieValue } from '../../src/modules/identity/session.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import {
  AGREEMENT_STACK_MIGRATIONS,
  AGREEMENT_STACK_SCHEMAS,
  PLAN_A,
  PLAN_C,
  publishKycLimits,
  publishOfferA,
  seedCustomerAccount,
  seedLedgerGenesis,
  seedPaymentPlan,
  validateLandlord,
  validateMerchant,
} from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  ...AGREEMENT_STACK_MIGRATIONS,
  'db/migrations/0007_identity_clock.sql',
  'db/migrations/0016_identity_pin_guard.sql',
  'db/migrations/0017_api_idempotency.sql',
  'db/migrations/0022_catalog_public_presentation.sql',
  'db/migrations/0023_identity_account_security.sql',
].map((path) => resolve(process.cwd(), path));

type Goal = components['schemas']['Goal'];
type ProblemBody = { readonly code: string };

const ORIGIN = 'https://app.example.test';
const A = '019a9a00-0000-7000-8000-0000000000c1';
const B = '019a9a00-0000-7000-8000-0000000000c2';
const OFFER_ID = '019a9a00-0000-7000-8000-0000000000f1';
const TERMS = '2026-10-26-v1';

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrationSql: string[];
let cookies: Record<'A' | 'B', string>;
let deviceKeys: Record<'A' | 'B', KeyObject>;
const PEPPER = randomBytes(32);
const PIN = '284917';

function server(): Server {
  return app.getHttpServer() as Server;
}

function post(body: unknown, key: string, cookie = cookies.A): request.Test {
  return request(server()).post('/v1/goals').set('Cookie', cookie).set('Origin', ORIGIN).set('Idempotency-Key', key).send(body as object);
}

const GOAL_A = { model: 'SAVE_THEN_BUY', offerId: OFFER_ID, planId: PLAN_A.planId, durationMonths: 3, acceptTermsVersion: TERMS };

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

beforeAll(async () => {
  migrationSql = await Promise.all(MIGRATIONS.map((path) => readFile(path, 'utf8')));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ database, allowedOrigins: new Set([ORIGIN]), pinPepper: PEPPER })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
}, 120_000);

afterAll(async () => {
  await app.close();
  await database.pool.end();
  await admin.end();
  await db.stop();
});

beforeEach(async () => {
  for (const schema of ['api', ...AGREEMENT_STACK_SCHEMAS]) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
  await admin.query('BEGIN');
  await validateMerchant(admin, uuidv7());
  await validateLandlord(admin, uuidv7());
  await seedPaymentPlan(admin, PLAN_A);
  await seedPaymentPlan(admin, PLAN_C);
  await publishOfferA(admin, { offerId: OFFER_ID, partnerId: 'merchant-1', priceXaf: 150_000n });
  await admin.query('COMMIT');
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, A, 'STRONG');
  await seedCustomerAccount(admin, B, 'STRONG');
  await publishKycLimits(admin);
  const a = await session(A);
  const b = await session(B);
  cookies = { A: a.cookie, B: b.cookie };
  deviceKeys = { A: a.privateKey, B: b.privateKey };
});

type SigningPayload = components['schemas']['GoalSigningPayload'];

async function draft(): Promise<string> {
  const response = await post(GOAL_A, `goal-sign-draft-${Math.random().toString(36).slice(2, 12)}`);
  expect(response.status).toBe(201);
  return (response.body as Goal).goalId;
}

async function signedBody(
  goalId: string,
  transition: 'ACTIVATE' | 'CANCEL',
  key: KeyObject = deviceKeys.A,
  cookie = cookies.A,
): Promise<{ readonly pin: string; readonly signature: string }> {
  const payload = await request(server()).get(`/v1/goals/${goalId}/signing-payload?transition=${transition}`).set('Cookie', cookie);
  expect(payload.status).toBe(200);
  const bytes = Buffer.from((payload.body as SigningPayload).payloadBase64, 'base64');
  return { pin: PIN, signature: sign(null, bytes, key).toString('base64') };
}

function act(goalId: string, action: 'activation' | 'cancellation' | 'lock', body: unknown, key: string, cookie = cookies.A): request.Test {
  return request(server())
    .post(`/v1/goals/${goalId}/${action}`)
    .set('Cookie', cookie)
    .set('Origin', ORIGIN)
    .set('Idempotency-Key', key)
    .send(body as object);
}

async function eventCount(goalId: string): Promise<number> {
  const result = await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM agreements.status_event WHERE agreement_id = $1', [goalId]);
  return result.rows[0]?.n ?? -1;
}

describe('D32 tranche 2 · INT-NR-001 / SEC-AUTH-002 activation signée sous PIN', () => {
  it('active un brouillon avec la signature de l’appareil de la session et le bon PIN', async () => {
    const goalId = await draft();
    const response = await act(goalId, 'activation', await signedBody(goalId, 'ACTIVATE'), 'goal-activate-000001');
    expect(response.status).toBe(200);
    expect((response.body as Goal).status).toBe('ACTIVE');
  });

  it('I-5 un rejeu de l’activation n’ajoute aucun événement', async () => {
    const goalId = await draft();
    const body = await signedBody(goalId, 'ACTIVATE');
    await act(goalId, 'activation', body, 'goal-activate-replay1');
    const again = await act(goalId, 'activation', body, 'goal-activate-replay1');
    expect(again.status).toBe(200);
    expect(await eventCount(goalId)).toBe(1);
  });

  it('refuse un mauvais PIN, compte l’échec et laisse le brouillon intact (IDENTITY_PIN_INVALID)', async () => {
    const goalId = await draft();
    const body = { ...(await signedBody(goalId, 'ACTIVATE')), pin: '000000' };
    const response = await act(goalId, 'activation', body, 'goal-activate-badpin');
    expect((response.body as ProblemBody).code).toBe('IDENTITY_PIN_INVALID');
    const failed = await admin.query<{ failed_attempts: number }>('SELECT failed_attempts FROM identity.pin_credential WHERE account_id = $1', [A]);
    expect(failed.rows[0]?.failed_attempts).toBe(1);
    expect(await eventCount(goalId)).toBe(0);
  });

  it('refuse une signature d’une autre clé (AGREEMENT_SIGNATURE_INVALID), brouillon intact', async () => {
    const goalId = await draft();
    const forged = await signedBody(goalId, 'ACTIVATE', generateKeyPairSync('ed25519').privateKey);
    const response = await act(goalId, 'activation', forged, 'goal-activate-forged');
    expect((response.body as ProblemBody).code).toBe('AGREEMENT_SIGNATURE_INVALID');
    expect(await eventCount(goalId)).toBe(0);
  });

  it('refuse une signature rejouée sur une autre transition (rang de séquence)', async () => {
    const goalId = await draft();
    const activation = await signedBody(goalId, 'ACTIVATE');
    await act(goalId, 'activation', activation, 'goal-activate-seq0001');
    const reused = await act(goalId, 'cancellation', activation, 'goal-cancel-reuse0001');
    expect((reused.body as ProblemBody).code).toBe('AGREEMENT_SIGNATURE_INVALID');
  });

  it('l’objectif d’un autre client est introuvable, même avec un PIN valide (404)', async () => {
    const goalId = await draft();
    const payload = await request(server()).get(`/v1/goals/${goalId}/signing-payload?transition=ACTIVATE`).set('Cookie', cookies.B);
    expect(payload.status).toBe(404);
    const response = await act(goalId, 'activation', { pin: PIN, signature: 'AAAA' }, 'goal-activate-other1', cookies.B);
    expect(response.status).toBe(404);
  });

  it('refuse un champ hors liste blanche dans le corps (400)', async () => {
    const goalId = await draft();
    const response = await act(goalId, 'activation', { ...(await signedBody(goalId, 'ACTIVATE')), deviceId: uuidv7() }, 'goal-activate-extra1');
    expect(response.status).toBe(400);
  });
});

describe('D32 tranche 2 · annulation et verrouillage', () => {
  async function active(): Promise<string> {
    const goalId = await draft();
    await act(goalId, 'activation', await signedBody(goalId, 'ACTIVATE'), `goal-activate-${goalId.slice(-12)}`);
    return goalId;
  }

  it('F-SAV-005 annule un objectif actif non verrouillé (signature + PIN)', async () => {
    const goalId = await active();
    const response = await act(goalId, 'cancellation', await signedBody(goalId, 'CANCEL'), 'goal-cancel-0000001');
    expect(response.status).toBe(200);
    expect((response.body as Goal).status).toBe('CANCELLED_BY_CUSTOMER');
  });

  it('F-SAV-003 verrouille sous PIN, puis refuse l’annulation (AGREEMENT_LOCKED)', async () => {
    const goalId = await active();
    const locked = await act(goalId, 'lock', { pin: PIN }, 'goal-lock-000000001');
    expect(locked.status).toBe(200);
    expect((locked.body as Goal).locked).toBe(true);
    const cancel = await act(goalId, 'cancellation', await signedBody(goalId, 'CANCEL'), 'goal-cancel-locked1');
    expect(cancel.status).toBe(409);
    expect((cancel.body as ProblemBody).code).toBe('AGREEMENT_LOCKED');
  });
});

describe('D32 tranche 2 · fermé par défaut', () => {
  it('sans poivre PIN configuré, les actions sous PIN répondent 503 (PIN_UNCONFIGURED)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register({ database, allowedOrigins: new Set([ORIGIN]) })],
    }).compile();
    const closed = moduleRef.createNestApplication({ logger: false });
    await closed.init();
    try {
      const goalId = await draft();
      const response = await request(closed.getHttpServer() as Server)
        .post(`/v1/goals/${goalId}/lock`)
        .set('Cookie', cookies.A)
        .set('Origin', ORIGIN)
        .set('Idempotency-Key', 'goal-lock-unconfigured')
        .send({ pin: PIN });
      expect(response.status).toBe(503);
      expect((response.body as ProblemBody).code).toBe('PIN_UNCONFIGURED');
    } finally {
      await closed.close();
    }
  });
});
