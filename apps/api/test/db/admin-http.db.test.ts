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
import { createDatabase, withTransaction, type Database } from '../../src/http/database';
import { createStaffPayload, grantRolesPayload, registerStaffCredential, resolveStaffPrincipal } from '../../src/modules/admin/staff.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { startTestDatabase, type TestDatabase } from './harness';
import { createStaffWithKey, loginOverHttp, STAFF_ORIGIN, STAFF_RP_TEST, staffCookie, type StaffKey } from './staff-fixture';

/** SEC-AUTHZ-003 / D62 : administration du back-office en HTTP réel (comptes, rôles, enrôlement, paramètres). */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];
let cookies: Record<'techOne' | 'techTwo' | 'finOne' | 'finTwo', string>;

function server(): Server {
  return app.getHttpServer() as Server;
}

function post(path: string, cookie: string, body: object, key = `bo-${uuidv7()}`): request.Test {
  return request(server()).post(path).set('Origin', STAFF_ORIGIN).set('Cookie', cookie).set('Idempotency-Key', key).send(body);
}

async function approvedRequest(kind: 'ROLE_GRANT' | 'FINANCIAL_SETTING', payload: object, maker: string, checker: string): Promise<string> {
  const id = uuidv7();
  const prepared = await post('/v1/backoffice/admin/approvals', maker, { id, kind, payload, reason: 'Demande de test' });
  expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
  const decided = await post(`/v1/backoffice/admin/approvals/${id}/decision`, checker, { decision: 'APPROVED' });
  expect(decided.status, JSON.stringify(decided.body)).toBe(200);
  return id;
}

beforeAll(async () => {
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set([STAFF_ORIGIN]), staffRp: STAFF_RP_TEST })] }).compile();
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
  const uri = db.getConnectionUri();
  const agents = [
    ['techOne', 'tech.un', ['TECH_ADMIN']],
    ['techTwo', 'tech.deux', ['TECH_ADMIN']],
    ['finOne', 'fin.un', ['FINANCE']],
    ['finTwo', 'fin.deux', ['FINANCE']],
  ] as const;
  const result: Partial<typeof cookies> = {};
  for (const [slot, login, roles] of agents) {
    const { key } = await createStaffWithKey(uri, { login, roles: [...roles] });
    result[slot] = staffCookie(await loginOverHttp(server(), login, key, 1));
  }
  cookies = result as typeof cookies;
});

