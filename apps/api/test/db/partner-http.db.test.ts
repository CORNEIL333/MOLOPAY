import 'reflect-metadata';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
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
import { createSaveThenBuyAgreement } from '../../src/modules/agreements/agreement.store';
import { insertPartnerUserDisable, type PartnerPrincipal } from '../../src/modules/catalog/partner-user.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { issueHandoverCode } from '../../src/modules/settlement/handover.store';
import { confirmHandoverAtPartner } from '../../src/workflows/handover';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import { decidePayout, instructPayout, preparePayout, recordPayoutExecution } from '../../src/workflows/settlement-payout';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
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
import { createPartnerStaff, PARTNER_ORIGIN, PARTNER_RP_TEST, partnerCookie, partnerCredentialBody, partnerKey, partnerLoginBody, type PartnerKey, type Transact } from './partner-fixture';
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
let otherSeller: { manager: PartnerPrincipal; seller: PartnerPrincipal; managerKey: PartnerKey; sellerKey: PartnerKey };

async function start(deps: Partial<AppDependencies>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ database, allowedOrigins: new Set([PARTNER_ORIGIN, STAFF_ORIGIN]), ...deps })],
  }).compile();
  const started = moduleRef.createNestApplication({ logger: false });
  await started.init();
  apps.push(started);
  return started;
}

type Body = { code?: string; agreementId?: string; validatedAt?: string; sellerId?: string; login?: string; challengeId?: string; challenge?: string; enrollmentToken?: string; disabled?: boolean; users?: { userId: string; login: string; role: string; active: boolean }[]; orders?: Record<string, unknown>[]; payouts?: Record<string, unknown>[]; offers?: Record<string, unknown>[]; asOf?: string };
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

function managerPost(cookie: string, path: string, body: object, idempotencyKey = `pm-${uuidv7()}`): request.Test {
  return request(server()).post(path).set('Origin', PARTNER_ORIGIN).set('Cookie', cookie).set('Idempotency-Key', idempotencyKey).send(body);
}

