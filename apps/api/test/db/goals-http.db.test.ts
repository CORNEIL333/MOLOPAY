import 'reflect-metadata';
import { createHash, generateKeyPairSync } from 'node:crypto';
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
import { issueSessionTokens } from '../../src/modules/identity/domain';
import { sessionCookieValue } from '../../src/modules/identity/session.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
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
  'db/migrations/0017_api_idempotency.sql',
  'db/migrations/0022_catalog_public_presentation.sql',
  'db/migrations/0023_identity_account_security.sql',
].map((path) => resolve(process.cwd(), path));

type Goal = components['schemas']['Goal'];
type GoalList = components['schemas']['GoalList'];
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

function server(): Server {
  return app.getHttpServer() as Server;
}

function post(body: unknown, key: string, cookie = cookies.A): request.Test {
  return request(server()).post('/v1/goals').set('Cookie', cookie).set('Origin', ORIGIN).set('Idempotency-Key', key).send(body as object);
}

const GOAL_A = { model: 'SAVE_THEN_BUY', offerId: OFFER_ID, planId: PLAN_A.planId, durationMonths: 3, acceptTermsVersion: TERMS };
const GOAL_C = {
  model: 'PLANNED_EXPENSE',
  beneficiaryId: 'landlord-1',
  targetXaf: '300000',
  planId: PLAN_C.planId,
  durationMonths: 4,
  acceptTermsVersion: TERMS,
};

async function session(accountId: string): Promise<string> {
  const device = uuidv7();
  const publicKey = generateKeyPairSync('ed25519').publicKey;
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
  return `client_session=${sessionCookieValue(sessionId, token.accessToken)}`;
}

beforeAll(async () => {
  migrationSql = await Promise.all(MIGRATIONS.map((path) => readFile(path, 'utf8')));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ database, allowedOrigins: new Set([ORIGIN]) })],
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
  cookies = { A: await session(A), B: await session(B) };
});

describe('D32 objectifs : authentification et lecture', () => {
  it('SEC-AUTHZ-001 sans session : 401', async () => {
    const response = await request(server()).get('/v1/goals');
    expect(response.status).toBe(401);
  });

  it('liste vide pour un nouveau client', async () => {
    const response = await request(server()).get('/v1/goals').set('Cookie', cookies.A);
    expect(response.status).toBe(200);
    expect((response.body as GoalList).goals).toEqual([]);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
});

describe('D32 création d’un brouillon', () => {
  it('modèle A : brouillon au prix figé de l’offre (I-11), durée en mois, rien de versé', async () => {
    const response = await post(GOAL_A, 'goal-create-a-0001');
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      model: 'SAVE_THEN_BUY',
      status: 'DRAFT',
      locked: false,
      offerId: OFFER_ID,
      beneficiaryId: null,
      planId: 'plan-a',
      rhythm: 'WEEKLY',
      minAmountXaf: '5000',
      durationMonths: 3,
      targetXaf: '150000',
      savedXaf: '0',
      progressBasisPoints: 0,
    });
    const listed = await request(server()).get('/v1/goals').set('Cookie', cookies.A);
    expect((listed.body as GoalList).goals.map((g) => g.goalId)).toEqual([(response.body as Goal).goalId]);
    const goalId = (response.body as Goal).goalId;
    const one = await request(server()).get(`/v1/goals/${goalId}`).set('Cookie', cookies.A);
    expect(one.status).toBe(200);
    expect((one.body as Goal).goalId).toBe(goalId);
  });

  it('modèle C : brouillon vers un bénéficiaire vérifié, cible choisie', async () => {
    const response = await post(GOAL_C, 'goal-create-c-0001');
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      model: 'PLANNED_EXPENSE',
      status: 'DRAFT',
      offerId: null,
      offerTitle: null,
      partnerName: null,
      beneficiaryId: 'landlord-1',
      targetXaf: '300000',
    });
  });

  it('I-5 un rejeu de la même clé renvoie le même brouillon, sans en créer un second', async () => {
    const first = await post(GOAL_A, 'goal-replay-0000001');
    const again = await post(GOAL_A, 'goal-replay-0000001');
    expect(again.status).toBe(201);
    expect((again.body as Goal).goalId).toBe((first.body as Goal).goalId);
    const count = await admin.query('SELECT count(*)::int AS n FROM agreements.agreement');
    expect(count.rows[0]).toEqual({ n: 1 });
  });

  it.each([
    ['un champ hors liste blanche (ancien quoteId)', { ...GOAL_A, quoteId: uuidv7() }],
    ['une cible fournie pour le modèle A', { ...GOAL_A, targetXaf: '1' }],
    ['une offre fournie pour le modèle C', { ...GOAL_C, offerId: OFFER_ID }],
    ['le modèle B (fermé, D26)', { ...GOAL_A, model: 'FINANCED_PURCHASE' }],
    ['une version de conditions non courante', { ...GOAL_A, acceptTermsVersion: '2020-01-01-v0' }],
  ])('refuse %s (400 AGREEMENT_INVALID_REQUEST)', async (_label, body) => {
    const response = await post(body, `goal-invalid-${Math.random().toString(36).slice(2, 12)}`);
    expect(response.status).toBe(400);
    expect((response.body as ProblemBody).code).toBe('AGREEMENT_INVALID_REQUEST');
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it.each([
    ['un plan absent du registre', { ...GOAL_A, planId: 'plan-inconnu' }],
    ['une durée au-delà du plan', { ...GOAL_A, durationMonths: 7 }],
  ])('refuse %s (422 AGREEMENT_PLAN_MISMATCH)', async (_label, body) => {
    const response = await post(body, `goal-plan-${Math.random().toString(36).slice(2, 12)}`);
    expect(response.status).toBe(422);
    expect((response.body as ProblemBody).code).toBe('AGREEMENT_PLAN_MISMATCH');
  });

  it('exige une clé d’idempotence sur l’écriture', async () => {
    const response = await request(server()).post('/v1/goals').set('Cookie', cookies.A).set('Origin', ORIGIN).send(GOAL_A);
    expect(response.status).toBe(400);
  });
});

