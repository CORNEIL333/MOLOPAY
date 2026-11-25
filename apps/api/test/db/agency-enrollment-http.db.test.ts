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
import { createDatabase, type Database } from '../../src/http/database';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { seedCustomerAccount } from './agreement-fixture';
import { revealPhone } from '../../src/modules/identity/phone-key';
import { protectedPhone, TEST_PII_KEYS } from './pii-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { createStaffWithKey, loginOverHttp, STAFF_ORIGIN, STAFF_RP_TEST, staffCookie } from './staff-fixture';

/**
 * C13 / F-ACC-001 : inscription en agence sans SMS (décision du fondateur du
 * 24 novembre). HTTP réel, PostgreSQL réel, toutes les migrations ; aucun
 * prestataire SMS n'est configuré : le code passe de l'agent au client.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const ORIGIN = 'https://app.molopay.test';
const OTP_PEPPER = randomBytes(32);
const PIN_PEPPER = randomBytes(32);
const PHONE = '+237690123456';

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];
let cookies: Record<'support' | 'supportYaounde' | 'ops', string>;

function server(): Server {
  return app.getHttpServer() as Server;
}

function problem(response: { readonly status: number; readonly body: unknown }): [number, string | undefined] {
  return [response.status, (response.body as { code?: string }).code];
}

function enroll(cookie: string, body: object, key = `agency-${uuidv7()}`): request.Test {
  return request(server()).post('/v1/backoffice/agency-enrollments').set('Origin', STAFF_ORIGIN).set('Cookie', cookie).set('Idempotency-Key', key).send(body);
}

function signup(challengeId: string, code: string): request.Test {
  const { publicKey } = generateKeyPairSync('ed25519');
  return request(server()).post('/v1/auth/signups').set('Origin', ORIGIN).set('Idempotency-Key', `signup-${uuidv7()}`).send({
    challengeId, code, pin: '284917', devicePublicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), deviceName: 'Tecno Spark', acceptTermsVersion: '2026-10-26-v1',
  });
}

beforeAll(async () => {
  migrations = readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort().map((file) => readFileSync(resolve(DIRECTORY, file), 'utf8'));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ database, allowedOrigins: new Set([ORIGIN, STAFF_ORIGIN]), staffRp: STAFF_RP_TEST, otpPepper: OTP_PEPPER, pinPepper: PIN_PEPPER, smsSender: null, piiKeys: TEST_PII_KEYS })],
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
  const result: Partial<typeof cookies> = {};
  for (const [slot, login, roles, cityIds] of [
    ['support', 'sup.dla', ['SUPPORT_N1'], ['douala']],
    ['supportYaounde', 'sup.yde', ['SUPPORT_N2'], ['yaounde']],
    ['ops', 'ops.dla', ['OPERATIONS'], ['douala']],
  ] as const) {
    const { key } = await createStaffWithKey(db.getConnectionUri(), { login, roles: [...roles], cityIds: [...cityIds] });
    result[slot] = staffCookie(await loginOverHttp(server(), login, key, 1));
  }
  cookies = result as typeof cookies;
});

describe('C13 / F-ACC-001 inscription en agence, sans SMS', () => {
  it('l’agent émet un code après vérification en personne ; le client termine l’inscription sur son appareil ; audit sans numéro', async () => {
    const issued = await enroll(cookies.support, { phone: PHONE, documentType: 'CNI', cityId: 'douala' });
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);
    expect(issued.headers['cache-control']).toBe('private, no-store');
    const body = issued.body as { challengeId: string; code: string | null; expiresAt: string };
    expect(body.code).toMatch(/^[0-9]{6}$/);
    const created = await signup(body.challengeId, body.code ?? '');
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await admin.query('SELECT phone, phone_masked FROM identity.account')).rows).toEqual([{ phone: (await protectedPhone(PHONE)).key, phone_masked: '+237•••••••56' }]);
    expect((await admin.query('SELECT staff_id, city_id, document_type FROM identity.agency_enrollment')).rows).toEqual([{ staff_id: 'sup.dla', city_id: 'douala', document_type: 'CNI' }]);
    const audit = (await admin.query<{ action: string; actor_id: string; refs: string }>(
      `SELECT action, actor_id, refs::text AS refs FROM audit.event WHERE action = 'AGENCY_ENROLLMENT_ISSUED'`,
    )).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'AGENCY_ENROLLMENT_ISSUED', actor_id: 'sup.dla' });
    expect(audit[0]?.refs).not.toContain('690123456');
    expect(audit[0]?.refs).not.toContain(body.code ?? 'x');
  });

  it('rejeu de la même requête : même défi, code jamais redonné ni conservé en clair', async () => {
    const first = await enroll(cookies.support, { phone: PHONE, documentType: 'PASSPORT', cityId: 'douala' }, 'agency-replay-cle-0001');
    const again = await enroll(cookies.support, { phone: PHONE, documentType: 'PASSPORT', cityId: 'douala' }, 'agency-replay-cle-0001');
    const code = (first.body as { code: string }).code;
    expect(again.status).toBe(201);
    expect(again.body).toEqual({ ...(first.body as object), code: null });
    const stored = await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM api.idempotency_record WHERE response_body::text LIKE $1`, [`%${code}%`]);
    expect(stored.rows[0]).toEqual({ n: 0 });
  });

  it('refus : rôle sans droit, ville hors périmètre, numéro déjà inscrit, pièce ou champ non autorisés', async () => {
    expect(problem(await enroll(cookies.ops, { phone: PHONE, documentType: 'CNI', cityId: 'douala' }))).toEqual([403, 'ADMIN_FORBIDDEN']);
    expect(problem(await enroll(cookies.supportYaounde, { phone: PHONE, documentType: 'CNI', cityId: 'douala' }))).toEqual([403, 'ADMIN_SCOPE_DENIED']);
    await seedCustomerAccount(admin, '019ab900-0000-7000-8000-0000000000e1', 'NONE');
    const row = (await admin.query<{ phone: string; phone_ciphertext: string }>('SELECT phone, phone_ciphertext FROM identity.account')).rows[0];
    const existing = await revealPhone({ key: row?.phone ?? '', ciphertext: row?.phone_ciphertext ?? '' }, TEST_PII_KEYS);
    expect(problem(await enroll(cookies.support, { phone: existing, documentType: 'CNI', cityId: 'douala' }))).toEqual([409, 'IDENTITY_ACCOUNT_EXISTS']);
    expect(problem(await enroll(cookies.support, { phone: PHONE, documentType: 'PERMIS', cityId: 'douala' }))).toEqual([400, 'REQUEST_INVALID']);
    expect(problem(await enroll(cookies.support, { phone: PHONE, documentType: 'CNI', cityId: 'douala', documentNumber: '123' }))).toEqual([400, 'REQUEST_INVALID']);
    expect((await admin.query('SELECT count(*)::int AS n FROM identity.agency_enrollment')).rows[0]).toEqual({ n: 0 });
  });

  it('base garante : code ancien ou d’un autre objet refusé ; 30 codes par agent sur 24 heures ; ajout seul', async () => {
    const issued = (await enroll(cookies.support, { phone: PHONE, documentType: 'CNI', cityId: 'douala' })).body as { challengeId: string };
    const insert = (challengeId: string): Promise<string> => admin.query('BEGIN')
      .then(() => admin.query('SET LOCAL ROLE app_rw'))
      .then(() => admin.query(`INSERT INTO identity.agency_enrollment (challenge_id, staff_id, city_id, document_type, issued_at) VALUES ($1, 'sup.dla', 'douala', 'CNI', now())`, [challengeId]))
      .then(() => 'accepted', (error: { message?: string }) => error.message ?? '')
      .finally(() => admin.query('ROLLBACK'));
    // Déjà rattaché (clé primaire) ; inconnu.
    expect(await insert(issued.challengeId)).toMatch(/^IDENTITY_INVALID_REQUEST|duplicate key/);
    expect(await insert(uuidv7())).toMatch(/^IDENTITY_INVALID_REQUEST/);
    // Code d'un autre objet, ancien ou déjà utilisé : refusé (posé par le superutilisateur, test seulement).
    const extra = await protectedPhone('+237690555555');
    const otp = async (purpose: string, age: string, consumed: boolean): Promise<string> => {
      const id = uuidv7();
      await admin.query(
        `INSERT INTO identity.otp_challenge (id, phone, purpose, binding, code_hash, expires_at, attempts_remaining, consumed_at, created_at, phone_ciphertext, phone_masked)
         VALUES ($1, $6, $2, 'x', $3, now() + interval '5 minutes', 5, CASE WHEN $4 THEN now() END, now() - $5::interval, $7, $8)`,
        [id, purpose, randomBytes(32), consumed, age, extra.key, extra.ciphertext, extra.masked],
      );
      return id;
    };
    expect(await insert(await otp('NEW_DEVICE', '0 seconds', false))).toMatch(/^IDENTITY_INVALID_REQUEST/);
    expect(await insert(await otp('SIGNUP', '2 minutes', false))).toMatch(/^IDENTITY_INVALID_REQUEST/);
    expect(await insert(await otp('SIGNUP', '0 seconds', true))).toMatch(/^IDENTITY_INVALID_REQUEST/);
    // Horodatage posé par la base, jamais par l'appelant.
    const fresh = await otp('SIGNUP', '0 seconds', false);
    await admin.query('BEGIN');
    await admin.query('SET LOCAL ROLE app_rw');
    await admin.query(`INSERT INTO identity.agency_enrollment (challenge_id, staff_id, city_id, document_type, issued_at) VALUES ($1, 'sup.autre', 'douala', 'CNI', '2000-01-01T00:00:00Z')`, [fresh]);
    await admin.query('COMMIT');
    expect((await admin.query(`SELECT issued_at > now() - interval '1 minute' AS recent FROM identity.agency_enrollment WHERE challenge_id = $1`, [fresh])).rows[0]).toEqual({ recent: true });
    // Quota : 29 de plus passent (30 au total), le 31e est refusé.
    for (let index = 0; index < 29; index += 1) {
      const phone = `+2376901${String(index).padStart(5, '0')}`;
      expect((await enroll(cookies.support, { phone, documentType: 'CNI', cityId: 'douala' })).status).toBe(201);
    }
    expect(problem(await enroll(cookies.support, { phone: '+237690199999', documentType: 'CNI', cityId: 'douala' }))).toEqual([429, 'REQUEST_RATE_LIMITED']);
    const erase = await admin.query('DELETE FROM identity.agency_enrollment').then(() => 'accepted', (error: { message?: string }) => error.message ?? '');
    expect(erase).toMatch(/^IDENTITY_APPEND_ONLY/);
  });
});
