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
import { AppModule } from '../../src/app.module';
import { createDatabase, withTransaction, type Database } from '../../src/http/database';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { issueHandoverCode } from '../../src/modules/settlement/handover.store';
import { recordIntegrityDivergence } from '../../src/modules/settlement/integrity-divergence.store';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import { confirmHandoverAtPartner } from '../../src/workflows/handover';
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
  publishCommitmentLimits,
} from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { createPartnerStaff } from './partner-fixture';
import { createStaffWithKey, loginOverHttp, STAFF_ORIGIN, STAFF_RP_TEST, staffCookie } from './staff-fixture';

/** D46 / D62 : règlements des marchands au back-office, ville du périmètre de l'agent comprise. */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const CUSTOMER = '019aa700-0000-7000-8000-0000000000c1';
const GOAL = '019aa700-0000-7000-8000-0000000000a1';
const OFFER = '019aa700-0000-7000-8000-0000000000f1';
const PEPPER = randomBytes(32);
const PLATFORM = generateKeyPairSync('ed25519');

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];
let cookies: Record<'ops' | 'finOne' | 'finTwo' | 'finYaounde', string>;

function server(): Server {
  return app.getHttpServer() as Server;
}

function post(path: string, cookie: string, body: object): request.Test {
  return request(server()).post(path).set('Origin', STAFF_ORIGIN).set('Cookie', cookie).set('Idempotency-Key', `bo-${uuidv7()}`).send(body);
}

async function pay(amount: bigint): Promise<void> {
  const attemptId = uuidv7();
  await withTransaction(database, async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId: GOAL, channel: 'MTN_MOMO', amountXaf: amount, idemKey: uuidv7() });
    await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
  });
  await withTransaction(database, (client) =>
    confirmPaymentAndFundAgreement(client, {
      attemptId,
      customerId: CUSTOMER,
      providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: amount, outcome: 'SUCCEEDED' },
      actorId: 'payments-worker',
    }),
  );
}

beforeAll(async () => {
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set([STAFF_ORIGIN]), staffRp: STAFF_RP_TEST, platformSigningKey: { key: PLATFORM.privateKey, keyId: 'k1' } })] }).compile();
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
  await publishCommitmentLimits(admin);
  await admin.query('BEGIN');
  await validateMerchant(admin, uuidv7());
  await seedPaymentPlan(admin, PLAN_A);
  await publishOfferA(admin, { offerId: OFFER, partnerId: 'merchant-1', priceXaf: 150_000n });
  await createAgreementA(admin, { id: GOAL, customerId: CUSTOMER, offerId: OFFER });
  await admin.query('COMMIT');
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER, 'STRONG');
  await publishKycLimits(admin);
  const uri = db.getConnectionUri();
  await publishSetting(admin, 'handover_code_validity_days', 30);
  await publishSetting(admin, 'merchant_commission_bps', 250);
  await publishSetting(admin, 'settlement_contestation_days', 0);
  const agents = [
    ['ops', 'ops.dla', ['OPERATIONS'], ['douala']],
    ['finOne', 'fin.dla1', ['FINANCE'], ['douala']],
    ['finTwo', 'fin.dla2', ['FINANCE'], ['douala']],
    ['finYaounde', 'fin.yde', ['FINANCE'], ['yaounde']],
  ] as const;
  const result: Partial<typeof cookies> = {};
  for (const [slot, login, roles, cityIds] of agents) {
    const { key } = await createStaffWithKey(uri, { login, roles: [...roles], cityIds: [...cityIds], maxAmountXaf: 1_000_000n });
    result[slot] = staffCookie(await loginOverHttp(server(), login, key, 1));
  }
  cookies = result as typeof cookies;
});

async function handedOver(): Promise<void> {
  await pay(150_000n);
  const { code } = await withTransaction(database, (client) => issueHandoverCode(client, { agreementId: GOAL, pepper: PEPPER, actorId: 'system-handover' }));
  const counter = await createPartnerStaff((action) => withTransaction(database, action), { partnerId: 'merchant-1', managerLogin: 'awa.gerant', sellerLogin: 'paul.vendeur' });
  await withTransaction(database, (client) =>
    confirmHandoverAtPartner(client, { code, partnerId: 'merchant-1', partnerUserId: counter.seller.userId, latitude: '4.051056', longitude: '9.767869', pepper: PEPPER }),
  );
}