describe('SEC-AUTHZ-003 arrivée d’un agent entièrement par HTTP', () => {
  it('compte et rôles approuvés par un second administrateur, jeton d’enrôlement rendu une fois, connexion de l’agent', async () => {
    const staffId = uuidv7();
    const createRequest = await approvedRequest('ROLE_GRANT', createStaffPayload(staffId, 'awa.support'), cookies.techOne, cookies.techTwo);
    expect((await post('/v1/backoffice/admin/staff', cookies.techOne, { staffId, login: 'awa.support', approvalRequestId: createRequest })).status).toBe(201);
    const grant = { staffId, roles: ['SUPPORT_N2'] as const, cityIds: ['douala'], maxAmountXaf: null };
    const grantRequest = await approvedRequest('ROLE_GRANT', grantRolesPayload({ ...grant, roles: [...grant.roles] }), cookies.techOne, cookies.techTwo);
    expect(
      (await post(`/v1/backoffice/admin/staff/${staffId}/roles`, cookies.techOne, { roles: ['SUPPORT_N2'], cityIds: ['douala'], maxAmountXaf: null, approvalRequestId: grantRequest })).status,
    ).toBe(201);
    const enrollment = await post(`/v1/backoffice/admin/staff/${staffId}/enrollments`, cookies.techOne, {}, 'bo-enroll-replay-0001');
    expect(enrollment.status).toBe(201);
    const issued = enrollment.body as { challengeId: string; challenge: string; enrollmentToken: string };
    expect(issued.enrollmentToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const replay = await post(`/v1/backoffice/admin/staff/${staffId}/enrollments`, cookies.techOne, {}, 'bo-enroll-replay-0001');
    expect(replay.body).not.toHaveProperty('enrollmentToken');
    const stored = await admin.query<{ body: string }>("SELECT response_body::text AS body FROM api.idempotency_record WHERE scope LIKE 'bo-staff-enroll:%'");
    expect(stored.rows[0]?.body).not.toContain(issued.enrollmentToken);
    // L'agent enrôle sa clé avec le jeton remis, puis se connecte.
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const key: StaffKey = { privateKey: pair.privateKey, spki: pair.publicKey.export({ type: 'spki', format: 'der' }), credentialId: randomBytes(32) };
    const counter = Buffer.alloc(4);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(32);
    await withTransaction(database, (client) =>
      registerStaffCredential(client, {
        rp: STAFF_RP_TEST,
        challengeId: issued.challengeId,
        enrollmentToken: issued.enrollmentToken,
        clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: issued.challenge, origin: STAFF_ORIGIN, crossOrigin: false })),
        authenticatorData: Buffer.concat([createHash('sha256').update(STAFF_RP_TEST.rpId).digest(), Buffer.from([0x45]), counter, Buffer.alloc(16), length, key.credentialId, Buffer.from([0xa0])]),
        credentialId: key.credentialId,
        publicKeySpki: key.spki,
      }),
    );
    const login = await loginOverHttp(server(), 'awa.support', key, 1);
    expect(login.status).toBe(201);
    const principal = await withTransaction(database, (client) => resolveStaffPrincipal(client, staffCookie(login).split('=')[1] ?? ''));
    expect(principal).toEqual({ actorId: 'awa.support', roles: ['SUPPORT_N2'], cityIds: ['douala'] });
  });

  it('I-7 un administrateur n’approuve pas sa propre demande ; la finance ne crée pas de compte', async () => {
    const id = uuidv7();
    expect((await post('/v1/backoffice/admin/approvals', cookies.techOne, { id, kind: 'ROLE_GRANT', payload: createStaffPayload(uuidv7(), 'x.agent'), reason: 'test' })).status).toBe(201);
    expect((await post(`/v1/backoffice/admin/approvals/${id}/decision`, cookies.techOne, { decision: 'APPROVED' })).status).toBe(403);
    expect((await post('/v1/backoffice/admin/staff', cookies.finOne, { staffId: uuidv7(), login: 'y.agent', approvalRequestId: id })).status).toBe(403);
    expect((await post('/v1/backoffice/admin/approvals', cookies.finOne, { id: uuidv7(), kind: 'ROLE_GRANT', payload: createStaffPayload(uuidv7(), 'z.agent'), reason: 'test' })).status).toBe(403);
  });

  it('élévation de privilège refusée : rôles différents de la demande approuvée', async () => {
    const staffId = uuidv7();
    const createRequest = await approvedRequest('ROLE_GRANT', createStaffPayload(staffId, 'b.agent'), cookies.techOne, cookies.techTwo);
    await post('/v1/backoffice/admin/staff', cookies.techOne, { staffId, login: 'b.agent', approvalRequestId: createRequest });
    const grantRequest = await approvedRequest('ROLE_GRANT', grantRolesPayload({ staffId, roles: ['SUPPORT_N1'], cityIds: [], maxAmountXaf: null }), cookies.techOne, cookies.techTwo);
    const escalated = await post(`/v1/backoffice/admin/staff/${staffId}/roles`, cookies.techOne, { roles: ['TECH_ADMIN'], cityIds: [], maxAmountXaf: null, approvalRequestId: grantRequest });
    expect(escalated.status).toBe(400);
    expect((await admin.query('SELECT 1 FROM admin.staff_role_grant WHERE staff_id = $1', [staffId])).rowCount).toBe(0);
  });

  it('désactivation motivée : l’agent perd immédiatement l’accès', async () => {
    const staffId = (await admin.query<{ id: string }>("SELECT id FROM admin.staff_account WHERE login = 'fin.deux'")).rows[0]!.id;
    expect((await post(`/v1/backoffice/admin/staff/${staffId}/disable`, cookies.techOne, { reason: 'départ de l’entreprise' })).status).toBe(200);
    const after = await request(server()).get('/v1/backoffice/queue').query({ reason: 'contrôle' }).set('Cookie', cookies.finTwo);
    expect(after.status).toBe(401);
  });
});

describe('D46 / D53 paramètres financiers publiés par HTTP en maker-checker', () => {
  it('préparé par une personne de la finance, approuvé par une autre, publié par le préparateur seulement', async () => {
    const payload = { key: 'merchant_commission_bps', value: 250 };
    const requestId = await approvedRequest('FINANCIAL_SETTING', payload, cookies.finOne, cookies.finTwo);
    const byOther = await post('/v1/backoffice/admin/settings', cookies.finTwo, { ...payload, approvalRequestId: requestId });
    expect(byOther.status).toBe(400);
    const tampered = await post('/v1/backoffice/admin/settings', cookies.finOne, { key: 'merchant_commission_bps', value: 9999, approvalRequestId: requestId });
    expect(tampered.status).toBe(400);
    const published = await post('/v1/backoffice/admin/settings', cookies.finOne, { ...payload, approvalRequestId: requestId });
    expect(published.status).toBe(201);
    expect(published.body).toEqual({ key: 'merchant_commission_bps', version: 1 });
  });
});
