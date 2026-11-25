import 'reflect-metadata';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
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
import { uuidv7 } from '../../src/modules/ledger/domain';
import { createAgreementC, PLAN_C, publishCommitmentLimits, seedCustomerAccount, seedPaymentPlan, validateLandlord } from './agreement-fixture';
import { TEST_PII_KEYS } from './pii-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { createStaffWithKey, loginOverHttp, STAFF_ORIGIN, STAFF_RP_TEST, staffCookie } from './staff-fixture';

/**
 * C19 / F-ACC-007 (tranche 1) : décès d'un client. Déclaration motivée avec
 * l'empreinte de l'acte de décès, décision par une AUTRE personne de la
 * conformité ; à l'approbation, dans la même transaction : compte bloqué
 * définitivement (canal DECEASED), appareils et sessions révoqués, objectifs
 * actifs gelés. HTTP réel, PostgreSQL réel, toutes les migrations.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['crm', 'kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const CUSTOMER = '019a9f00-0000-7000-8000-0000000000c1';
const OTHER_CUSTOMER = '019a9f00-0000-7000-8000-0000000000c2';
const GOAL_ACTIVE = '019a9f00-0000-7000-8000-0000000000a1';
const GOAL_DRAFT = '019a9f00-0000-7000-8000-0000000000a2';
const GOAL_OTHER = '019a9f00-0000-7000-8000-0000000000a3';
const CERTIFICATE = createHash('sha256').update('acte de décès synthétique').digest('hex');

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];
let cookies: Record<'support' | 'complianceA' | 'complianceB' | 'finance', string>;

function server(): Server {
  return app.getHttpServer() as Server;
}

function problem(response: { readonly status: number; readonly body: unknown }): [number, string | undefined] {
  return [response.status, (response.body as { code?: string }).code];
}

function declare(cookie: string, accountId: string, body: object, key = `decease-${uuidv7()}`): request.Test {
  return request(server()).post(`/v1/backoffice/customers/${accountId}/decease-cases`).set('Origin', STAFF_ORIGIN).set('Cookie', cookie).set('Idempotency-Key', key).send(body);
}

function decide(cookie: string, caseId: string, body: object, key = `decease-decision-${uuidv7()}`): request.Test {
  return request(server()).post(`/v1/backoffice/decease-cases/${caseId}/decision`).set('Origin', STAFF_ORIGIN).set('Cookie', cookie).set('Idempotency-Key', key).send(body);
}

const VALID = { deathDate: '2026-11-20', certificateSha256: CERTIFICATE, reason: 'Acte de décès présenté en agence par la famille' };

async function goalStatus(id: string): Promise<string | undefined> {
  return (await admin.query<{ status: string }>('SELECT status FROM agreements.agreement_state WHERE id = $1', [id])).rows[0]?.status;
}

async function account(id: string): Promise<{ status: string; block_channel: string | null }> {
  const row = (await admin.query<{ status: string; block_channel: string | null }>('SELECT status, block_channel FROM identity.account WHERE id = $1', [id])).rows[0];
  if (row === undefined) throw new Error('compte absent');
  return row;
}

async function seedDeviceAndSession(accountId: string): Promise<{ deviceId: string; sessionId: string }> {
  const { publicKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const deviceId = uuidv7();
  const sessionId = uuidv7();
  await admin.query(
    `INSERT INTO identity.device (id, account_id, public_key_pem, fingerprint, name, status, registered_at)
     VALUES ($1, $2, $3, $4, 'Tecno Spark', 'ACTIVE', now())`,
    [deviceId, accountId, pem, randomBytes(32)],
  );
  await admin.query(
    `INSERT INTO identity.session (id, account_id, device_id, access_token_hash, refresh_token_hash, access_issued_at, access_expires_at, refresh_expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, now(), now() + interval '10 minutes', now() + interval '1 day', now())`,
    [sessionId, accountId, deviceId, randomBytes(32), randomBytes(32)],
  );
  return { deviceId, sessionId };
}

async function auditActions(): Promise<string[]> {
  return (await admin.query<{ action: string }>(`SELECT action FROM audit.event WHERE event_type = 'BACKOFFICE_ACTION' ORDER BY seq`)).rows.map((row) => row.action);
}

beforeAll(async () => {
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ database, allowedOrigins: new Set([STAFF_ORIGIN]), staffRp: STAFF_RP_TEST, otpPepper: randomBytes(32), pinPepper: randomBytes(32), smsSender: null, piiKeys: TEST_PII_KEYS })],
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

beforeEach(async () => {
  for (const schema of SCHEMAS) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  for (const sql of migrations) await admin.query(sql);
  await publishCommitmentLimits(admin);
  await seedCustomerAccount(admin, CUSTOMER, 'BASIC');
  await seedCustomerAccount(admin, OTHER_CUSTOMER, 'BASIC');
  await admin.query('SET ROLE app_rw');
  try {
    await validateLandlord(admin, uuidv7());
    await seedPaymentPlan(admin, PLAN_C);
    await createAgreementC(admin, { id: GOAL_ACTIVE, customerId: CUSTOMER, active: true });
    await createAgreementC(admin, { id: GOAL_DRAFT, customerId: CUSTOMER, active: false });
    await createAgreementC(admin, { id: GOAL_OTHER, customerId: OTHER_CUSTOMER, active: true });
  } finally {
    await admin.query('RESET ROLE');
  }
  const result: Partial<typeof cookies> = {};
  for (const [slot, login, roles] of [
    ['support', 'sup.dla', ['SUPPORT_N2']],
    ['complianceA', 'comp.a', ['COMPLIANCE']],
    ['complianceB', 'comp.b', ['COMPLIANCE']],
    ['finance', 'fin.a', ['FINANCE']],
  ] as const) {
    const { key } = await createStaffWithKey(db.getConnectionUri(), { login, roles: [...roles], cityIds: ['douala'] });
    result[slot] = staffCookie(await loginOverHttp(server(), login, key, 1));
  }
  cookies = result as typeof cookies;
});

describe('F-ACC-007 — décès d’un client : déclaration, décision par une autre personne, gel', () => {
  it('déclaration seule : dossier en attente, rien n’est encore gelé ; audit sans donnée personnelle', async () => {
    const declared = await declare(cookies.support, CUSTOMER, VALID);
    expect(declared.status).toBe(201);
    expect(declared.body).toMatchObject({ accountId: CUSTOMER, status: 'PENDING' });
    expect(await account(CUSTOMER)).toMatchObject({ status: 'ACTIVE' });
    expect(await goalStatus(GOAL_ACTIVE)).toBe('ACTIVE');
    expect(await auditActions()).toEqual(['DECEASE_DECLARED']);
    const stored = (await admin.query<{ certificate_sha256: Buffer; death_date: string }>(`SELECT certificate_sha256, death_date::text FROM identity.decease_case`)).rows[0];
    expect(stored?.certificate_sha256.toString('hex')).toBe(CERTIFICATE);
    expect(stored?.death_date).toBe('2026-11-20');
  });

  it('approbation par une autre personne : compte bloqué (DECEASED), appareils et sessions révoqués, objectifs actifs gelés — et eux seuls', async () => {
    const { deviceId, sessionId } = await seedDeviceAndSession(CUSTOMER);
    const other = await seedDeviceAndSession(OTHER_CUSTOMER);
    const caseId = ((await declare(cookies.complianceA, CUSTOMER, VALID)).body as { caseId: string }).caseId;
    const decided = await decide(cookies.complianceB, caseId, { decision: 'APPROVED' });
    expect(decided.status).toBe(200);
    expect(decided.body).toEqual({ caseId, decision: 'APPROVED', frozenGoals: 1 });

    expect(await account(CUSTOMER)).toEqual({ status: 'BLOCKED', block_channel: 'DECEASED' });
    expect((await admin.query('SELECT status FROM identity.device WHERE id = $1', [deviceId])).rows[0]).toEqual({ status: 'REVOKED' });
    expect((await admin.query<{ revoked: boolean }>('SELECT revoked_at IS NOT NULL AS revoked FROM identity.session WHERE id = $1', [sessionId])).rows[0]?.revoked).toBe(true);
    expect(await goalStatus(GOAL_ACTIVE)).toBe('FROZEN');
    expect(await goalStatus(GOAL_DRAFT)).toBe('DRAFT');
    // Aucun effet sur un autre client.
    expect(await account(OTHER_CUSTOMER)).toMatchObject({ status: 'ACTIVE', block_channel: null });
    expect(await goalStatus(GOAL_OTHER)).toBe('ACTIVE');
    expect((await admin.query('SELECT status FROM identity.device WHERE id = $1', [other.deviceId])).rows[0]).toEqual({ status: 'ACTIVE' });
    // Le gel est tracé au nom du décideur.
    expect((await admin.query('SELECT actor_id FROM agreements.status_event WHERE agreement_id = $1 AND to_status = $2', [GOAL_ACTIVE, 'FROZEN'])).rows).toEqual([{ actor_id: 'comp.b' }]);
    expect(await auditActions()).toEqual(['DECEASE_DECLARED', 'DECEASE_DECIDED']);
  });

  it('refuse : le déclarant ne peut pas décider (MAKER_CANNOT_APPROVE, 403) — rien n’est gelé', async () => {
    const caseId = ((await declare(cookies.complianceA, CUSTOMER, VALID)).body as { caseId: string }).caseId;
    expect(problem(await decide(cookies.complianceA, caseId, { decision: 'APPROVED' }))).toEqual([403, 'MAKER_CANNOT_APPROVE']);
    expect(await account(CUSTOMER)).toMatchObject({ status: 'ACTIVE' });
    expect(await goalStatus(GOAL_ACTIVE)).toBe('ACTIVE');
  });

  it('refuse : rôles hors liste blanche (support : décision ; finance : déclaration) → ADMIN_FORBIDDEN', async () => {
    expect(problem(await declare(cookies.finance, CUSTOMER, VALID))).toEqual([403, 'ADMIN_FORBIDDEN']);
    const caseId = ((await declare(cookies.support, CUSTOMER, VALID)).body as { caseId: string }).caseId;
    expect(problem(await decide(cookies.support, caseId, { decision: 'APPROVED' }))).toEqual([403, 'ADMIN_FORBIDDEN']);
    expect(problem(await decide(cookies.finance, caseId, { decision: 'APPROVED' }))).toEqual([403, 'ADMIN_FORBIDDEN']);
    expect(await account(CUSTOMER)).toMatchObject({ status: 'ACTIVE' });
  });

  it('refuse : une seule décision par dossier ; un seul dossier ouvert ou approuvé par compte', async () => {
    const caseId = ((await declare(cookies.support, CUSTOMER, VALID)).body as { caseId: string }).caseId;
    expect(problem(await declare(cookies.complianceA, CUSTOMER, VALID))).toEqual([409, 'IDENTITY_DECEASE_CASE_EXISTS']);
    expect((await decide(cookies.complianceB, caseId, { decision: 'APPROVED' })).status).toBe(200);
    expect(problem(await decide(cookies.complianceA, caseId, { decision: 'REJECTED', reason: 'Erreur' }))).toEqual([409, 'IDENTITY_DECEASE_ALREADY_DECIDED']);
    expect(problem(await declare(cookies.complianceA, CUSTOMER, VALID))).toEqual([409, 'IDENTITY_DECEASE_CASE_EXISTS']);
  });

  it('rejet motivé : aucun effet, et une nouvelle déclaration redevient possible ; rejet sans motif refusé', async () => {
    const caseId = ((await declare(cookies.support, CUSTOMER, VALID)).body as { caseId: string }).caseId;
    expect(problem(await decide(cookies.complianceB, caseId, { decision: 'REJECTED' }))).toEqual([400, 'IDENTITY_INVALID_REQUEST']);
    const rejected = await decide(cookies.complianceB, caseId, { decision: 'REJECTED', reason: 'Acte illisible, homonyme' });
    expect(rejected.body).toEqual({ caseId, decision: 'REJECTED', frozenGoals: 0 });
    expect(await account(CUSTOMER)).toMatchObject({ status: 'ACTIVE' });
    expect(await goalStatus(GOAL_ACTIVE)).toBe('ACTIVE');
    expect((await declare(cookies.support, CUSTOMER, VALID)).status).toBe(201);
  });

  it('refuse : saisie invalide (date future, empreinte, champ non listé, compte inconnu)', async () => {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect(problem(await declare(cookies.support, CUSTOMER, { ...VALID, deathDate: tomorrow }))).toEqual([400, 'IDENTITY_INVALID_REQUEST']);
    expect(problem(await declare(cookies.support, CUSTOMER, { ...VALID, certificateSha256: 'abc' }))).toEqual([400, 'REQUEST_INVALID']);
    // Forme canonique du contrat : hexadécimal minuscule, 64 caractères exactement.
    expect(problem(await declare(cookies.support, CUSTOMER, { ...VALID, certificateSha256: CERTIFICATE.toUpperCase() }))).toEqual([400, 'REQUEST_INVALID']);
    expect(problem(await declare(cookies.support, CUSTOMER, { ...VALID, heirName: 'X' }))).toEqual([400, 'REQUEST_INVALID']);
    expect(problem(await declare(cookies.support, CUSTOMER, { ...VALID, reason: undefined }))).toEqual([400, 'REQUEST_INVALID']);
    expect(problem(await declare(cookies.support, '019a9f00-0000-7000-8000-0000000000ff', VALID))).toEqual([404, 'IDENTITY_ACCOUNT_NOT_FOUND']);
    expect(await auditActions()).toEqual([]);
  });

  it('base : dossiers en ajout seul ; aucune récupération ni changement d’état d’un compte décédé', async () => {
    const caseId = ((await declare(cookies.support, CUSTOMER, VALID)).body as { caseId: string }).caseId;
    await decide(cookies.complianceB, caseId, { decision: 'APPROVED' });
    await expect(admin.query(`UPDATE identity.decease_case SET reason = 'x'`)).rejects.toThrow(/IDENTITY_APPEND_ONLY/);
    await expect(admin.query('DELETE FROM identity.decease_decision')).rejects.toThrow(/IDENTITY_APPEND_ONLY/);
    await expect(admin.query('TRUNCATE identity.decease_case CASCADE')).rejects.toThrow(/IDENTITY_APPEND_ONLY/);
    await expect(admin.query(`UPDATE identity.account SET status = 'ACTIVE', block_channel = NULL, blocked_at = NULL, block_reason = NULL WHERE id = $1`, [CUSTOMER])).rejects.toThrow(/IDENTITY_ACCOUNT_DECEASED/);
    await expect(admin.query(
      `INSERT INTO identity.recovery (id, account_id, old_phone, new_phone, method, requested_at, available_at, had_balance, status)
       SELECT $1, id, phone, $2, 'KYC_STRONG', now(), now(), true, 'PENDING' FROM identity.account WHERE id = $3`,
      [uuidv7(), 'b'.repeat(64), CUSTOMER],
    )).rejects.toThrow(/IDENTITY_ACCOUNT_DECEASED/);
    // Le blocage par le support d'un autre compte reste possible (la garde ne vise que le compte décédé).
    await expect(admin.query(`SELECT identity.block_account_by_support($1, 'Téléphone volé')`, [OTHER_CUSTOMER])).resolves.toBeDefined();
  });
});