describe('C7 / SEC-INC-003 gel des flux sortants, activé et levé par deux personnes', () => {
  function freeze(cookie: string, action: 'FREEZE' | 'UNFREEZE', reason = 'Incident : relevé incohérent de l’établissement'): request.Test {
    return post('/v1/backoffice/outgoing-freeze/requests', cookie, { action, reason });
  }
  function confirm(cookie: string, requestId: string): request.Test {
    return post(`/v1/backoffice/outgoing-freeze/requests/${requestId}/confirmation`, cookie, {});
  }
  function state(cookie: string): request.Test {
    return request(server()).get('/v1/backoffice/outgoing-freeze').set('Cookie', cookie);
  }

  it('gel demandé par l’un, confirmé par un autre : toute nouvelle instruction est refusée (SETTLEMENT_OUTGOING_FROZEN) ; préparation et décision restent possibles ; levée à deux personnes', async () => {
    await handedOver();
    const prepared = await post('/v1/backoffice/settlements', cookies.ops, { agreementId: GOAL, cityId: 'douala' });
    const { payoutId } = prepared.body as { payoutId: string };
    const requested = await freeze(cookies.finOne, 'FREEZE');
    expect(requested.status, JSON.stringify(requested.body)).toBe(201);
    const { requestId } = requested.body as { requestId: string };
    expect(((await state(cookies.finTwo)).body as { frozen: boolean }).frozen).toBe(false);
    const self = await confirm(cookies.finOne, requestId);
    expect([self.status, (self.body as { code?: string }).code]).toEqual([403, 'MAKER_CANNOT_APPROVE']);
    expect((await confirm(cookies.finTwo, requestId)).status).toBe(200);
    const frozen = (await state(cookies.ops)).body as { frozen: boolean; since: string | null; reason: string | null };
    expect(frozen).toMatchObject({ frozen: true, reason: 'Incident : relevé incohérent de l’établissement' });
    expect((await post(`/v1/backoffice/settlements/${payoutId}/decision`, cookies.finOne, { decision: 'APPROVED', cityId: 'douala' })).status).toBe(200);
    const blocked = await post(`/v1/backoffice/settlements/${payoutId}/instruction`, cookies.finOne, { cityId: 'douala' });
    expect([blocked.status, (blocked.body as { code?: string }).code]).toEqual([409, 'SETTLEMENT_OUTGOING_FROZEN']);
    expect((await admin.query('SELECT count(*)::int AS n FROM settlement.payout_instruction')).rows[0]).toEqual({ n: 0 });
    const unfreeze = await freeze(cookies.finTwo, 'UNFREEZE', 'Relevé corrigé par l’établissement');
    const { requestId: unfreezeId } = unfreeze.body as { requestId: string };
    expect((await confirm(cookies.finOne, unfreezeId)).status).toBe(200);
    expect(((await state(cookies.ops)).body as { frozen: boolean }).frozen).toBe(false);
    expect((await post(`/v1/backoffice/settlements/${payoutId}/instruction`, cookies.finOne, { cityId: 'douala' })).status).toBe(201);
  });

  it('refus : action incohérente avec l’état (déjà gelé / non gelé), motif absent, rôle sans droit, demande confirmée deux fois', async () => {
    expect((await freeze(cookies.finOne, 'UNFREEZE')).body).toMatchObject({ code: 'SETTLEMENT_FREEZE_STATE' });
    expect((await post('/v1/backoffice/outgoing-freeze/requests', cookies.finOne, { action: 'FREEZE' })).status).toBe(400);
    expect((await freeze(cookies.ops, 'FREEZE')).body).toMatchObject({ code: 'ADMIN_FORBIDDEN' });
    const requested = await freeze(cookies.finOne, 'FREEZE');
    const { requestId } = requested.body as { requestId: string };
    expect((await confirm(cookies.finTwo, requestId)).status).toBe(200);
    const twice = await confirm(cookies.finTwo, requestId);
    expect([twice.status, (twice.body as { code?: string }).code]).toEqual([409, 'REQUEST_CONFLICT']);
    expect((await freeze(cookies.finOne, 'FREEZE')).body).toMatchObject({ code: 'SETTLEMENT_FREEZE_STATE' });
    const audit = await admin.query(`SELECT action, actor_id FROM audit.event WHERE action IN ('OUTGOING_FREEZE_REQUESTED', 'OUTGOING_FREEZE_CONFIRMED') ORDER BY seq`);
    expect(audit.rows).toEqual([{ action: 'OUTGOING_FREEZE_REQUESTED', actor_id: 'fin.dla1' }, { action: 'OUTGOING_FREEZE_CONFIRMED', actor_id: 'fin.dla2' }]);
  });

  it('base garante : instruction directe refusée pendant le gel ; demande expirée (1 h) non confirmable ; tables en ajout seul', async () => {
    const requested = await freeze(cookies.finOne, 'FREEZE');
    const { requestId } = requested.body as { requestId: string };
    // Voyage dans le temps (superutilisateur, test seulement) : la demande a 2 heures.
    await admin.query('ALTER TABLE settlement.outgoing_freeze_request DISABLE TRIGGER outgoing_freeze_request_no_update_delete');
    await admin.query(`UPDATE settlement.outgoing_freeze_request SET requested_at = requested_at - interval '2 hours' WHERE id = $1`, [requestId]);
    await admin.query('ALTER TABLE settlement.outgoing_freeze_request ENABLE ALWAYS TRIGGER outgoing_freeze_request_no_update_delete');
    const late = await confirm(cookies.finTwo, requestId);
    expect([late.status, (late.body as { code?: string }).code]).toEqual([422, 'SETTLEMENT_FREEZE_EXPIRED']);
    const again = await freeze(cookies.finOne, 'FREEZE');
    await confirm(cookies.finTwo, (again.body as { requestId: string }).requestId);
    const frozen = await admin.query<{ frozen: boolean }>('SELECT settlement.outgoing_frozen() AS frozen');
    expect(frozen.rows[0]).toEqual({ frozen: true });
    const mutation = await admin.query('UPDATE settlement.outgoing_freeze_confirmation SET confirmed_by = $1', ['x']).then(() => 'accepted', (error: { message?: string }) => error.message ?? '');
    expect(mutation).toMatch(/^SETTLEMENT_APPEND_ONLY/);
    // Les trois tables d'instructions signées sont gardées (le déclencheur passe avant toute autre vérification de la ligne).
    for (const table of ['payout_instruction', 'refund_instruction', 'beneficiary_payout_instruction']) {
      const refused = await admin.query(`INSERT INTO settlement.${table} DEFAULT VALUES`).then(() => 'accepted', (error: { message?: string }) => error.message ?? '');
      expect(refused, table).toMatch(/^SETTLEMENT_OUTGOING_FROZEN/);
    }
  });
});

