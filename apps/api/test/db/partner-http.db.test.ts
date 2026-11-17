import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BusinessError } from '@achat/contracts';
import { AppModule, type AppDependencies } from '../../src/app.module';
import { createDatabase, withTransaction, type Database } from '../../src/http/database';
import { insertPartnerUserDisable, type PartnerPrincipal } from '../../src/modules/catalog/partner-user.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { issueHandoverCode } from '../../src/modules/settlement/handover.store';
import { confirmHandoverAtPartner } from '../../src/workflows/handover';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import {
  createAgreementA,
  PLAN_A,
  publishKycLimits,
  publishOfferA,
  publishSetting,
  seedCustomerAccount,
  seedLedgerGenesis,
  seedPaymentPlan,
  validateMerchant,
} from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { createPartnerStaff, PARTNER_ORIGIN, PARTNER_RP_TEST, partnerCookie, partnerLoginBody, type PartnerKey, type Transact } from './partner-fixture';
import { createStaffWithKey, loginOverHttp, STAFF_ORIGIN, STAFF_RP_TEST, staffCookie } from './staff-fixture';

/**
 * D63 (lot 20) : connexion des partenaires par WebAuthn et remise au
 * comptoir (F-SET-001) en HTTP, sur PostgreSQL réel avec toutes les
 * migrations. Partenaire et vendeur viennent de la session, jamais du corps.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const CUSTOMER = '019ab100-0000-7000-8000-0000000000c1';
const GOAL = '019ab100-0000-7000-8000-0000000000a1';
const OFFER = '019ab100-0000-7000-8000-0000000000f1';
const PEPPER = randomBytes(32);
const SHOP = { latitude: '4.051056', longitude: '9.767869' };

let db: TestDatabase;
let admin: Client;
let database: Database;
let migrations: string[];
const apps: INestApplication[] = [];
let app: INestApplication;
let staff: { manager: PartnerPrincipal; seller: PartnerPrincipal; managerKey: PartnerKey; sellerKey: PartnerKey };
let otherSeller: { seller: PartnerPrincipal; sellerKey: PartnerKey };

async function start(deps: Partial<AppDependencies>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ database, allowedOrigins: new Set([PARTNER_ORIGIN, STAFF_ORIGIN]), ...deps })],
  }).compile();
  const started = moduleRef.createNestApplication({ logger: false });
  await started.init();
  apps.push(started);
  return started;
}

type Body = { code?: string; agreementId?: string; validatedAt?: string };
function payload(response: request.Response): Body {
  return response.body as Body;
}

function server(target: INestApplication = app): Server {
  return target.getHttpServer() as Server;
}

const transact: Transact = (action) => withTransaction(database, action);

async function failure(action: () => Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  try {
    await action();
  } catch (error: unknown) {
    if (error instanceof BusinessError) {
      return { code: error.code, message: error.message };
    }
    const pg = error as { code?: string; message?: string };
    return { code: pg.code, message: pg.message ?? '' };
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

async function login(loginName: string, key: PartnerKey, signCount: number, idempotencyKey = `partner-${uuidv7()}`): Promise<request.Response> {
  const body = await partnerLoginBody(server(), loginName, key, signCount);
  return request(server()).post('/v1/partner/sessions').set('Origin', PARTNER_ORIGIN).set('Idempotency-Key', idempotencyKey).send(body);
}

function handover(cookie: string | null, body: object, target: INestApplication = app): request.Test {
  const call = request(server(target)).post('/v1/partner/handovers').set('Origin', PARTNER_ORIGIN).set('Idempotency-Key', `ho-${uuidv7()}`);
  return (cookie === null ? call : call.set('Cookie', cookie)).send(body);
}

async function fundedWithCode(): Promise<string> {
  const attemptId = uuidv7();
  await withTransaction(database, async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId: GOAL, channel: 'MTN_MOMO', amountXaf: 150_000n, idemKey: uuidv7() });
    await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
  });
  await withTransaction(database, (client) =>
    confirmPaymentAndFundAgreement(client, {
      attemptId,
      customerId: CUSTOMER,
      providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: 150_000n, outcome: 'SUCCEEDED' },
      actorId: 'payments-worker',
    }),
  );
  const { code } = await withTransaction(database, (client) => issueHandoverCode(client, { agreementId: GOAL, pepper: PEPPER, actorId: 'system-handover' }));
  return code;
}

beforeAll(async () => {
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  app = await start({ partnerRp: PARTNER_RP_TEST, handoverPepper: PEPPER, staffRp: STAFF_RP_TEST });
}, 300_000);

afterAll(async () => {
  for (const started of apps) {
    await started.close();
  }
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
  await admin.query('BEGIN');
  await validateMerchant(admin, uuidv7(), 'merchant-1');
  await validateMerchant(admin, uuidv7(), 'merchant-2');
  await seedPaymentPlan(admin, PLAN_A);
  await publishOfferA(admin, { offerId: OFFER, partnerId: 'merchant-1', priceXaf: 150_000n });
  await createAgreementA(admin, { id: GOAL, customerId: CUSTOMER, offerId: OFFER });
  await admin.query('COMMIT');
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER, 'STRONG');
  await publishKycLimits(admin);
  await publishSetting(admin, 'handover_code_validity_days', 30);
  staff = await createPartnerStaff(transact, { partnerId: 'merchant-1', managerLogin: 'awa.gerant', sellerLogin: 'paul.vendeur' });
  otherSeller = await createPartnerStaff(transact, { partnerId: 'merchant-2', managerLogin: 'eve.gerant', sellerLogin: 'max.vendeur' });
});

describe('D63 fermé par défaut', () => {
  it('sans partie de confiance partenaire : connexion et remise en 503', async () => {
    const closed = await start({});
    const challenge = await request(server(closed)).post('/v1/partner/login-challenges').set('Origin', PARTNER_ORIGIN).set('Idempotency-Key', `p-${uuidv7()}`).send({ login: 'paul.vendeur' });
    expect(challenge.status).toBe(503);
    expect(payload(challenge).code).toBe('PARTNER_AUTH_UNCONFIGURED');
    const blocked = await handover(null, { code: 'ABCDE-12345', ...SHOP }, closed);
    expect(blocked.status).toBe(503);
    expect(payload(blocked).code).toBe('PARTNER_AUTH_UNCONFIGURED');
  });

  it('sans poivre des codes de remise : remise en 503 même avec une session valide', async () => {
    const noPepper = await start({ partnerRp: PARTNER_RP_TEST });
    const body = await partnerLoginBody(server(noPepper), 'paul.vendeur', staff.sellerKey, 1);
    const session = await request(server(noPepper)).post('/v1/partner/sessions').set('Origin', PARTNER_ORIGIN).set('Idempotency-Key', `p-${uuidv7()}`).send(body);
    expect(session.status).toBe(201);
    const blocked = await handover(partnerCookie(session), { code: 'ABCDE-12345', ...SHOP }, noPepper);
    expect(blocked.status).toBe(503);
    expect(payload(blocked).code).toBe('HANDOVER_UNCONFIGURED');
  });
});

describe('SEC-AUTH-006 connexion du portail partenaire', () => {
  it('session : partenaire et rôle reconstruits en base, cookie distinct, rejeu sans cookie', async () => {
    const key = `partner-${uuidv7()}`;
    const body = await partnerLoginBody(server(), 'paul.vendeur', staff.sellerKey, 1);
    const first = await request(server()).post('/v1/partner/sessions').set('Origin', PARTNER_ORIGIN).set('Idempotency-Key', key).send(body);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ partnerId: 'merchant-1', login: 'paul.vendeur', role: 'SELLER' });
    const cookie = String((first.headers['set-cookie'] as unknown as string[])[0]);
    expect(cookie).toMatch(/^partner_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const replay = await request(server()).post('/v1/partner/sessions').set('Origin', PARTNER_ORIGIN).set('Idempotency-Key', key).send(body);
    expect(replay.status).toBe(201);
    expect(replay.headers['set-cookie']).toBeUndefined();
  });

  it('identifiant inconnu et mauvaise clé : même refus 401 PARTNER_AUTH_INVALID', async () => {
    const unknown = await login('inconnu.vendeur', staff.sellerKey, 1);
    expect(unknown.status).toBe(401);
    expect(payload(unknown).code).toBe('PARTNER_AUTH_INVALID');
    const wrongKey = await login('paul.vendeur', staff.managerKey, 1);
    expect(wrongKey.status).toBe(401);
    expect(payload(wrongKey).code).toBe('PARTNER_AUTH_INVALID');
  });

  it('cloisonnement : la session du personnel ne vaut rien au portail, celle du partenaire rien au back-office', async () => {
    const { key } = await createStaffWithKey(db.getConnectionUri(), { login: 'ops.dla', roles: ['OPERATIONS'] });
    const staffSession = staffCookie(await loginOverHttp(server(), 'ops.dla', key, 1));
    const asStaff = await handover(staffSession, { code: 'ABCDE-12345', ...SHOP });
    expect(asStaff.status).toBe(401);
    expect(payload(asStaff).code).toBe('PARTNER_AUTH_INVALID');
    const partnerSession = partnerCookie(await login('awa.gerant', staff.managerKey, 1));
    const asPartner = await request(server()).get('/v1/backoffice/queue').set('Origin', STAFF_ORIGIN).set('Cookie', partnerSession).query({ reason: 'test' });
    expect(asPartner.status).toBe(401);
    expect(payload(asPartner).code).toBe('STAFF_AUTH_INVALID');
  });

  it('déconnexion et désactivation rendent la session inutilisable', async () => {
    const cookie = partnerCookie(await login('paul.vendeur', staff.sellerKey, 1));
    const out = await request(server()).delete('/v1/partner/sessions/current').set('Origin', PARTNER_ORIGIN).set('Idempotency-Key', `p-${uuidv7()}`).set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect((await handover(cookie, { code: 'ABCDE-12345', ...SHOP })).status).toBe(401);
    const again = partnerCookie(await login('paul.vendeur', staff.sellerKey, 2));
    await transact((client) => insertPartnerUserDisable(client, { userId: staff.seller.userId, by: { manager: staff.manager }, reason: 'fin de contrat' }));
    const disabled = await handover(again, { code: 'ABCDE-12345', ...SHOP });
    expect(disabled.status).toBe(401);
    expect(payload(disabled).code).toBe('PARTNER_AUTH_INVALID');
  });
});

describe('F-SET-001 remise au comptoir (D63)', () => {
  it('le vendeur confirme la remise : vendeur et partenaire imposés par la session, accord remis', async () => {
    const code = await fundedWithCode();
    const cookie = partnerCookie(await login('paul.vendeur', staff.sellerKey, 1));
    const done = await handover(cookie, { code, ...SHOP });
    expect(done.status).toBe(201);
    expect(payload(done).agreementId).toBe(GOAL);
    expect(Number.isNaN(Date.parse(payload(done).validatedAt ?? ''))).toBe(false);
    const stored = await admin.query('SELECT partner_id, partner_user_id FROM settlement.handover WHERE agreement_id = $1', [GOAL]);
    expect(stored.rows).toEqual([{ partner_id: 'merchant-1', partner_user_id: staff.seller.userId }]);
    const state = await admin.query('SELECT status FROM agreements.agreement_state WHERE id = $1', [GOAL]);
    expect(state.rows).toEqual([{ status: 'HANDED_OVER' }]);
  });

  it('le corps ne peut pas choisir partenaire ni vendeur (liste blanche) ; coordonnées et code validés', async () => {
    const code = await fundedWithCode();
    const cookie = partnerCookie(await login('paul.vendeur', staff.sellerKey, 1));
    for (const body of [
      { code, ...SHOP, partnerId: 'merchant-2' },
      { code, ...SHOP, partnerUserId: otherSeller.seller.userId },
      { code, latitude: 4.051056, longitude: 9.767869 },
      { code: 'ABC', ...SHOP },
      { code: 'ABCDE_12345', ...SHOP },
      { code, latitude: '4.0510561', longitude: '9.767869' },
    ]) {
      const refused = await handover(cookie, body);
      expect(refused.status).toBe(400);
      expect(payload(refused).code).toBe('REQUEST_INVALID');
    }
  });

  it('un vendeur d’un autre marchand reçoit la même réponse qu’un code inconnu (aucun oracle)', async () => {
    const code = await fundedWithCode();
    const cookie = partnerCookie(await login('max.vendeur', otherSeller.sellerKey, 1));
    const foreign = await handover(cookie, { code, ...SHOP });
    expect(foreign.status).toBe(422);
    expect(payload(foreign).code).toBe('HANDOVER_CODE_INVALID');
    const unknown = await handover(cookie, { code: code === '0000000000' ? '1111111111' : '0000000000', ...SHOP });
    expect(payload(unknown).code).toBe('HANDOVER_CODE_INVALID');
    const state = await admin.query('SELECT status FROM agreements.agreement_state WHERE id = $1', [GOAL]);
    expect(state.rows).toEqual([{ status: 'FUNDED' }]);
  });

  it('sans session : 401', async () => {
    const refused = await handover(null, { code: 'ABCDE-12345', ...SHOP });
    expect(refused.status).toBe(401);
    expect(payload(refused).code).toBe('PARTNER_AUTH_INVALID');
  });

  it('base garante (0058) : vendeur libre, d’un autre marchand ou désactivé refusé même si le flux est contourné', async () => {
    const code = await fundedWithCode();
    const attempt = (partnerUserId: string): Promise<unknown> =>
      withTransaction(database, (client) => confirmHandoverAtPartner(client, { code, partnerId: 'merchant-1', partnerUserId, ...SHOP, pepper: PEPPER }));
    for (const partnerUserId of ['vendeur-1', otherSeller.seller.userId]) {
      expect((await failure(() => attempt(partnerUserId))).message).toMatch(/^PARTNER_ROLE_DENIED: remise par un compte actif du partenaire/);
    }
    await transact((client) => insertPartnerUserDisable(client, { userId: staff.seller.userId, by: { manager: staff.manager }, reason: 'fin de contrat' }));
    expect((await failure(() => attempt(staff.seller.userId))).message).toMatch(/^PARTNER_ROLE_DENIED/);
    await attempt(staff.manager.userId);
  });
});
