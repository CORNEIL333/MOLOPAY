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
import { appendOfferPresentation } from '../../src/modules/catalog/public-offer.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import {
  createAgreementA,
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
  'db/migrations/0053_agreements_stock_reservation.sql',
].map((path) => resolve(process.cwd(), path));

type Quote = components['schemas']['Quote'];
type PlanList = components['schemas']['PaymentPlanList'];
type ProblemBody = { readonly code: string };

const ORIGIN = 'https://app.example.test';
const A = '019a9a00-0000-7000-8000-0000000000c1';
const B = '019a9a00-0000-7000-8000-0000000000c2';
const OFFER_ID = '019a9a00-0000-7000-8000-0000000000f1';

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrationSql: string[];
let cookies: Record<'A' | 'B', string>;

function server(): Server {
  return app.getHttpServer() as Server;
}



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
  await appendOfferPresentation(admin, { offerId: OFFER_ID, version: 1, title: 'Réfrigérateur 220 L' }, 'net-1');
  await admin.query('COMMIT');
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, A, 'STRONG');
  await seedCustomerAccount(admin, B, 'STRONG');
  await publishKycLimits(admin);
  cookies = { A: await session(A), B: await session(B) };
});

function quote(body: unknown, key: string, cookie = cookies.A): request.Test {
  return request(server())
    .post(`/v1/offers/${OFFER_ID}/quotes`)
    .set('Cookie', cookie)
    .set('Origin', ORIGIN)
    .set('Idempotency-Key', key)
    .send(body as object);
}

describe('D26 / F-CAT-004 plans approuvés', () => {
  it('liste publique des plans, filtrable par modèle', async () => {
    const all = await request(server()).get('/v1/plans');
    expect(all.status).toBe(200);
    // Ordre stable : modèle puis identifiant (PLANNED_EXPENSE < SAVE_THEN_BUY).
    expect((all.body as PlanList).plans.map((p) => p.planId)).toEqual(['plan-c', 'plan-a']);
    const a = await request(server()).get('/v1/plans?model=SAVE_THEN_BUY');
    expect((a.body as PlanList).plans).toEqual([
      { planId: 'plan-a', model: 'SAVE_THEN_BUY', rhythm: 'WEEKLY', minAmountXaf: '5000', maxDurationMonths: 6 },
    ]);
  });

  it('refuse un modèle fermé ou un filtre inconnu (400)', async () => {
    expect((await request(server()).get('/v1/plans?model=FINANCED_PURCHASE')).status).toBe(400);
    expect((await request(server()).get('/v1/plans?rate=1')).status).toBe(400);
  });
});

describe('F-CAT-004 devis indicatif d’une offre A', () => {
  it('coût total = prix figé, sans frais, échéancier hebdomadaire du plan, somme exacte', async () => {
    const response = await quote({ planId: 'plan-a', durationMonths: 3 }, 'quote-ok-00000001');
    expect(response.status).toBe(201);
    const body = response.body as Quote;
    expect(body).toMatchObject({ offerId: OFFER_ID, model: 'SAVE_THEN_BUY', planId: 'plan-a', durationMonths: 3, totalXaf: '150000', feesXaf: '0', tegPercent: null });
    expect(body.installments.length).toBeGreaterThanOrEqual(12);
    expect(body.installments.reduce((sum, i) => sum + BigInt(i.amountXaf), 0n)).toBe(150_000n);
  });

  it('exige une session (401)', async () => {
    const response = await request(server()).post(`/v1/offers/${OFFER_ID}/quotes`).set('Origin', ORIGIN).set('Idempotency-Key', 'quote-nosession-01').send({ planId: 'plan-a', durationMonths: 3 });
    expect(response.status).toBe(401);
  });

  it.each([
    ['un plan C pour une offre A', { planId: 'plan-c', durationMonths: 3 }, 422, 'CATALOG_PLAN_NOT_APPROVED'],
    ['un plan inconnu', { planId: 'plan-x', durationMonths: 3 }, 422, 'CATALOG_PLAN_NOT_APPROVED'],
    ['une durée au-delà du plan', { planId: 'plan-a', durationMonths: 7 }, 422, 'CATALOG_PLAN_NOT_APPROVED'],
    ['un champ hors liste blanche', { planId: 'plan-a', durationMonths: 3, rhythm: 'DAILY' }, 400, 'CATALOG_INVALID_REQUEST'],
  ])('refuse %s', async (_label, body, status, code) => {
    const response = await quote(body, `quote-ko-${Math.random().toString(36).slice(2, 12)}`);
    expect(response.status).toBe(status);
    expect((response.body as ProblemBody).code).toBe(code);
  });

  it('refuse un devis sous le minimum du plan (CATALOG_QUOTE_BELOW_MINIMUM)', async () => {
    await admin.query('BEGIN');
    await seedPaymentPlan(admin, { planId: 'plan-a-quotidien', model: 'SAVE_THEN_BUY', rhythm: 'DAILY', minAmountXaf: 5_000n, maxDurationMonths: 6 });
    await admin.query('COMMIT');
    const response = await quote({ planId: 'plan-a-quotidien', durationMonths: 6 }, 'quote-min-0000001');
    expect(response.status).toBe(422);
    expect((response.body as ProblemBody).code).toBe('CATALOG_QUOTE_BELOW_MINIMUM');
  });
});

describe('F-CAT-005 / D57 le catalogue public affiche le disponible, pas le déclaré', () => {
  type Offer = components['schemas']['Offer'];
  async function detail(): Promise<Offer> {
    const response = await request(server()).get(`/v1/offers/${OFFER_ID}`);
    expect(response.status).toBe(200);
    return response.body as Offer;
  }

  it('3 déclarées, 2 réservées : 1 disponible ; 3 réservées : rupture (0), liste et détail cohérents', async () => {
    expect((await detail()).availability).toEqual({ kind: 'IN_STOCK', units: 3 });
    await createAgreementA(admin, { id: '019a9a00-0000-7000-8000-0000000000d1', customerId: A, offerId: OFFER_ID });
    await createAgreementA(admin, { id: '019a9a00-0000-7000-8000-0000000000d2', customerId: B, offerId: OFFER_ID });
    expect((await detail()).availability).toEqual({ kind: 'IN_STOCK', units: 1 });
    await createAgreementA(admin, { id: '019a9a00-0000-7000-8000-0000000000d3', customerId: A, offerId: OFFER_ID });
    expect((await detail()).availability).toEqual({ kind: 'IN_STOCK', units: 0 });
    const list = await request(server()).get('/v1/offers');
    expect((list.body as { offers: Offer[] }).offers.map((offer) => offer.availability)).toEqual([{ kind: 'IN_STOCK', units: 0 }]);
  });
});

