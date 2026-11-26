import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { createDatabase, type Database } from '../../src/http/database';
import { TEST_PII_KEYS } from './pii-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { runRealFlowsScenario } from './real-flows-scenario';
import { createStaffWithKey, loginOverHttp, STAFF_ORIGIN, STAFF_RP_TEST, staffCookie } from './staff-fixture';

/**
 * F-REP-002 (tranche 3) : lecture des indicateurs produits par le
 * back-office. Finance, conformité ou audit seulement (option prudente,
 * journal C24), consultation motivée et inscrite à l'audit chaîné ; période
 * en dates de Douala, fin exclue, au plus 366 jours.
 */
let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let cookies: Record<'finance' | 'audit' | 'support', string>;

function server(): Server {
  return app.getHttpServer() as Server;
}

function problem(response: { readonly status: number; readonly body: unknown }): [number, string | undefined] {
  return [response.status, (response.body as { code?: string }).code];
}

function read(cookie: string | null, query: Record<string, string>): request.Test {
  const call = request(server()).get('/v1/backoffice/reports/product-kpis').query(query).set('Origin', STAFF_ORIGIN);
  return cookie === null ? call : call.set('Cookie', cookie);
}

const VALID = { from: '2026-01-01', to: '2026-12-31', reason: 'Revue mensuelle des indicateurs' };

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  await runRealFlowsScenario(db.getConnectionUri(), admin);
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ database, allowedOrigins: new Set([STAFF_ORIGIN]), staffRp: STAFF_RP_TEST, otpPepper: randomBytes(32), pinPepper: randomBytes(32), smsSender: null, piiKeys: TEST_PII_KEYS })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const result: Partial<typeof cookies> = {};
  for (const [slot, login, roles] of [['finance', 'fin.kpi', ['FINANCE']], ['audit', 'aud.kpi', ['AUDIT']], ['support', 'sup.kpi', ['SUPPORT_N2']]] as const) {
    const { key } = await createStaffWithKey(db.getConnectionUri(), { login, roles: [...roles], cityIds: ['douala'] });
    result[slot] = staffCookie(await loginOverHttp(server(), login, key, 1));
  }
  cookies = result as typeof cookies;
}, 600_000);

afterAll(async () => {
  await app.close();
  await database.pool.end();
  await admin.end();
  await db.stop();
});

describe('F-REP-002 — indicateurs produits au back-office', () => {
  it('finance et audit lisent les indicateurs (totaux exacts, sans donnée personnelle) ; consultation auditée', async () => {
    for (const cookie of [cookies.finance, cookies.audit]) {
      const response = await read(cookie, VALID);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.body).toMatchObject({
        period: { from: '2025-12-31T23:00:00.000Z', to: '2026-12-30T23:00:00.000Z' },
        volume: { totalXaf: '550000' },
        completion: { activated: 3, funded: 2, ratePercent: '66.7' },
        defaultsB: 'NOT_APPLICABLE',
        commissionMargin: { count: 1, totalXaf: '3750', averageXaf: '3750' },
      });
      expect(JSON.stringify(response.body)).not.toMatch(/019aa200|customer|phone/i);
    }
    const audits = (await admin.query<{ actor_id: string; reason: string; refs: Record<string, string> }>(
      `SELECT actor_id, reason, refs FROM audit.event WHERE action = 'PRODUCT_KPIS_READ' ORDER BY seq`,
    )).rows;
    expect(audits.map((row) => row.actor_id)).toEqual(['fin.kpi', 'aud.kpi']);
    expect(audits[0]?.reason).toBe(VALID.reason);
    expect(audits[0]?.refs).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('refuse : rôle hors liste blanche (ADMIN_FORBIDDEN), sans session (401), sans motif (ADMIN_REASON_REQUIRED ou REQUEST_INVALID)', async () => {
    const forbidden = await read(cookies.support, VALID);
    expect(problem(forbidden)).toEqual([403, 'ADMIN_FORBIDDEN']);
    expect((await read(null, VALID)).status).toBe(401);
    const missing = await read(cookies.finance, { from: VALID.from, to: VALID.to });
    expect(problem(missing)).toEqual([400, 'REQUEST_INVALID']);
    expect((await admin.query(`SELECT count(*)::int AS n FROM audit.event WHERE action = 'PRODUCT_KPIS_READ' AND actor_id = 'sup.kpi'`)).rows[0]).toEqual({ n: 0 });
  });

  it('refuse : période invalide (REPORT_PERIOD_INVALID) ou paramètre hors liste (REQUEST_INVALID)', async () => {
    for (const query of [
      { ...VALID, from: '2026-12-31', to: '2026-01-01' },
      { ...VALID, from: '2026-01-01', to: '2026-01-01' },
      { ...VALID, from: '2024-01-01', to: '2025-01-02' },
      { ...VALID, from: '2026-02-30' },
    ]) {
      const response = await read(cookies.finance, query);
      expect(problem(response), JSON.stringify(query)).toEqual([400, 'REPORT_PERIOD_INVALID']);
    }
    for (const query of [{ ...VALID, from: '01/01/2026' }, { ...VALID, city: 'douala' }]) {
      const response = await read(cookies.finance, query);
      expect(problem(response), JSON.stringify(query)).toEqual([400, 'REQUEST_INVALID']);
    }
  });

  it('366 jours exactement sont acceptés', async () => {
    expect((await read(cookies.finance, { ...VALID, from: '2026-01-01', to: '2027-01-02' })).status).toBe(200);
  });
});