describe('D32 isolement et données dérivées', () => {
  it('l’objectif d’un autre client est introuvable (404, aucune fuite)', async () => {
    const created = await post(GOAL_A, 'goal-owner-0000001');
    const response = await request(server()).get(`/v1/goals/${(created.body as Goal).goalId}`).set('Cookie', cookies.B);
    expect(response.status).toBe(404);
    expect((response.body as ProblemBody).code).toBe('AGREEMENT_NOT_FOUND');
    const list = await request(server()).get('/v1/goals').set('Cookie', cookies.B);
    expect((list.body as GoalList).goals).toEqual([]);
  });

  it('I-9 versé et progression dérivés du grand livre après un versement confirmé', async () => {
    const created = await post(GOAL_A, 'goal-funds-0000001');
    const goalId = (created.body as Goal).goalId;
    await admin.query(
      `INSERT INTO agreements.status_event
         (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
       VALUES ($1, 1, 'TRANSITION', 'DRAFT', 'ACTIVE', $2, $3, 'client-1', now())`,
      [goalId, uuidv7(), Buffer.alloc(64, 9)],
    );
    const attemptId = uuidv7();
    const client = new Client({ connectionString: db.getConnectionUri() });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_rw');
      await createStoredPaymentAttempt(client, { id: attemptId, agreementId: goalId, channel: 'MTN_MOMO', amountXaf: 37_500n, idemKey: uuidv7() });
      await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
      await confirmPaymentAndFundAgreement(client, {
        attemptId,
        customerId: A,
        providerTransaction: { providerTxId: 'tx-goal-http-1', attemptId, amountXaf: 37_500n, outcome: 'SUCCEEDED' },
        actorId: 'payments-worker',
      });
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
    const one = await request(server()).get(`/v1/goals/${goalId}`).set('Cookie', cookies.A);
    expect(one.body).toMatchObject({ status: 'ACTIVE', savedXaf: '37500', progressBasisPoints: 2500 });
  });
});