describe('C9 / INT-VER-002 gel automatique sur divergence du vérificateur indépendant', () => {
  async function divergence(code: string): Promise<void> {
    await admin.query('BEGIN');
    try {
      await admin.query('SET LOCAL ROLE integrity_reporter');
      await recordIntegrityDivergence(admin, code);
      await admin.query('COMMIT');
    } catch (error) {
      await admin.query('ROLLBACK');
      throw error;
    }
  }
  async function attempt(role: string, sql: string, values: readonly unknown[] = []): Promise<string> {
    await admin.query('BEGIN');
    try {
      await admin.query(`SET LOCAL ROLE ${role}`);
      await admin.query(sql, [...values]);
      return 'accepted';
    } catch (error) {
      return (error as { code?: string }).code ?? '';
    } finally {
      await admin.query('ROLLBACK');
    }
  }

  it('une divergence gèle aussitôt les sorties ; une levée demandée avant une nouvelle divergence ne l’efface pas ; levée à deux personnes ensuite', async () => {
    await handedOver();
    const prepared = await post('/v1/backoffice/settlements', cookies.ops, { agreementId: GOAL, cityId: 'douala' });
    const { payoutId } = prepared.body as { payoutId: string };
    expect((await post(`/v1/backoffice/settlements/${payoutId}/decision`, cookies.finOne, { decision: 'APPROVED', cityId: 'douala' })).status).toBe(200);
    await divergence('ENTRY_HASH_MISMATCH');
    const state = (await request(server()).get('/v1/backoffice/outgoing-freeze').set('Cookie', cookies.ops)).body as { frozen: boolean; reason: string | null; since: string | null; divergence: { code: string; detectedAt: string } | null };
    expect(state).toMatchObject({ frozen: true, reason: null, divergence: { code: 'ENTRY_HASH_MISMATCH' } });
    expect(state.since).toBe(state.divergence?.detectedAt);
    const blocked = await post(`/v1/backoffice/settlements/${payoutId}/instruction`, cookies.finOne, { cityId: 'douala' });
    expect([blocked.status, (blocked.body as { code?: string }).code]).toEqual([409, 'SETTLEMENT_OUTGOING_FROZEN']);
    // Déjà gelé : un gel manuel est sans effet.
    expect((await post('/v1/backoffice/outgoing-freeze/requests', cookies.finOne, { action: 'FREEZE', reason: 'Doublon' })).body).toMatchObject({ code: 'SETTLEMENT_FREEZE_STATE' });
    const early = await post('/v1/backoffice/outgoing-freeze/requests', cookies.finOne, { action: 'UNFREEZE', reason: 'Export corrigé' });
    expect(early.status).toBe(201);
    await divergence('PREV_HASH_MISMATCH');
    const stale = await post(`/v1/backoffice/outgoing-freeze/requests/${(early.body as { requestId: string }).requestId}/confirmation`, cookies.finTwo, {});
    expect([stale.status, (stale.body as { code?: string }).code]).toEqual([409, 'SETTLEMENT_FREEZE_STATE']);
    const fresh = await post('/v1/backoffice/outgoing-freeze/requests', cookies.finTwo, { action: 'UNFREEZE', reason: 'Chaîne revérifiée après correction' });
    const self = await post(`/v1/backoffice/outgoing-freeze/requests/${(fresh.body as { requestId: string }).requestId}/confirmation`, cookies.finTwo, {});
    expect([self.status, (self.body as { code?: string }).code]).toEqual([403, 'MAKER_CANNOT_APPROVE']);
    expect((await post(`/v1/backoffice/outgoing-freeze/requests/${(fresh.body as { requestId: string }).requestId}/confirmation`, cookies.finOne, {})).status).toBe(200);
    expect((await request(server()).get('/v1/backoffice/outgoing-freeze').set('Cookie', cookies.ops)).body).toMatchObject({ frozen: false, since: null, reason: null, divergence: null });
    expect((await post(`/v1/backoffice/settlements/${payoutId}/instruction`, cookies.finOne, { cityId: 'douala' })).status).toBe(201);
  });

  it('base garante : le rôle de rapport n’écrit qu’une divergence ; l’application ne peut pas en fabriquer ni en effacer ; ajout seul', async () => {
    const id = uuidv7();
    const insert = `INSERT INTO settlement.integrity_divergence (id, source, code, reported_by, detected_at) VALUES ($1, 'LEDGER_VERIFIER', 'ENTRY_UNBALANCED', 'x', now())`;
    expect(await attempt('app_rw', insert, [id])).toBe('42501');
    expect(await attempt('integrity_reporter', 'SELECT 1 FROM settlement.outgoing_freeze_request')).toBe('42501');
    expect(await attempt('integrity_reporter', `INSERT INTO settlement.outgoing_freeze_confirmation (request_id, confirmed_by, confirmed_at) VALUES ($1, 'x', now())`, [uuidv7()])).toBe('42501');
    expect(await attempt('integrity_reporter', 'SELECT 1 FROM settlement.payout_instruction')).toBe('42501');
    expect(await attempt('integrity_reporter', insert.replace("'ENTRY_UNBALANCED'", "'invalide'"), [uuidv7()])).toBe('23514');
    expect(await attempt('integrity_reporter', insert.replace("'LEDGER_VERIFIER'", "'MANUEL'"), [uuidv7()])).toBe('23514');
    // Auteur et instant fournis par l'appelant : ignorés.
    expect(await attempt('integrity_reporter', `INSERT INTO settlement.integrity_divergence (id, source, code, reported_by, detected_at)
      VALUES ($1, 'LEDGER_VERIFIER', 'ENTRY_UNBALANCED', 'forge', '2000-01-01T00:00:00Z')`, [uuidv7()])).toBe('accepted');
    await admin.query('BEGIN');
    await admin.query('SET LOCAL ROLE integrity_reporter');
    await admin.query(`INSERT INTO settlement.integrity_divergence (id, source, code, reported_by, detected_at)
      VALUES ($1, 'LEDGER_VERIFIER', 'ENTRY_UNBALANCED', 'forge', '2000-01-01T00:00:00Z')`, [uuidv7()]);
    await admin.query('COMMIT');
    const row = (await admin.query<{ reported_by: string; recent: boolean }>(
      `SELECT reported_by, detected_at > now() - interval '1 minute' AS recent FROM settlement.integrity_divergence`,
    )).rows;
    // Auteur et horodatage posés par la base, jamais par l'appelant.
    expect(row).toEqual([{ reported_by: 'integrity_reporter', recent: true }]);
    expect(await attempt('integrity_reporter', 'DELETE FROM settlement.integrity_divergence')).toBe('42501');
    const erase = await admin.query('DELETE FROM settlement.integrity_divergence').then(() => 'accepted', (error: { message?: string }) => error.message ?? '');
    expect(erase).toMatch(/^SETTLEMENT_APPEND_ONLY/);
    expect((await admin.query<{ frozen: boolean }>('SELECT settlement.outgoing_frozen() AS frozen')).rows[0]).toEqual({ frozen: true });
  });
});

