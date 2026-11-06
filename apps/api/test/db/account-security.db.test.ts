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

const A = '019a9500-0000-7000-8000-000000000001';
const B = '019a9500-0000-7000-8000-000000000002';
const DEVICE = '019a9500-0000-7000-8000-000000000011';
const OTHER_DEVICE = '019a9500-0000-7000-8000-000000000012';
const FOREIGN_DEVICE = '019a9500-0000-7000-8000-000000000013';
const SESSION = '019a9500-0000-7000-8000-000000000021';
const OTHER = '019a9500-0000-7000-8000-000000000022';
const RENEWABLE = '019a9500-0000-7000-8000-000000000023';
const FOREIGN = '019a9500-0000-7000-8000-000000000024';
const ORIGIN = 'https://app.example.test';
const ROOT = '/v1/me/security';
const ROUTES = [`${ROOT}/revoke-other-sessions`, `${ROOT}/block`, '/v1/auth/signouts'];
let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];
let cookie: string;
let otherCookie: string;
let foreignCookie: string;
function server(): Server { return app.getHttpServer() as Server; }
function command(path: string, key = 'security-command-key-0001'): ReturnType<ReturnType<typeof request>['post']> {
  return request(server()).post(path).set('Origin', ORIGIN).set('Cookie', cookie).set('Idempotency-Key', key);
}
async function session(id: string, account: string, device: string, expired = false): Promise<string> {
  const issued = issueSessionTokens();
  await admin.query(`INSERT INTO identity.session
    (id,account_id,device_id,access_token_hash,refresh_token_hash,access_issued_at,access_expires_at,refresh_expires_at,created_at)
    VALUES ($1,$2,$3,$4,$5,now()-interval '5 minutes',now()+$6::interval,now()+interval '1 day',now()-interval '5 minutes')`,
  [id, account, device, issued.accessTokenHash, issued.refreshTokenHash, expired ? '-1 minute' : '10 minutes']);
  return `client_session=${sessionCookieValue(id, issued.accessToken)}`;
}
async function seed(): Promise<void> {
  await admin.query("INSERT INTO identity.account(id,phone,phone_verified_at) VALUES ($1,'+237612340001',now()),($2,'+237612340002',now())", [A, B]);
  for (const [id, account, name] of [[DEVICE, A, 'Appareil actuel'], [OTHER_DEVICE, A, 'Autre appareil'], [FOREIGN_DEVICE, B, 'Appareil étranger']]) {
    const publicKey = generateKeyPairSync('ed25519').publicKey;
    const key = publicKey.export({ type: 'spki', format: 'pem' });
    const fingerprint = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest();
    await admin.query(`INSERT INTO identity.device (id,account_id,public_key_pem,fingerprint,name,status,registered_at)
      VALUES ($1,$2,$3,$4,$5,'ACTIVE',now())`, [id, account, key, fingerprint, name]);
  }
  cookie = await session(SESSION, A, DEVICE);
  otherCookie = await session(OTHER, A, OTHER_DEVICE);
  await session(RENEWABLE, A, DEVICE, true);
  foreignCookie = await session(FOREIGN, B, FOREIGN_DEVICE);
}
beforeAll(async () => {
  migrations = await Promise.all(['0002_audit.sql','0004_identity.sql','0005_audit_metadata.sql','0007_identity_clock.sql',
    '0017_api_idempotency.sql','0023_identity_account_security.sql','0025_identity_customer_quota.sql'].map((name) => readFile(resolve('db/migrations', name), 'utf8')));
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
  await seed();
});
describe('SEC-AUTH-005 / F-ACC-006 · sécurité du compte réelle', () => {
  it('ne retourne que les appareils et sessions du compte, sans secret', async () => {
    const response = await request(server()).get(ROOT).set('Cookie', cookie).expect(200);
    const body = response.body as { devices: { deviceId: string; current: boolean }[]; sessions: { sessionId: string; current: boolean }[]; asOf: string };
    expect(body.devices.map((d) => d.deviceId).sort()).toEqual([DEVICE, OTHER_DEVICE].sort());
    expect(body.sessions.map((s) => s.sessionId).sort()).toEqual([SESSION, OTHER, RENEWABLE].sort());
    expect(body.devices.filter((d) => d.current)).toHaveLength(1);
    expect(body.sessions.filter((s) => s.current)).toEqual([expect.objectContaining({ sessionId: SESSION })]);
    expect(Number.isFinite(Date.parse(body.asOf))).toBe(true);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(body)).not.toMatch(/token|hash|fingerprint|public_key|phone|23761234000|Appareil étranger/);
    const foreign = await request(server()).get(ROOT).set('Cookie', foreignCookie).expect(200);
    expect(JSON.stringify(foreign.body)).not.toContain(DEVICE);
  });
  it('ferme aussi les accès expirés mais renouvelables en conservant la session courante', async () => {
    const result = await command(ROUTES[0]!).expect(200);
    expect(result.body).toMatchObject({ action: 'REVOKE_OTHERS', affectedSessions: 2 });
    const rows = await admin.query<{ id: string }>('SELECT id FROM identity.session WHERE revoked_at IS NOT NULL ORDER BY id');
    expect(rows.rows.map((row) => row.id)).toEqual([OTHER, RENEWABLE]);
    await request(server()).get(ROOT).set('Cookie', cookie).expect(200);
    expect((await request(server()).get(ROOT).set('Cookie', otherCookie).expect(401)).body).toMatchObject({ code: 'IDENTITY_SESSION_INVALID' });
    await request(server()).get(ROOT).set('Cookie', foreignCookie).expect(200);
    expect((await admin.query('SELECT action FROM audit.event')).rows).toEqual([{ action: 'SESSION_REVOKED' }]);
  });
  it('déconnexion : 204 sans corps, cookie effacé après commit et révocation définitive', async () => {
    const response = await command(ROUTES[2]!).expect(204);
    expect(response.text).toBe('');
    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((value) => value.startsWith('client_session=;') && value.includes('Max-Age=0') && value.includes('HttpOnly')
      && value.includes('Secure') && value.includes('SameSite=Lax') && value.includes('Path=/'))).toBe(true);
    expect((await admin.query('SELECT revoked_at IS NOT NULL AS revoked FROM identity.session WHERE id=$1', [SESSION])).rows[0]).toEqual({ revoked: true });
    expect((await request(server()).get(ROOT).set('Cookie', cookie).expect(401)).body).toMatchObject({ code: 'IDENTITY_SESSION_INVALID' });
    await request(server()).get(ROOT).set('Cookie', otherCookie).expect(200);
  });
  it('blocage APP atomique, révocation générale, aucun effet sur un autre compte', async () => {
    const result = await command(ROUTES[1]!).send({ reason: 'LOST_OR_STOLEN' }).expect(200);
    expect(result.body).toMatchObject({ action: 'BLOCK', affectedSessions: 3 });
    expect((await admin.query('SELECT status,block_channel,block_reason FROM identity.account WHERE id=$1', [A])).rows[0])
      .toEqual({ status: 'BLOCKED', block_channel: 'APP', block_reason: 'LOST_OR_STOLEN' });
    expect((await admin.query("SELECT count(*)::integer AS n FROM identity.device WHERE account_id=$1 AND status='ACTIVE'", [A])).rows[0]).toEqual({ n: 0 });
    expect((await admin.query('SELECT count(*)::integer AS n FROM identity.session WHERE account_id=$1 AND revoked_at IS NULL', [A])).rows[0]).toEqual({ n: 0 });
    expect((await request(server()).get(ROOT).set('Cookie', otherCookie).expect(401)).body).toMatchObject({ code: 'IDENTITY_SESSION_INVALID' });
    await request(server()).get(ROOT).set('Cookie', foreignCookie).expect(200);
    expect((await admin.query('SELECT action FROM audit.event')).rows).toEqual([{ action: 'ACCOUNT_BLOCKED' }]);
    await admin.query('SET ROLE app_rw');
    try { await expect(admin.query("UPDATE identity.account SET status='ACTIVE',blocked_at=NULL,block_channel=NULL,block_reason=NULL WHERE id=$1", [A])).rejects.toMatchObject({ code: '42501' }); }
    finally { await admin.query('RESET ROLE'); }
  });
  it('cinq commandes concurrentes identiques : une seule mutation et un audit', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => command(ROUTES[0]!).expect(200)));
    for (const response of results) expect(response.body).toEqual(results[0]!.body);
    expect((await admin.query('SELECT count(*)::integer AS n FROM audit.event')).rows[0]).toEqual({ n: 1 });
    expect((await admin.query('SELECT count(*)::integer AS n FROM api.idempotency_record')).rows[0]).toEqual({ n: 1 });
  });
  it('deux déconnexions déjà authentifiées concurrentes rejouent toutes deux le 204', async () => {
    const blocker = new Client({ connectionString: db.getConnectionUri() }); await blocker.connect();
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT * FROM identity.account WHERE id=$1 FOR UPDATE', [A]);
      const pending = Array.from({ length: 2 }, () => command(ROUTES[2]!).then((response) => response));
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        waiting = (await admin.query<{ waiting: boolean }>(`SELECT count(*)>=2 AS waiting FROM pg_stat_activity
          WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()
          AND (query LIKE '%lock_security_actor%' OR query LIKE '%INSERT INTO api.idempotency_record%')`)).rows[0]!.waiting;
        if (!waiting) await admin.query('SELECT pg_sleep(0.01)');
      }
      expect(waiting).toBe(true);
      await blocker.query('COMMIT');
      const responses = await Promise.all(pending);
      expect(responses.map((response) => response.status)).toEqual([204, 204]);
      for (const response of responses) expect(response.text).toBe('');
      expect((await admin.query('SELECT count(*)::integer AS n FROM audit.event')).rows[0]).toEqual({ n: 1 });
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); }
  });
  for (const path of ROUTES) {
    it('refuse origine, clé absente et cible client avant mutation', async () => {
      expect((await request(server()).post(path).set('Cookie', cookie).set('Idempotency-Key', 'security-key-refused').expect(403)).body).toMatchObject({ code: 'ORIGIN_FORBIDDEN' });
      const body = path.endsWith('/block') ? { reason: 'LOST_OR_STOLEN' } : {};
      expect((await request(server()).post(path).set('Cookie', cookie).set('Origin', ORIGIN).send(body).expect(400)).body).toMatchObject({ code: 'REQUEST_INVALID' });
      expect((await command(path).send({ ...body, accountId: B }).expect(400)).body).toMatchObject({ code: 'REQUEST_INVALID' });
      expect((await command(`${path}?accountId=${B}`).send(body).expect(400)).body).toMatchObject({ code: 'REQUEST_INVALID' });
      expect((await admin.query('SELECT count(*)::integer AS n FROM api.idempotency_record')).rows[0]).toEqual({ n: 0 });
    });
    it('échec audit : rollback de la commande et de sa clé, aucun cookie effacé', async () => {
      // Séquence non transactionnelle de test : prouver que l'INSERT audit a
      // observé les mutations avant de refuser, pas un autre 500 accidentel.
      await admin.query(`CREATE SEQUENCE audit.rejected_write_probe;
        CREATE FUNCTION audit.reject_security_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
        BEGIN
          IF NEW.action='ACCOUNT_BLOCKED' THEN
            IF NOT EXISTS(SELECT 1 FROM identity.account WHERE id='${A}' AND status='BLOCKED')
              OR EXISTS(SELECT 1 FROM identity.device WHERE account_id='${A}' AND status='ACTIVE') THEN RAISE EXCEPTION 'TEST_MUTATION_MISSING'; END IF;
          ELSIF NEW.reason='SIGN_OUT' THEN
            IF NOT EXISTS(SELECT 1 FROM identity.session WHERE id='${SESSION}' AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'TEST_MUTATION_MISSING'; END IF;
          ELSE
            IF (SELECT count(*) FROM identity.session WHERE id IN ('${OTHER}','${RENEWABLE}') AND revoked_at IS NOT NULL)<>2 THEN RAISE EXCEPTION 'TEST_MUTATION_MISSING'; END IF;
          END IF;
          IF NOT EXISTS(SELECT 1 FROM api.idempotency_record WHERE response_status IS NULL) THEN RAISE EXCEPTION 'TEST_KEY_MISSING'; END IF;
          PERFORM nextval('audit.rejected_write_probe');
          RAISE EXCEPTION 'TEST_AUDIT_REFUSED';
        END $$;
        CREATE TRIGGER security_failure_probe BEFORE INSERT ON audit.event FOR EACH ROW EXECUTE FUNCTION audit.reject_security_write()`);
      const response = await command(path).send(path.endsWith('/block') ? { reason: 'LOST_OR_STOLEN' } : {}).expect(500);
      expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect((await admin.query('SELECT is_called FROM audit.rejected_write_probe')).rows[0]).toEqual({ is_called: true });
      expect((await admin.query('SELECT status FROM identity.account WHERE id=$1', [A])).rows[0]).toEqual({ status: 'ACTIVE' });
      expect((await admin.query('SELECT count(*)::integer AS n FROM identity.session WHERE revoked_at IS NOT NULL')).rows[0]).toEqual({ n: 0 });
      expect((await admin.query('SELECT count(*)::integer AS n FROM api.idempotency_record')).rows[0]).toEqual({ n: 0 });
    });
  }
  it('refuse une session absente, révoquée, expirée ou un appareil révoqué', async () => {
    expect((await request(server()).get(ROOT).expect(401)).body).toMatchObject({ code: 'IDENTITY_SESSION_INVALID' });
    expect((await request(server()).get(ROOT).set('Cookie', `${cookie}; ${cookie}`).expect(401)).body).toMatchObject({ code: 'IDENTITY_SESSION_INVALID' });
    await admin.query("UPDATE identity.session SET access_expires_at=now()-interval '1 minute' WHERE id=$1", [SESSION]);
    expect((await request(server()).get(ROOT).set('Cookie', cookie).expect(401)).body).toMatchObject({ code: 'IDENTITY_SESSION_EXPIRED' });
    await admin.query("UPDATE identity.device SET status='REVOKED',revoked_at=now() WHERE id=$1", [OTHER_DEVICE]);
    expect((await request(server()).get(ROOT).set('Cookie', otherCookie).expect(403)).body).toMatchObject({ code: 'IDENTITY_DEVICE_REVOKED' });
  });
  it('vérifie l’appartenance et les droits directement dans les fonctions SQL', async () => {
    await admin.query('SET ROLE app_rw');
    try {
      for (const args of [[B, DEVICE, SESSION], [A, FOREIGN_DEVICE, SESSION], [A, DEVICE, FOREIGN]]) {
        await expect(admin.query('SELECT identity.lock_security_actor($1,$2,$3)', args))
          .rejects.toMatchObject({ code: 'P0001', message: 'IDENTITY_SESSION_INVALID: contexte de session invalide' });
      }
    } finally { await admin.query('RESET ROLE'); }
    await admin.query('SET ROLE app_ro');
    try { await expect(admin.query('SELECT * FROM identity.apply_security_action($1,$2,$3,$4)', [A, DEVICE, SESSION, 'BLOCK'])).rejects.toMatchObject({ code: '42501' }); }
    finally { await admin.query('RESET ROLE'); }
  });
  it.each([
    ['ROTATE', 401, 'IDENTITY_SESSION_INVALID'], ['REVOKE', 401, 'IDENTITY_SESSION_INVALID'],
    ['EXPIRE', 401, 'IDENTITY_SESSION_EXPIRED'], ['BLOCK', 403, 'IDENTITY_ACCOUNT_BLOCKED'],
  ] as const)('réauthentifie après attente du verrou : %s', async (change, status, code) => {
    const blocker = new Client({ connectionString: db.getConnectionUri() }); await blocker.connect();
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT * FROM identity.account WHERE id=$1 FOR UPDATE', [A]);
      const pending = command(ROUTES[0]!).then((response) => response);
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        waiting = (await admin.query<{ waiting: boolean }>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%lock_security_actor%' AND pid<>pg_backend_pid()) AS waiting")).rows[0]!.waiting;
        if (!waiting) await admin.query('SELECT pg_sleep(0.01)');
      }
      expect(waiting).toBe(true);
      if (change === 'ROTATE') await blocker.query('UPDATE identity.session SET access_token_hash=$1 WHERE id=$2', [issueSessionTokens().accessTokenHash, SESSION]);
      if (change === 'REVOKE') await blocker.query('UPDATE identity.session SET revoked_at=clock_timestamp() WHERE id=$1', [SESSION]);
      if (change === 'EXPIRE') await blocker.query("UPDATE identity.session SET access_expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [SESSION]);
      if (change === 'BLOCK') await blocker.query("UPDATE identity.account SET status='BLOCKED',blocked_at=clock_timestamp(),block_channel='SUPPORT',block_reason='TEST' WHERE id=$1", [A]);
      await blocker.query('COMMIT');
      const response = await pending;
      expect(response.status).toBe(status); expect(response.body).toMatchObject({ code });
      expect((await admin.query('SELECT count(*)::integer AS n FROM identity.session WHERE id IN ($1,$2) AND revoked_at IS NOT NULL', [OTHER, RENEWABLE])).rows[0]).toEqual({ n: 0 });
      expect((await admin.query('SELECT count(*)::integer AS n FROM api.idempotency_record')).rows[0]).toEqual({ n: 0 });
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); }
  });
  it('refuse les commandes SQL inconnues et les instantanés périmés', async () => {
    await expect(admin.query('SELECT * FROM identity.apply_security_action($1,$2,$3,$4)', [A, DEVICE, SESSION, 'UNBLOCK']))
      .rejects.toMatchObject({ code: 'P0001', message: 'IDENTITY_INVALID_REQUEST: commande inconnue' });
    await admin.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      await admin.query('SET LOCAL ROLE app_rw');
      await expect(admin.query('SELECT identity.lock_security_actor($1,$2,$3)', [A, DEVICE, SESSION]))
        .rejects.toMatchObject({ code: 'P0001', message: 'IDENTITY_INVALID_REQUEST: isolation non prise en charge' });
    } finally { await admin.query('ROLLBACK'); }
  });
});
