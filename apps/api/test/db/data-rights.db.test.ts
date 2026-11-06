import 'reflect-metadata';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { createDatabase, type Database } from '../../src/http/database';
import { issueSessionTokens } from '../../src/modules/identity/domain';
import { sessionCookieValue } from '../../src/modules/identity/session.store';
import { startTestDatabase, type TestDatabase } from './harness';

const A = '019a9600-0000-7000-8000-000000000001';
const B = '019a9600-0000-7000-8000-000000000002';
const DEVICE = '019a9600-0000-7000-8000-000000000011';
const FOREIGN_DEVICE = '019a9600-0000-7000-8000-000000000012';
const SESSION = '019a9600-0000-7000-8000-000000000021';
const FOREIGN_SESSION = '019a9600-0000-7000-8000-000000000022';
const ORIGIN = 'https://app.example.test';
const ROOT = '/v1/me/data-rights';
let db: TestDatabase; let admin: Client; let database: Database; let app: INestApplication;
let migrations: string[]; let cookie: string; let foreignCookie: string;
type Receipt = { requestId: string; kind: string; status: string; receivedAt: string };
type History = { items: Receipt[]; nextBefore: string | null; asOf: string };
function server(): Server { return app.getHttpServer() as Server; }
function command(kind = 'ACCESS', key = 'data-rights-command-0001', auth = cookie): ReturnType<ReturnType<typeof request>['post']> {
  return request(server()).post(ROOT).set('Origin', ORIGIN).set('Cookie', auth).set('Idempotency-Key', key).send({ kind });
}
function history(auth = cookie, query = ''): ReturnType<ReturnType<typeof request>['get']> { return request(server()).get(ROOT + query).set('Cookie', auth); }
beforeAll(async () => {
  migrations = await Promise.all(['0002_audit.sql','0004_identity.sql','0005_audit_metadata.sql','0007_identity_clock.sql',
    '0017_api_idempotency.sql','0023_identity_account_security.sql','0024_identity_data_rights.sql','0025_identity_customer_quota.sql'].map((name) => readFile(resolve('db/migrations', name), 'utf8')));
  db = await startTestDatabase(); admin = new Client({ connectionString: db.getConnectionUri() }); await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const module = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set([ORIGIN]) })] }).compile();
  app = module.createNestApplication({ logger: false }); await app.init();
});
afterAll(async () => { await app?.close(); await database?.pool.end(); await admin?.end(); await db?.stop(); });
beforeEach(async () => {
  for (const schema of ['identity', 'audit', 'api']) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  for (const sql of migrations) await admin.query(sql);
  await admin.query(`INSERT INTO identity.customer_quota_policy(action,version,window_seconds,account_limit,device_limit)
    SELECT action,1,60,100000,100000 FROM unnest(ARRAY['SECURITY_READ','REVOKE_OTHERS','DATA_RIGHTS_READ','DATA_RIGHTS_SUBMIT']) AS action`);
  await admin.query("INSERT INTO identity.account(id,phone,phone_verified_at) VALUES ($1,'+237612350001',now()),($2,'+237612350002',now())", [A, B]);
  const cookies: string[] = [];
  for (const [account, device, session] of [[A, DEVICE, SESSION], [B, FOREIGN_DEVICE, FOREIGN_SESSION]]) {
    const publicKey = generateKeyPairSync('ed25519').publicKey;
    await admin.query(`INSERT INTO identity.device (id,account_id,public_key_pem,fingerprint,name,status,registered_at)
      VALUES ($1,$2,$3,$4,'Appareil test','ACTIVE',now())`, [device, account, publicKey.export({ type: 'spki', format: 'pem' }),
      createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest()]);
    const issued = issueSessionTokens();
    await admin.query(`INSERT INTO identity.session
      (id,account_id,device_id,access_token_hash,refresh_token_hash,access_issued_at,access_expires_at,refresh_expires_at,created_at)
      VALUES ($1,$2,$3,$4,$5,now()-interval '5 minutes',now()+interval '10 minutes',now()+interval '1 day',now()-interval '5 minutes')`,
    [session, account, device, issued.accessTokenHash, issued.refreshTokenHash]);
    cookies.push(`client_session=${sessionCookieValue(session!, issued.accessToken)}`);
  }
  [cookie, foreignCookie] = cookies as [string, string];
});
describe('F-ACC-005 · registre réel des demandes de droits', () => {
  it('enregistre chaque type avec reçu serveur, sans toucher les données du compte', async () => {
    for (const kind of ['ACCESS', 'RECTIFICATION', 'OBJECTION', 'ERASURE']) {
      const response = await command(kind, `data-rights-create-${kind}`).expect(201);
      const receipt = response.body as Receipt;
      expect(receipt).toEqual({ requestId: expect.stringMatching(/^[0-9a-f-]{14}7[0-9a-f-]{21}$/) as unknown, kind, status: 'RECEIVED', receivedAt: expect.any(String) as unknown });
      expect(Number.isFinite(Date.parse(receipt.receivedAt))).toBe(true);
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
    expect((await admin.query('SELECT status,phone FROM identity.account WHERE id=$1', [A])).rows[0]).toEqual({ status: 'ACTIVE', phone: '+237612350001' });
    expect((await admin.query('SELECT action FROM audit.event')).rows).toEqual(Array.from({ length: 4 }, () => ({ action: 'DATA_RIGHTS_REQUESTED' })));
  });
  it('cinq envois concurrents même clé : une demande, un audit, un reçu identique', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => command().expect(201)));
    for (const response of results) expect(response.body).toEqual(results[0]!.body);
    expect((await admin.query('SELECT count(*)::integer AS n FROM identity.data_right_request')).rows[0]).toEqual({ n: 1 });
    expect((await admin.query('SELECT count(*)::integer AS n FROM audit.event')).rows[0]).toEqual({ n: 1 });
    expect((await command('ERASURE').expect(409)).body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await command('ACCESS', 'data-rights-command-0001', foreignCookie).expect(201);
  });
  it('historique limité au compte ; curseur inconnu et étranger identiquement refusés', async () => {
    const own = (await command().expect(201)).body as Receipt;
    const foreign = (await command('ERASURE', 'data-rights-foreign-0001', foreignCookie).expect(201)).body as Receipt;
    const response = await history().expect(200);
    expect((response.body as History).items).toEqual([own]);
    expect((response.body as History).nextBefore).toBeNull();
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(response.body)).not.toMatch(/accountId|sessionId|phone|token|23761235/);
    for (const cursor of [foreign.requestId, '019a9600-0000-7000-8000-000000000099']) {
      expect((await history(cookie, `?before=${cursor}`).expect(400)).body).toMatchObject({ code: 'REQUEST_INVALID' });
    }
  });
  it('refuse corps/champs/filtre, origine, clé et session invalides avec code exact', async () => {
    for (const body of [{ kind: 'OTHER' }, { kind: 'ACCESS', accountId: B }, { kind: 'ERASURE', receivedAt: '2020-01-01' }, { kind: 'ACCESS', status: 'COMPLETED' }, {}]) {
      expect((await request(server()).post(ROOT).set('Cookie', cookie).set('Origin', ORIGIN).set('Idempotency-Key', 'rights-invalid-command').send(body).expect(400)).body).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    expect((await command().query({ accountId: B }).expect(400)).body).toMatchObject({ code: 'REQUEST_INVALID' });
    expect((await history(cookie, '?before=bad').expect(400)).body).toMatchObject({ code: 'REQUEST_INVALID' });
    expect((await history(cookie, '?accountId=x').expect(400)).body).toMatchObject({ code: 'REQUEST_INVALID' });
    expect((await request(server()).post(ROOT).set('Cookie', cookie).send({ kind: 'ACCESS' }).expect(403)).body).toMatchObject({ code: 'ORIGIN_FORBIDDEN' });
    expect((await request(server()).post(ROOT).set('Cookie', cookie).set('Origin', ORIGIN).send({ kind: 'ACCESS' }).expect(400)).body).toMatchObject({ code: 'REQUEST_INVALID' });
    expect((await request(server()).get(ROOT).expect(401)).body).toMatchObject({ code: 'IDENTITY_SESSION_INVALID' });
    expect((await admin.query('SELECT count(*)::integer AS n FROM api.idempotency_record')).rows[0]).toEqual({ n: 0 });
  });
  it('pagine sans trou ni doublon même avec 103 dates identiques ; borne aussi en SQL', async () => {
    await admin.query(`INSERT INTO identity.data_right_request(id,account_id,session_id,kind,received_at)
      SELECT ('019a9600-0000-7000-8000-'||lpad(i::text,12,'0'))::uuid,$1,$2,'ACCESS',now()-interval '1 day' FROM generate_series(100,202) i`, [A, SESSION]);
    const all: string[] = []; let cursor: string | null = null;
    do {
      const response = await history(cookie, cursor === null ? '' : `?before=${cursor}`).expect(200);
      const page = response.body as History;
      expect(page.items.length).toBeLessThanOrEqual(50);
      all.push(...page.items.map((item) => item.requestId)); cursor = page.nextBefore;
    } while (cursor !== null && all.length < 200);
    expect(all).toHaveLength(103); expect(new Set(all).size).toBe(103);
    expect(all).toEqual([...all].sort().reverse());
    await admin.query('SET ROLE app_ro');
    try { expect((await admin.query('SELECT * FROM identity.list_data_rights($1,$2,$3,NULL)', [A, DEVICE, SESSION])).rows).toHaveLength(51); }
    finally { await admin.query('RESET ROLE'); }
  });
  it('aucun accès SQL brut ni commande de mutation, même UPDATE/DELETE/TRUNCATE propriétaire refusés', async () => {
    await command().expect(201);
    for (const role of ['app_rw', 'app_ro']) {
      await admin.query(`SET ROLE ${role}`);
      try {
        for (const sql of ['SELECT * FROM identity.data_right_request', 'DELETE FROM identity.data_right_request',
          "UPDATE identity.data_right_request SET kind='ERASURE'", 'TRUNCATE identity.data_right_request',
          `INSERT INTO identity.data_right_request(id,account_id,session_id,kind) VALUES ('${A}','${A}','${SESSION}','ACCESS')`]) {
          await expect(admin.query(sql)).rejects.toMatchObject({ code: '42501' });
        }
        if (role === 'app_ro') await expect(admin.query('SELECT * FROM identity.submit_data_right($1,$2,$3,$4,$5)', [A, DEVICE, SESSION, A, 'ACCESS'])).rejects.toMatchObject({ code: '42501' });
      } finally { await admin.query('RESET ROLE'); }
    }
    for (const sql of ["UPDATE identity.data_right_request SET kind='ERASURE'", 'DELETE FROM identity.data_right_request', 'TRUNCATE identity.data_right_request']) {
      await expect(admin.query(sql)).rejects.toMatchObject({ code: 'P0001', message: expect.stringMatching(/^DATA_RIGHTS_APPEND_ONLY:/) as unknown });
    }
  });
  it('fonctions SQL refusent contexte étranger, type inconnu et curseur étranger', async () => {
    const foreign = (await command('ACCESS', 'rights-foreign-cursor-01', foreignCookie).expect(201)).body as Receipt;
    await admin.query('SET ROLE app_rw');
    try {
      for (const args of [[B, DEVICE, SESSION], [A, FOREIGN_DEVICE, SESSION], [A, DEVICE, FOREIGN_SESSION]]) {
        await expect(admin.query('SELECT * FROM identity.submit_data_right($1,$2,$3,$4,$5)', [...args, A, 'ACCESS']))
          .rejects.toMatchObject({ code: 'P0001', message: expect.stringMatching(/^IDENTITY_SESSION_INVALID:/) as unknown });
        await expect(admin.query('SELECT * FROM identity.list_data_rights($1,$2,$3,NULL)', args))
          .rejects.toMatchObject({ code: 'P0001', message: expect.stringMatching(/^IDENTITY_SESSION_INVALID:/) as unknown });
      }
      await expect(admin.query('SELECT * FROM identity.submit_data_right($1,$2,$3,$4,$5)', [A, DEVICE, SESSION, A, 'OTHER']))
        .rejects.toMatchObject({ code: 'P0001', message: expect.stringMatching(/^REQUEST_INVALID:/) as unknown });
      await expect(admin.query('SELECT * FROM identity.list_data_rights($1,$2,$3,$4)', [A, DEVICE, SESSION, foreign.requestId]))
        .rejects.toMatchObject({ code: 'P0001', message: expect.stringMatching(/^REQUEST_INVALID:/) as unknown });
    } finally { await admin.query('RESET ROLE'); }
  });
  it('audit refusé après INSERT atteint : demande et clé annulées ensemble', async () => {
    await admin.query(`CREATE SEQUENCE audit.rights_failure_probe;
      CREATE FUNCTION audit.reject_rights_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM identity.data_right_request WHERE id=NEW.target_id::uuid)
          OR NOT EXISTS(SELECT 1 FROM api.idempotency_record WHERE response_status IS NULL) THEN RAISE EXCEPTION 'TEST_MISSING_WRITE'; END IF;
        PERFORM nextval('audit.rights_failure_probe'); RAISE EXCEPTION 'TEST_AUDIT_REFUSED';
      END $$;
      CREATE TRIGGER rights_failure BEFORE INSERT ON audit.event FOR EACH ROW EXECUTE FUNCTION audit.reject_rights_write()`);
    expect((await command().expect(500)).body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect((await admin.query('SELECT is_called FROM audit.rights_failure_probe')).rows[0]).toEqual({ is_called: true });
    for (const table of ['identity.data_right_request', 'api.idempotency_record', 'audit.event']) {
      expect((await admin.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0]).toEqual({ n: 0 });
    }
  });
  for (const operation of ['GET', 'POST', 'REPLAY'] as const) {
    for (const change of ['ROTATE', 'REVOKE', 'EXPIRE', 'BLOCK'] as const) {
      it(`${operation} attend le verrou puis refuse ${change} sans écrire ni exposer le reçu`, async () => {
        if (operation === 'REPLAY') await command().expect(201);
        const blocker = new Client({ connectionString: db.getConnectionUri() }); await blocker.connect();
        try {
          await blocker.query('BEGIN'); await blocker.query('SELECT id FROM identity.account WHERE id=$1 FOR UPDATE', [A]);
          const pending = (operation === 'GET' ? history() : command()).then((response) => response);
          let waiting = false;
          for (let i = 0; i < 100 && !waiting; i++) {
            waiting = (await admin.query<{ waiting: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock'
              AND pid<>pg_backend_pid() AND (query LIKE '%identity.lock_security_actor%' OR query LIKE '%identity.list_data_rights%')) AS waiting`)).rows[0]!.waiting;
            if (!waiting) await admin.query('SELECT pg_sleep(0.01)');
          }
          expect(waiting).toBe(true);
          if (change === 'ROTATE') await blocker.query('UPDATE identity.session SET access_token_hash=$2 WHERE id=$1', [SESSION, issueSessionTokens().accessTokenHash]);
          if (change === 'REVOKE') await blocker.query('UPDATE identity.session SET revoked_at=clock_timestamp() WHERE id=$1', [SESSION]);
          if (change === 'EXPIRE') await blocker.query("UPDATE identity.session SET access_expires_at=now()-interval '1 minute' WHERE id=$1", [SESSION]);
          if (change === 'BLOCK') await blocker.query("UPDATE identity.account SET status='BLOCKED',blocked_at=now(),block_channel='APP',block_reason='LOST_OR_STOLEN' WHERE id=$1", [A]);
          await blocker.query('COMMIT');
          const response = await pending;
          expect(response.status).toBe(change === 'BLOCK' ? 403 : 401);
          expect(response.body).toMatchObject({ code: change === 'BLOCK' ? 'IDENTITY_ACCOUNT_BLOCKED' : change === 'EXPIRE' ? 'IDENTITY_SESSION_EXPIRED' : 'IDENTITY_SESSION_INVALID' });
          expect((response.body as { requestId?: string }).requestId).toBeUndefined();
          expect((await admin.query('SELECT count(*)::integer AS n FROM identity.data_right_request')).rows[0]).toEqual({ n: operation === 'REPLAY' ? 1 : 0 });
          expect((await admin.query('SELECT count(*)::integer AS n FROM api.idempotency_record')).rows[0]).toEqual({ n: operation === 'REPLAY' ? 1 : 0 });
        } finally { await blocker.query('ROLLBACK'); await blocker.end(); }
      });
    }
  }
});