describe('D46 / D62 règlement marchand au back-office', () => {
  it('circuit complet à Douala : net calculé par la base, commission, instruction signée, exécution par une autre personne', async () => {
    await handedOver();
    const prepared = await post('/v1/backoffice/settlements', cookies.ops, { agreementId: GOAL, cityId: 'douala' });
    expect(prepared.status).toBe(201);
    const { payoutId, netXaf, commissionXaf } = prepared.body as { payoutId: string; netXaf: string; commissionXaf: string };
    expect({ netXaf, commissionXaf }).toEqual({ netXaf: '146250', commissionXaf: '3750' });
    expect((await post(`/v1/backoffice/settlements/${payoutId}/decision`, cookies.finOne, { decision: 'APPROVED', cityId: 'douala' })).status).toBe(200);
    expect((await post(`/v1/backoffice/settlements/${payoutId}/instruction`, cookies.finOne, { cityId: 'douala' })).status).toBe(201);
    expect((await post(`/v1/backoffice/settlements/${payoutId}/execution`, cookies.finOne, { outcome: 'EXECUTED', bankReference: 'ETAB-REG-1', cityId: 'douala' })).status).toBe(403);
    expect((await post(`/v1/backoffice/settlements/${payoutId}/execution`, cookies.finTwo, { outcome: 'EXECUTED', bankReference: 'ETAB-REG-1', cityId: 'douala' })).status).toBe(200);
    const types = await admin.query<{ operation_type: string }>(`SELECT operation_type FROM ledger.journal_entry WHERE operation_type IN ('FEE_CHARGED', 'SETTLEMENT_SENT') ORDER BY seq`);
    expect(types.rows.map((row) => row.operation_type)).toEqual(['FEE_CHARGED', 'SETTLEMENT_SENT']);
  });

  it('SEC-AUTHZ-001 (ABAC) : un agent de Yaoundé ne décide pas un règlement de Douala, ni en se déclarant à Douala', async () => {
    await handedOver();
    const prepared = await post('/v1/backoffice/settlements', cookies.ops, { agreementId: GOAL, cityId: 'douala' });
    const { payoutId } = prepared.body as { payoutId: string };
    const asYaounde = await post(`/v1/backoffice/settlements/${payoutId}/decision`, cookies.finYaounde, { decision: 'APPROVED', cityId: 'yaounde' });
    expect(asYaounde.status).toBe(403);
    const pretending = await post(`/v1/backoffice/settlements/${payoutId}/decision`, cookies.finYaounde, { decision: 'APPROVED', cityId: 'douala' });
    expect(pretending.status).toBe(403);
    expect((await admin.query('SELECT 1 FROM settlement.payout_decision')).rowCount).toBe(0);
  });
});
