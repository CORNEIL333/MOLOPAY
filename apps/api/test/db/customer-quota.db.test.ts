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

const A = '019a9700-0000-7000-8000-000000000001';
const B = '019a9700-0000-7000-8000-000000000002';
const D1 = '019a9700-0000-7000-8000-000000000011';
const D2 = '019a9700-0000-7000-8000-000000000012';
const D3 = '019a9700-0000-7000-8000-000000000013';
const S1 = '019a9700-0000-7000-8000-000000000021';
const S2 = '019a9700-0000-7000-8000-000000000022';
const S3 = '019a9700-0000-7000-8000-000000000023';
const S4 = '019a9700-0000-7000-8000-000000000024';
const ORIGIN = 'https://app.example.test';
const ACTIONS = ['SECURITY_READ', 'REVOKE_OTHERS', 'DATA_RIGHTS_READ', 'DATA_RIGHTS_SUBMIT'];
let db: TestDatabase; let admin: Client; let database: Database; const apps: INestApplication[] = [];
let migrations: string[]; let cookies: string[];
function server(index = 0): Server { return apps[index]!.getHttpServer() as Server; }
function get(auth = cookies[0]!, index = 0, path = '/v1/me/security'): ReturnType<ReturnType<typeof request>['get']> {
  return request(server(index)).get(path).set('Cookie', auth);
}
function submit(kind = 'ACCESS', key = 'quota-business-command-01'): ReturnType<ReturnType<typeof request>['post']> {
  return request(server()).post('/v1/me/data-rights').set('Cookie', cookies[0]!).set('Origin', ORIGIN).set('Idempotency-Key', key).send({ kind });
}
async function policy(action: string, account = 2, device = 2, seconds = 60, version = 1): Promise<void> {
  await admin.query(`INSERT INTO identity.customer_quota_policy(action,version,window_seconds,account_limit,device_limit)
    VALUES($1,$2,$3,$4,$5)`, [action, version, seconds, account, device]);
}
async function count(action = 'SECURITY_READ'): Promise<{ dimension: string; used: number }[]> {
  return (await admin.query<{ dimension: string; used: number }>('SELECT dimension,used FROM identity.customer_quota_counter WHERE action=$1 ORDER BY dimension,subject_id', [action])).rows;
}
beforeAll(async () => {
  migrations = await Promise.all(['0002_audit.sql','0004_identity.sql','0005_audit_metadata.sql','0007_identity_clock.sql',
    '0017_api_idempotency.sql','0023_identity_account_security.sql','0024_identity_data_rights.sql','0025_identity_customer_quota.sql']
    .map((name) => readFile(resolve('db/migrations', name), 'utf8')));
  db = await startTestDatabase(); admin = new Client({ connectionString: db.getConnectionUri() }); await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  for (let i = 0; i < 2; i++) {
    const module = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set([ORIGIN]) })] }).compile();
    const app = module.createNestApplication({ logger: false }); await app.init(); apps.push(app);
  }
});
afterAll(async () => { for (const app of apps) await app.close(); await database?.pool.end(); await admin?.end(); await db?.stop(); });
beforeEach(async () => {
  for (const schema of ['identity', 'audit', 'api']) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  for (const sql of migrations) await admin.query(sql);
  await admin.query("INSERT INTO identity.account(id,phone,phone_verified_at) VALUES ($1,'+237612360001',now()),($2,'+237612360002',now())", [A, B]);
  for (const [account, device] of [[A, D1], [A, D2], [B, D3]]) {
    const publicKey = generateKeyPairSync('ed25519').publicKey;
    await admin.query(`INSERT INTO identity.device(id,account_id,public_key_pem,fingerprint,name,status,registered_at)
      VALUES($1,$2,$3,$4,'Appareil test','ACTIVE',now())`, [device, account, publicKey.export({ type: 'spki', format: 'pem' }),
      createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest()]);
  }
  cookies = [];
  for (const [account, device, session] of [[A, D1, S1], [A, D1, S2], [A, D2, S3], [B, D3, S4]]) {
    const token = issueSessionTokens();
    await admin.query(`INSERT INTO identity.session(id,account_id,device_id,access_token_hash,refresh_token_hash,access_issued_at,access_expires_at,refresh_expires_at,created_at)
      VALUES($1,$2,$3,$4,$5,now()-interval '5 minutes',now()+interval '10 minutes',now()+interval '1 day',now()-interval '5 minutes')`,
    [session, account, device, token.accessTokenHash, token.refreshTokenHash]);
    cookies.push(`client_session=${sessionCookieValue(session!, token.accessToken)}`);
  }
});
describe('SEC-API-003 · quotas PostgreSQL des routes compte', () => {
  it('politique absente : quatre opérations fermées, sans clé métier ni compteur', async () => {
    const responses = [await get(), await get(cookies[0], 0, '/v1/me/data-rights'), await submit(),
      await request(server()).post('/v1/me/security/revoke-other-sessions').set('Cookie', cookies[0]!).set('Origin', ORIGIN).set('Idempotency-Key', 'quota-unconfigured-01')];
    for (const response of responses) {
      expect(response.status).toBe(503); expect(response.body).toMatchObject({ code: 'RATE_LIMIT_UNCONFIGURED' });
      expect(response.headers['cache-control']).toBe('private, no-store'); expect(response.headers['retry-after']).toBeUndefined();
    }
    expect(await count()).toEqual([]);
    expect((await admin.query('SELECT count(*)::integer AS n FROM api.idempotency_record')).rows[0]).toEqual({ n: 0 });
  });
  it('20 requêtes sur deux applications : exactement trois admises', async () => {
    await policy('SECURITY_READ', 3, 3);
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => get(cookies[0], i % 2).then((response) => response)));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(3);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(17);
    for (const response of responses.filter((r) => r.status === 429)) {
      expect(response.body).toMatchObject({ code: 'REQUEST_RATE_LIMITED', status: 429 });
      expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(Number(response.headers['retry-after'])).toBeLessThanOrEqual(60);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(JSON.stringify(response.body)).not.toMatch(/subject|account|device|used|limit|23761236/);
    }
    expect(await count()).toEqual([{ dimension: 'ACCOUNT', used: 3 }, { dimension: 'DEVICE', used: 3 }]);
  });
  it('budget appareil partagé entre sessions et compte partagé entre appareils, autre compte indépendant', async () => {
    await policy('SECURITY_READ', 3, 2);
    await get(cookies[0]).expect(200); await get(cookies[1]).expect(200);
    expect((await get(cookies[1]).expect(429)).body).toMatchObject({ code: 'REQUEST_RATE_LIMITED' });
    await get(cookies[2]).expect(200);
    expect((await get(cookies[2]).expect(429)).body).toMatchObject({ code: 'REQUEST_RATE_LIMITED' });
    await get(cookies[3]).expect(200);
    expect(await count()).toEqual([{ dimension: 'ACCOUNT', used: 3 }, { dimension: 'ACCOUNT', used: 1 },
      { dimension: 'DEVICE', used: 2 }, { dimension: 'DEVICE', used: 1 }, { dimension: 'DEVICE', used: 1 }]);
  });
  it('refus all-or-none, indépendance des actions, renouvellement après échéance exacte', async () => {
    await policy('SECURITY_READ', 4, 1); await policy('DATA_RIGHTS_READ', 1, 1);
    await get().expect(200); await get().expect(429);
    expect(await count()).toEqual([{ dimension: 'ACCOUNT', used: 1 }, { dimension: 'DEVICE', used: 1 }]);
    await get(cookies[0], 0, '/v1/me/data-rights').expect(200);
    await admin.query("UPDATE identity.customer_quota_counter SET resets_at=clock_timestamp()-interval '1 microsecond' WHERE action='SECURITY_READ'");
    await get().expect(200);
    expect(await count()).toEqual([{ dimension: 'ACCOUNT', used: 1 }, { dimension: 'DEVICE', used: 1 }]);
  });
  it('Retry-After prend le maximum des dimensions saturées et arrondit au supérieur', async () => {
    await policy('SECURITY_READ', 1, 1); await get().expect(200);
    await admin.query("UPDATE identity.customer_quota_counter SET resets_at=clock_timestamp()+ CASE WHEN dimension='ACCOUNT' THEN interval '10.9 seconds' ELSE interval '40.9 seconds' END");
    const response = await get().expect(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(40);
    expect(Number(response.headers['retry-after'])).toBeLessThanOrEqual(41);
    await admin.query("UPDATE identity.customer_quota_counter SET resets_at=clock_timestamp()+interval '30 seconds' WHERE dimension='ACCOUNT'");
    await admin.query("UPDATE identity.customer_quota_counter SET resets_at=clock_timestamp()-interval '1 second' WHERE dimension='DEVICE'");
    await get().expect(429);
    expect(await count()).toEqual([{ dimension: 'ACCOUNT', used: 1 }, { dimension: 'DEVICE', used: 1 }]);
  });
  it('nouvelle politique versionnée ouvre de nouveaux budgets sans réécrire les précédents', async () => {
    await policy('SECURITY_READ', 1, 1); await get().expect(200); await get().expect(429);
    await policy('SECURITY_READ', 2, 2, 30, 2); await get().expect(200); await get().expect(200); await get().expect(429);
    expect((await admin.query('SELECT version,sum(used)::integer AS used FROM identity.customer_quota_counter GROUP BY version ORDER BY version')).rows)
      .toEqual([{ version: 1, used: 2 }, { version: 2, used: 4 }]);
    for (const sql of ["UPDATE identity.customer_quota_policy SET account_limit=9", 'DELETE FROM identity.customer_quota_policy', 'TRUNCATE identity.customer_quota_policy CASCADE']) {
      await expect(admin.query(sql)).rejects.toMatchObject({ code: 'P0001', message: expect.stringMatching(/^RATE_LIMIT_POLICY_APPEND_ONLY:/) as unknown });
    }
  });
  it('échec métier et rejeu consomment une tentative, jamais une deuxième écriture métier', async () => {
    await policy('DATA_RIGHTS_SUBMIT', 3, 3);
    expect((await submit('OTHER').expect(400)).body).toMatchObject({ code: 'REQUEST_INVALID' });
    const first = await submit().expect(201); const replay = await submit().expect(201); expect(replay.body).toEqual(first.body);
    expect((await submit().expect(429)).body).toMatchObject({ code: 'REQUEST_RATE_LIMITED' });
    expect((await admin.query('SELECT count(*)::integer AS n FROM identity.data_right_request')).rows[0]).toEqual({ n: 1 });
    expect((await admin.query('SELECT count(*)::integer AS n FROM audit.event')).rows[0]).toEqual({ n: 1 });
    expect(await count('DATA_RIGHTS_SUBMIT')).toEqual([{ dimension: 'ACCOUNT', used: 3 }, { dimension: 'DEVICE', used: 3 }]);
  });
  for (const saturated of [false, true]) {
    it(`blocage et déconnexion disponibles avec configuration ${saturated ? 'saturée' : 'absente'}`, async () => {
      if (saturated) { for (const action of ACTIONS) await policy(action, 1, 1); await get().expect(200); await get().expect(429); }
      await request(server()).post('/v1/auth/signouts').set('Cookie', cookies[1]!).set('Origin', ORIGIN).set('Idempotency-Key', 'quota-emergency-logout').expect(204);
      await request(server()).post('/v1/me/security/block').set('Cookie', cookies[0]!).set('Origin', ORIGIN).set('Idempotency-Key', 'quota-emergency-block').send({ reason: 'LOST_OR_STOLEN' }).expect(200);
    });
  }
  it('origine et session refusées avant quota ; aucune confiance dans les en-têtes client', async () => {
    await policy('DATA_RIGHTS_SUBMIT', 1, 1);
    expect((await request(server()).post('/v1/me/data-rights').set('Cookie', cookies[0]!).send({ kind: 'ACCESS' }).expect(403)).body).toMatchObject({ code: 'ORIGIN_FORBIDDEN' });
    expect((await request(server()).get('/v1/me/security').set('X-Account-Id', A).set('X-Forwarded-For', '127.0.0.1').expect(401)).body).toMatchObject({ code: 'IDENTITY_SESSION_INVALID' });
    expect(await count('DATA_RIGHTS_SUBMIT')).toEqual([]);
  });
  it('SQL : aucun accès brut ni configuration, contexte/type invalides refusés', async () => {
    await policy('SECURITY_READ'); await admin.query('SET ROLE app_rw');
    try {
      for (const sql of ['SELECT * FROM identity.customer_quota_policy', 'SELECT * FROM identity.customer_quota_counter',
        "UPDATE identity.customer_quota_counter SET used=0", 'TRUNCATE identity.customer_quota_counter',
        "INSERT INTO identity.customer_quota_policy VALUES('SECURITY_READ',2,60,10,10)"]) {
        await expect(admin.query(sql)).rejects.toMatchObject({ code: '42501' });
      }
      for (const args of [[B, D1, S1], [A, D2, S1], [A, D1, S4]]) {
        await expect(admin.query('SELECT * FROM identity.consume_customer_quota($1,$2,$3,$4)', [...args, 'SECURITY_READ']))
          .rejects.toMatchObject({ code: 'P0001', message: expect.stringMatching(/^IDENTITY_SESSION_INVALID:/) as unknown });
      }
      for (const action of ['OTHER', 'BLOCK', 'SIGN_OUT', null]) {
        await expect(admin.query('SELECT * FROM identity.consume_customer_quota($1,$2,$3,$4)', [A, D1, S1, action]))
          .rejects.toMatchObject({ code: 'P0001', message: expect.stringMatching(/^REQUEST_INVALID:/) as unknown });
      }
    } finally { await admin.query('RESET ROLE'); }
    await admin.query('SET ROLE app_ro');
    try { await expect(admin.query('SELECT * FROM identity.consume_customer_quota($1,$2,$3,$4)', [A, D1, S1, 'SECURITY_READ'])).rejects.toMatchObject({ code: '42501' }); }
    finally { await admin.query('RESET ROLE'); }
  });
  for (const change of ['ROTATE', 'REVOKE', 'EXPIRE', 'BLOCK', 'POLICY', 'CLOCK'] as const) {
    it(`attend le verrou puis relit ${change}, aucun budget sur session invalidée`, async () => {
      if (change !== 'POLICY') await policy('SECURITY_READ', 1, 1);
      if (change === 'CLOCK') await get().expect(200);
      const blocker = new Client({ connectionString: db.getConnectionUri() }); await blocker.connect();
      try {
        await blocker.query('BEGIN'); await blocker.query('SELECT id FROM identity.account WHERE id=$1 FOR UPDATE', [A]);
        const pending = get().then((response) => response);
        let waiting = false;
        for (let i = 0; i < 100 && !waiting; i++) {
          waiting = (await admin.query<{ waiting: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock'
            AND pid<>pg_backend_pid() AND query LIKE '%identity.lock_security_actor%') AS waiting`)).rows[0]!.waiting;
          if (!waiting) await admin.query('SELECT pg_sleep(0.01)');
        }
        expect(waiting).toBe(true);
        if (change === 'ROTATE') await blocker.query('UPDATE identity.session SET access_token_hash=$2 WHERE id=$1', [S1, issueSessionTokens().accessTokenHash]);
        if (change === 'REVOKE') await blocker.query('UPDATE identity.session SET revoked_at=clock_timestamp() WHERE id=$1', [S1]);
        if (change === 'EXPIRE') await blocker.query("UPDATE identity.session SET access_expires_at=now()-interval '1 minute' WHERE id=$1", [S1]);
        if (change === 'BLOCK') await blocker.query("UPDATE identity.account SET status='BLOCKED',blocked_at=now(),block_channel='APP',block_reason='LOST_OR_STOLEN' WHERE id=$1", [A]);
        if (change === 'POLICY') await policy('SECURITY_READ', 1, 1);
        if (change === 'CLOCK') await blocker.query("UPDATE identity.customer_quota_counter SET resets_at=clock_timestamp()-interval '1 microsecond'");
        await blocker.query('COMMIT');
        const response = await pending;
        if (change === 'POLICY' || change === 'CLOCK') { expect(response.status).toBe(200); expect(await count()).toEqual([{ dimension: 'ACCOUNT', used: 1 }, { dimension: 'DEVICE', used: 1 }]); }
        else {
          expect(response.status).toBe(change === 'BLOCK' ? 403 : 401);
          expect(response.body).toMatchObject({ code: change === 'BLOCK' ? 'IDENTITY_ACCOUNT_BLOCKED' : change === 'EXPIRE' ? 'IDENTITY_SESSION_EXPIRED' : 'IDENTITY_SESSION_INVALID' });
          expect(await count()).toEqual([]);
        }
      } finally { await blocker.query('ROLLBACK'); await blocker.end(); }
    });
  }
});