describe('F-PRT-003 gestion des vendeurs par le gérant (D63)', () => {
  it('le gérant crée un vendeur, émet son enrôlement (jeton rendu une seule fois) ; le vendeur enrôle sa clé et se connecte', async () => {
    const cookie = partnerCookie(await login('awa.gerant', staff.managerKey, 1));
    const created = await managerPost(cookie, '/v1/partner/sellers', { login: 'lea.vendeuse' });
    expect(created.status).toBe(201);
    const sellerId = payload(created).sellerId ?? '';
    const stored = await admin.query('SELECT partner_id, role, created_by_user FROM catalog.partner_user WHERE id = $1', [sellerId]);
    expect(stored.rows).toEqual([{ partner_id: 'merchant-1', role: 'SELLER', created_by_user: staff.manager.userId }]);
    const key = `pm-${uuidv7()}`;
    const issued = await managerPost(cookie, `/v1/partner/sellers/${sellerId}/enrollments`, {}, key);
    expect(issued.status).toBe(201);
    const enrollment = payload(issued);
    expect(enrollment.enrollmentToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const replay = await managerPost(cookie, `/v1/partner/sellers/${sellerId}/enrollments`, {}, key);
    expect(payload(replay).enrollmentToken).toBeUndefined();
    const record = await admin.query<{ response_body: unknown }>(`SELECT response_body FROM api.idempotency_record WHERE idempotency_key = $1`, [key]);
    expect(JSON.stringify(record.rows)).not.toContain(enrollment.enrollmentToken ?? 'absent');
    const device = partnerKey();
    const enrolled = await request(server()).post('/v1/partner/credentials').set('Origin', PARTNER_ORIGIN).set('Idempotency-Key', `pc-${uuidv7()}`)
      .send(partnerCredentialBody({ challengeId: enrollment.challengeId ?? '', challenge: enrollment.challenge ?? '', enrollmentToken: enrollment.enrollmentToken ?? '' }, device));
    expect(enrolled.status).toBe(201);
    const session = await login('lea.vendeuse', device, 1);
    expect(session.status).toBe(201);
    expect(payload(session)).toMatchObject({ login: 'lea.vendeuse' });
  });

  it('le gérant liste les comptes de son seul partenaire (actifs et désactivés)', async () => {
    const cookie = partnerCookie(await login('awa.gerant', staff.managerKey, 1));
    await transact((client) => insertPartnerUserDisable(client, { userId: staff.seller.userId, by: { manager: staff.manager }, reason: 'fin de contrat' }));
    const listed = await request(server()).get('/v1/partner/users').set('Origin', PARTNER_ORIGIN).set('Cookie', cookie);
    expect(listed.status).toBe(200);
    expect(listed.headers['cache-control']).toBe('private, no-store');
    expect(payload(listed).users).toEqual([
      { userId: staff.manager.userId, login: 'awa.gerant', role: 'MANAGER', active: true },
      { userId: staff.seller.userId, login: 'paul.vendeur', role: 'SELLER', active: false },
    ]);
  });

  it('le gérant désactive son vendeur avec un motif : la session du vendeur tombe', async () => {
    const sellerCookie = partnerCookie(await login('paul.vendeur', staff.sellerKey, 1));
    const cookie = partnerCookie(await login('awa.gerant', staff.managerKey, 1));
    expect((await managerPost(cookie, `/v1/partner/sellers/${staff.seller.userId}/disable`, {})).status).toBe(400);
    const done = await managerPost(cookie, `/v1/partner/sellers/${staff.seller.userId}/disable`, { reason: 'fin de contrat' });
    expect(done.status).toBe(200);
    expect(payload(done)).toEqual({ sellerId: staff.seller.userId, disabled: true });
    expect((await handover(sellerCookie, { code: 'ABCDE-12345', ...SHOP })).status).toBe(401);
  });

  it('un vendeur ne gère pas le personnel (403 PARTNER_ROLE_DENIED), y compris la liste', async () => {
    const cookie = partnerCookie(await login('paul.vendeur', staff.sellerKey, 1));
    const refusals = [
      await managerPost(cookie, '/v1/partner/sellers', { login: 'intrus.vendeur' }),
      await managerPost(cookie, `/v1/partner/sellers/${staff.seller.userId}/enrollments`, {}),
      await managerPost(cookie, `/v1/partner/sellers/${staff.seller.userId}/disable`, { reason: 'x' }),
      await request(server()).get('/v1/partner/users').set('Origin', PARTNER_ORIGIN).set('Cookie', cookie),
    ];
    for (const refused of refusals) {
      expect(refused.status).toBe(403);
      expect(payload(refused).code).toBe('PARTNER_ROLE_DENIED');
    }
    const count = await admin.query("SELECT count(*)::int AS n FROM catalog.partner_user WHERE login = 'intrus.vendeur'");
    expect(count.rows[0]).toEqual({ n: 0 });
  });

  it('F-PRT-004 un gérant ne touche jamais au personnel d’un autre partenaire : même 404 qu’un compte inconnu', async () => {
    const cookie = partnerCookie(await login('eve.gerant', otherSeller.managerKey, 1));
    for (const target of [staff.seller.userId, staff.manager.userId, uuidv7()]) {
      for (const [path, body] of [[`/v1/partner/sellers/${target}/enrollments`, {}], [`/v1/partner/sellers/${target}/disable`, { reason: 'x' }]] as const) {
        const refused = await managerPost(cookie, path, body);
        expect(refused.status).toBe(404);
        expect(payload(refused).code).toBe('PARTNER_USER_NOT_FOUND');
      }
    }
    const own = await managerPost(cookie, `/v1/partner/sellers/${otherSeller.manager.userId}/disable`, { reason: 'x' });
    expect(own.status).toBe(404);
    const disabled = await admin.query('SELECT count(*)::int AS n FROM catalog.partner_user_disable');
    expect(disabled.rows[0]).toEqual({ n: 0 });
  });

  it('identifiant déjà pris : conflit 409 ; corps en liste blanche', async () => {
    const cookie = partnerCookie(await login('awa.gerant', staff.managerKey, 1));
    const taken = await managerPost(cookie, '/v1/partner/sellers', { login: 'max.vendeur' });
    expect(taken.status).toBe(409);
    for (const body of [{ login: 'Bad Login' }, { login: 'ok.vendeur', role: 'MANAGER' }, { login: 'ok.vendeur', partnerId: 'merchant-2' }]) {
      const refused = await managerPost(cookie, '/v1/partner/sellers', body);
      expect(refused.status).toBe(400);
    }
  });
});

describe('F-PRT-004 tableau des commandes du partenaire (D63)', () => {
  function orders(cookie: string): request.Test {
    return request(server()).get('/v1/partner/orders').set('Origin', PARTNER_ORIGIN).set('Cookie', cookie);
  }

  it('commandes du seul partenaire de la session, progression dérivée du grand livre (0 %), réservé aux sessions partenaires', async () => {
    const before = await orders(partnerCookie(await login('paul.vendeur', staff.sellerKey, 1)));
    expect(before.status).toBe(200);
    expect(before.headers['cache-control']).toBe('private, no-store');
    expect(payload(before).orders).toEqual([expect.objectContaining({ orderId: GOAL, status: 'ACTIVE', progressBasisPoints: 0, targetXaf: '150000' })]);
    expect(Number.isNaN(Date.parse(payload(before).asOf ?? ''))).toBe(false);
  });

  it('accord financé puis remis : état, montant cible, 100 %, date de remise ; jamais le client', async () => {
    const code = await fundedWithCode();
    const sellerCookie = partnerCookie(await login('paul.vendeur', staff.sellerKey, 1));
    const funded = payload(await orders(sellerCookie)).orders ?? [];
    expect(funded).toEqual([
      expect.objectContaining({ orderId: GOAL, offerId: OFFER, status: 'FUNDED', targetXaf: '150000', progressBasisPoints: 10000, handedOverAt: null }),
    ]);
    expect(JSON.stringify(funded)).not.toContain(CUSTOMER);
    expect(Object.keys(funded[0] ?? {}).sort()).toEqual(['createdAt', 'handedOverAt', 'offerId', 'offerTitle', 'orderId', 'progressBasisPoints', 'status', 'targetXaf']);
    expect((await handover(sellerCookie, { code, ...SHOP })).status).toBe(201);
    const managerCookie = partnerCookie(await login('awa.gerant', staff.managerKey, 1));
    const after = payload(await orders(managerCookie)).orders ?? [];
    expect(after[0]).toMatchObject({ status: 'HANDED_OVER' });
    expect(Number.isNaN(Date.parse(String(after[0]?.['handedOverAt'])))).toBe(false);
  });

  it('un brouillon (accord non activé par le client) n’apparaît pas', async () => {
    const draft = '019ab100-0000-7000-8000-0000000000a2';
    await createSaveThenBuyAgreement(admin, { id: draft, customerId: CUSTOMER, offerId: OFFER, planId: PLAN_A.planId, durationMonths: 3, createdAt: '2026-11-02T09:00:00.000Z' });
    const listed = payload(await orders(partnerCookie(await login('awa.gerant', staff.managerKey, 1)))).orders ?? [];
    expect(listed.map((order) => order['orderId'])).toEqual([GOAL]);
  });

  it('un autre partenaire ne voit jamais ces commandes', async () => {
    await fundedWithCode();
    const foreign = await orders(partnerCookie(await login('max.vendeur', otherSeller.sellerKey, 1)));
    expect(foreign.status).toBe(200);
    expect(payload(foreign).orders).toEqual([]);
  });

  it('export CSV au gérant : pièce jointe, mêmes commandes, sans donnée client ; vendeur refusé', async () => {
    await fundedWithCode();
    const managerCookie = partnerCookie(await login('awa.gerant', staff.managerKey, 1));
    const exported = await request(server()).get('/v1/partner/orders/export').set('Origin', PARTNER_ORIGIN).set('Cookie', managerCookie);
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(exported.headers['content-disposition']).toBe('attachment; filename="commandes.csv"');
    expect(exported.headers['cache-control']).toBe('private, no-store');
    const lines = exported.text.split('\r\n');
    expect(lines[0]).toBe('orderId,offerId,offerTitle,status,targetXaf,progressBasisPoints,createdAt,handedOverAt');
    expect(lines[1]).toMatch(new RegExp(`^${GOAL},${OFFER},.*,FUNDED,150000,10000,`));
    expect(exported.text).not.toContain(CUSTOMER);
    const sellerCookie = partnerCookie(await login('paul.vendeur', staff.sellerKey, 1));
    const seller = await request(server()).get('/v1/partner/orders/export').set('Origin', PARTNER_ORIGIN).set('Cookie', sellerCookie);
    expect(seller.status).toBe(403);
    const foreignCookie = partnerCookie(await login('eve.gerant', otherSeller.managerKey, 1));
    const foreign = await request(server()).get('/v1/partner/orders/export').set('Origin', PARTNER_ORIGIN).set('Cookie', foreignCookie);
    expect(foreign.text.split('\r\n').filter((line) => line !== '')).toHaveLength(1);
  });

  it('sans session partenaire : 401', async () => {
    const refused = await request(server()).get('/v1/partner/orders').set('Origin', PARTNER_ORIGIN);
    expect(refused.status).toBe(401);
  });
});

describe('F-PRT-003/004 règlements du partenaire, gérant uniquement (D63)', () => {
  const OPS: AdminPrincipal = { actorId: 'ops-1', roles: ['OPERATIONS'], cityIds: ['douala'] };
  const FIN: AdminPrincipal = { actorId: 'fin-1', roles: ['FINANCE'], cityIds: ['douala'], maxAmountXaf: 1_000_000n };
  const FIN2: AdminPrincipal = { actorId: 'fin-2', roles: ['FINANCE'], cityIds: ['douala'], maxAmountXaf: 1_000_000n };
  const PLATFORM = generateKeyPairSync('ed25519');

  function payouts(cookie: string): request.Test {
    return request(server()).get('/v1/partner/payouts').set('Origin', PARTNER_ORIGIN).set('Cookie', cookie);
  }

  async function handedOverAndPrepared(): Promise<string> {
    await publishSetting(admin, 'merchant_commission_bps', 250);
    await publishSetting(admin, 'settlement_contestation_days', 0);
    const code = await fundedWithCode();
    await withTransaction(database, (client) => confirmHandoverAtPartner(client, { code, partnerId: 'merchant-1', partnerUserId: staff.seller.userId, ...SHOP, pepper: PEPPER }));
    const prepared = await withTransaction(database, (client) => preparePayout(client, { id: uuidv7(), agreementId: GOAL, cityId: 'douala', principal: OPS }));
    return prepared.payoutId;
  }

  it('le gérant suit son règlement de la préparation à l’exécution (brut, commission, net, référence)', async () => {
    const payoutId = await handedOverAndPrepared();
    const cookie = partnerCookie(await login('awa.gerant', staff.managerKey, 1));
    const prepared = await payouts(cookie);
    expect(prepared.status).toBe(200);
    expect(prepared.headers['cache-control']).toBe('private, no-store');
    expect(payload(prepared).payouts).toEqual([
      { payoutId, agreementId: GOAL, grossXaf: '150000', commissionXaf: '3750', netXaf: '146250', status: 'PREPARED', executedAt: null, bankReference: null },
    ]);
    await withTransaction(database, (client) => decidePayout(client, { payoutId, principal: FIN, decision: 'APPROVED', cityId: 'douala' }));
    expect(payload(await payouts(cookie)).payouts?.[0]).toMatchObject({ status: 'APPROVED' });
    await withTransaction(database, (client) => instructPayout(client, { payoutId, principal: FIN, cityId: 'douala', signingKey: PLATFORM.privateKey, keyId: 'k1' }));
    expect(payload(await payouts(cookie)).payouts?.[0]).toMatchObject({ status: 'INSTRUCTED' });
    await withTransaction(database, (client) => recordPayoutExecution(client, { payoutId, principal: FIN2, cityId: 'douala', outcome: 'EXECUTED', bankReference: 'ETAB-REG-1' }));
    const executed = payload(await payouts(cookie)).payouts?.[0] ?? {};
    expect(executed).toMatchObject({ status: 'EXECUTED', bankReference: 'ETAB-REG-1' });
    expect(Number.isNaN(Date.parse(String(executed['executedAt'])))).toBe(false);
    expect(JSON.stringify(executed)).not.toMatch(/ops-1|fin-1|fin-2/);
  });

  it('règlement refusé par la finance : état REJECTED', async () => {
    const payoutId = await handedOverAndPrepared();
    await withTransaction(database, (client) => decidePayout(client, { payoutId, principal: FIN, decision: 'REJECTED', cityId: 'douala', reason: 'pièce manquante' }));
    const cookie = partnerCookie(await login('awa.gerant', staff.managerKey, 1));
    expect(payload(await payouts(cookie)).payouts?.[0]).toMatchObject({ status: 'REJECTED', netXaf: '146250' });
  });

  it('exécution refusée par l’établissement : état EXECUTION_REJECTED, ni date ni référence', async () => {
    const payoutId = await handedOverAndPrepared();
    await withTransaction(database, (client) => decidePayout(client, { payoutId, principal: FIN, decision: 'APPROVED', cityId: 'douala' }));
    await withTransaction(database, (client) => instructPayout(client, { payoutId, principal: FIN, cityId: 'douala', signingKey: PLATFORM.privateKey, keyId: 'k1' }));
    await withTransaction(database, (client) => recordPayoutExecution(client, { payoutId, principal: FIN2, cityId: 'douala', outcome: 'REJECTED', bankReference: 'ETAB-REJ-1' }));
    const cookie = partnerCookie(await login('awa.gerant', staff.managerKey, 1));
    expect(payload(await payouts(cookie)).payouts?.[0]).toMatchObject({ status: 'EXECUTION_REJECTED', executedAt: null, bankReference: null });
  });

  it('le vendeur ne voit pas les règlements (403) ; un autre partenaire ne voit rien', async () => {
    await handedOverAndPrepared();
    const seller = await payouts(partnerCookie(await login('paul.vendeur', staff.sellerKey, 1)));
    expect(seller.status).toBe(403);
    expect(payload(seller).code).toBe('PARTNER_ROLE_DENIED');
    const foreign = await payouts(partnerCookie(await login('eve.gerant', otherSeller.managerKey, 1)));
    expect(foreign.status).toBe(200);
    expect(payload(foreign).payouts).toEqual([]);
  });
});

describe('F-PRT-002 offres du partenaire en lecture (D63)', () => {
  function offers(cookie: string): request.Test {
    return request(server()).get('/v1/partner/offers').set('Origin', PARTNER_ORIGIN).set('Cookie', cookie);
  }

  it('sans présentation (titre) l’offre publiée reste invisible du public', async () => {
    const cookie = partnerCookie(await login('paul.vendeur', staff.sellerKey, 1));
    expect((payload(await offers(cookie)).offers ?? [])[0]).toMatchObject({ offerId: OFFER, title: null, publiclyVisible: false });
  });

  it('offres du seul partenaire, version courante, prix figé, stock disponible et visibilité publique', async () => {
    await admin.query('INSERT INTO catalog.offer_presentation VALUES ($1, 1, $2, $3, now())', [OFFER, 'Réfrigérateur 200 L', 'net-1']);
    const cookie = partnerCookie(await login('paul.vendeur', staff.sellerKey, 1));
    const listed = await offers(cookie);
    expect(listed.status).toBe(200);
    expect(listed.headers['cache-control']).toBe('private, no-store');
    const [offer] = payload(listed).offers ?? [];
    expect(offer).toMatchObject({ offerId: OFFER, version: 1, title: 'Réfrigérateur 200 L', state: 'PUBLISHED', priceXaf: '150000', publiclyVisible: true });
    const stock = (await admin.query<{ kind: string; units: number | null }>('SELECT availability_kind AS kind, stock_units AS units FROM catalog.offer_version WHERE offer_id = $1', [OFFER])).rows[0];
    expect(offer).toMatchObject({ availabilityKind: stock?.kind, stockUnits: stock?.units, availableUnits: stock?.kind === 'IN_STOCK' ? (stock.units ?? 0) - 1 : null });
    expect(Object.keys(offer ?? {}).sort()).toEqual(['availabilityKind', 'availableUnits', 'offerId', 'priceXaf', 'publiclyVisible', 'state', 'stockUnits', 'title', 'updatedAt', 'version']);
    expect(Number.isNaN(Date.parse(payload(listed).asOf ?? ''))).toBe(false);
  });

  it('un autre partenaire ne voit pas ces offres', async () => {
    const foreignCookie = partnerCookie(await login('max.vendeur', otherSeller.sellerKey, 1));
    expect(payload(await offers(foreignCookie)).offers).toEqual([]);
  });

  it('marchand déclaré défaillant : offre toujours listée au partenaire mais invisible du public', async () => {
    await admin.query('INSERT INTO catalog.offer_presentation VALUES ($1, 1, $2, $3, now())', [OFFER, 'Réfrigérateur 200 L', 'net-1']);
    await admin.query(`INSERT INTO catalog.partner_incident (id, partner_id, kind, reason, reported_by, created_at) VALUES ($1, 'merchant-1', 'MERCHANT_DEFAULT', 'test', 'risk-1', now())`, [uuidv7()]);
    const cookie = partnerCookie(await login('awa.gerant', staff.managerKey, 1));
    expect((payload(await offers(cookie)).offers ?? [])[0]).toMatchObject({ offerId: OFFER, publiclyVisible: false });
  });
});
