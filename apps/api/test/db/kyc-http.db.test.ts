import 'reflect-metadata';
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
import { createPartnerDossier } from '../../src/modules/catalog/partner';
import { appendPartnerDossier } from '../../src/modules/catalog/partner.store';
import { importUnSanctionsList } from '../../src/modules/kyc/sanctions.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { declareLegalNameAndScreen } from '../../src/workflows/kyc-basic-level';
import { seedCustomerAccount } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { createStaffWithKey, loginOverHttp, STAFF_ORIGIN, STAFF_RP_TEST, staffCookie } from './staff-fixture';

/** REG-LBC-002 / D66 : filtrage des partenaires et examen des rapprochements au back-office, en HTTP réel. */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const EXCERPT = readFileSync(resolve(process.cwd(), 'apps/api/src/modules/kyc/fixtures/un-consolidated-excerpt.xml'), 'utf8');

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];
let cookies: Record<'network' | 'compliance' | 'ops', string>;

function payload(response: request.Response): { code?: string; screeningId?: string } {
  return response.body as { code?: string; screeningId?: string };
}

function server(): Server {
  return app.getHttpServer() as Server;
}

function post(path: string, cookie: string, body: object): request.Test {
  return request(server()).post(path).set('Origin', STAFF_ORIGIN).set('Cookie', cookie).set('Idempotency-Key', `kyc-${uuidv7()}`).send(body);
}

async function dossier(partnerId: string, legalName: string): Promise<void> {
  await withTransaction(database, (client) =>
    appendPartnerDossier(
      client,
      createPartnerDossier({
        partnerId,
        partnerType: 'MERCHANT',
        beneficiaryKind: null,
        legalName,
        rccm: 'RC/DLA/2024/B/0002',
        niu: 'M000000000000B',
        representativeDocumentRef: 'kyc-doc-ref-0002',
        settlementAccountRef: 'settlement-ref-0002',
      }),
      'net-1',
    ),
  );
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
  const result: Partial<typeof cookies> = {};
  for (const [slot, login, roles] of [['network', 'net.un', ['PARTNER_NETWORK']], ['compliance', 'comp.un', ['COMPLIANCE']], ['ops', 'ops.un', ['OPERATIONS']]] as const) {
    const { key } = await createStaffWithKey(uri, { login, roles: [...roles] });
    result[slot] = staffCookie(await loginOverHttp(server(), login, key, 1));
  }
  cookies = result as typeof cookies;
});

describe('REG-LBC-002 / D66 filtrage des partenaires au back-office', () => {
  it('sans liste importée : 422 KYC_LIST_UNAVAILABLE ; partenaire inconnu : 404', async () => {
    await dossier('merchant-9', 'Quincaillerie du Centre');
    const unavailable = await post('/v1/backoffice/partners/merchant-9/screenings', cookies.network, {});
    expect(unavailable.status).toBe(422);
    expect(payload(unavailable).code).toBe('KYC_LIST_UNAVAILABLE');
    await withTransaction(database, (client) => importUnSanctionsList(client, { versionId: uuidv7(), xml: EXCERPT, sourceUrl: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml', actorId: 'comp.un' }));
    const unknown = await post('/v1/backoffice/partners/inconnu-1/screenings', cookies.network, {});
    expect(unknown.status).toBe(404);
    expect(payload(unknown).code).toBe('KYC_SUBJECT_NOT_FOUND');
  });

  it('raison sociale du dernier dossier filtrée ; rapprochement examiné par la conformité ; état consultable', async () => {
    await withTransaction(database, (client) => importUnSanctionsList(client, { versionId: uuidv7(), xml: EXCERPT, sourceUrl: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml', actorId: 'comp.un' }));
    await dossier('merchant-9', 'Quincaillerie du Centre');
    await dossier('merchant-9', 'Butembo Airlines SARL');
    const screened = await post('/v1/backoffice/partners/merchant-9/screenings', cookies.network, {});
    expect(screened.status, JSON.stringify(screened.body)).toBe(201);
    expect(screened.headers['cache-control']).toBe('private, no-store');
    expect(screened.body).toMatchObject({ outcome: 'POTENTIAL_MATCH', matchedReferences: ['CDe.002'] });
    const status = (): request.Test => request(server()).get('/v1/backoffice/partners/merchant-9/screening').set('Cookie', cookies.compliance);
    expect((await status()).body).toEqual({ partnerId: 'merchant-9', status: 'PENDING_REVIEW' });
    const path = `/v1/backoffice/screenings/${payload(screened).screeningId ?? ''}/review`;
    expect((await post(path, cookies.compliance, { decision: 'FALSE_POSITIVE' })).status).toBe(400);
    const reviewed = await post(path, cookies.compliance, { decision: 'FALSE_POSITIVE', reason: 'société distincte, RCCM vérifié' });
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    expect((await status()).body).toEqual({ partnerId: 'merchant-9', status: 'FALSE_POSITIVE' });
  });

  it('droits : les opérations ne filtrent pas ; le réseau partenaires n’examine pas ; l’auteur du filtrage n’examine pas', async () => {
    await withTransaction(database, (client) => importUnSanctionsList(client, { versionId: uuidv7(), xml: EXCERPT, sourceUrl: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml', actorId: 'comp.un' }));
    await dossier('merchant-9', 'Butembo Airlines SARL');
    const denied = await post('/v1/backoffice/partners/merchant-9/screenings', cookies.ops, {});
    expect(denied.status).toBe(403);
    expect(payload(denied).code).toBe('ADMIN_FORBIDDEN');
    const screened = await post('/v1/backoffice/partners/merchant-9/screenings', cookies.compliance, {});
    const path = `/v1/backoffice/screenings/${payload(screened).screeningId ?? ''}/review`;
    expect((await post(path, cookies.network, { decision: 'FALSE_POSITIVE', reason: 'x y z' })).status).toBe(403);
    const self = await post(path, cookies.compliance, { decision: 'CONFIRMED_MATCH', reason: 'correspondance' });
    expect(self.status).toBe(403);
    expect(payload(self).code).toBe('MAKER_CANNOT_APPROVE');
  });
});

describe('REG-LBC-002 / F-BO-004 consultation d’un filtrage par la Conformité (D74)', () => {
  it('nom filtré et entrées rapprochées (noms listés) ; motif obligatoire ; journalisé ; réseau partenaires refusé', async () => {
    await withTransaction(database, (client) => importUnSanctionsList(client, { versionId: uuidv7(), xml: EXCERPT, sourceUrl: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml', actorId: 'comp.un' }));
    await dossier('merchant-9', 'Butembo Airlines SARL');
    const screened = await post('/v1/backoffice/partners/merchant-9/screenings', cookies.network, {});
    const id = payload(screened).screeningId ?? '';
    const path = `/v1/backoffice/screenings/${id}`;
    expect((await request(server()).get(path).set('Cookie', cookies.compliance)).status).toBe(400);
    expect((await request(server()).get(path).query({ reason: 'examen du rapprochement' }).set('Cookie', cookies.network)).status).toBe(403);
    const response = await request(server()).get(path).query({ reason: 'examen du rapprochement' }).set('Cookie', cookies.compliance);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toMatchObject({
      screeningId: id,
      subjectType: 'PARTNER',
      subjectId: 'merchant-9',
      normalizedName: 'BUTEMBO AIRLINES SARL',
      outcome: 'POTENTIAL_MATCH',
      review: null,
      matches: [{ reference: 'CDe.002', kind: 'ENTITY', names: ['BUTEMBO AIRLINES (BAL)'], listedOn: '2007-03-29' }],
    });
    const audit = await admin.query(`SELECT actor_id, action, reason FROM audit.event WHERE target_type = 'SANCTIONS_SCREENING' AND target_id = $1`, [id]);
    expect(audit.rows).toEqual([{ actor_id: 'comp.un', action: 'READ_IDENTITY_DOCUMENT', reason: 'examen du rapprochement' }]);
    expect((await request(server()).get(`/v1/backoffice/screenings/${uuidv7()}`).query({ reason: 'examen' }).set('Cookie', cookies.compliance)).status).toBe(404);
    // Une version plus récente de la liste ne change pas les entrées montrées pour ce filtrage (version figée).
    const later = EXCERPT.replace('dateGenerated="2026-11-17T00:00:02.485Z"', 'dateGenerated="2026-11-18T00:00:02.485Z"').replace('BUTEMBO AIRLINES (BAL)', 'BUTEMBO AIRLINES (BAL) LIMITED');
    await withTransaction(database, (client) => importUnSanctionsList(client, { versionId: uuidv7(), xml: later, sourceUrl: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml', actorId: 'comp.un' }));
    await post(`/v1/backoffice/screenings/${id}/review`, cookies.compliance, { decision: 'FALSE_POSITIVE', reason: 'société distincte' });
    const again = await request(server()).get(path).query({ reason: 'contrôle après examen' }).set('Cookie', cookies.compliance);
    expect(again.body).toMatchObject({ matches: [{ reference: 'CDe.002', names: ['BUTEMBO AIRLINES (BAL)'] }], review: { decision: 'FALSE_POSITIVE' } });
  });

  it('filtrage d’un client : consultation journalisée avec l’identifiant du client', async () => {
    await withTransaction(database, (client) => importUnSanctionsList(client, { versionId: uuidv7(), xml: EXCERPT, sourceUrl: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml', actorId: 'comp.un' }));
    const customer = '019ab900-0000-7000-8000-0000000000c9';
    await seedCustomerAccount(admin, customer, 'NONE');
    const declared = await withTransaction(database, (client) => declareLegalNameAndScreen(client, { accountId: customer, legalName: 'Eric Badege' }));
    const response = await request(server()).get(`/v1/backoffice/screenings/${declared.screeningId}`).query({ reason: 'examen du rapprochement' }).set('Cookie', cookies.compliance);
    expect(response.body).toMatchObject({ subjectType: 'CUSTOMER', normalizedName: 'ERIC BADEGE', matches: [{ reference: 'CDi.001' }] });
    const audit = await admin.query(`SELECT refs ->> 'client_id' AS client FROM audit.event WHERE target_type = 'SANCTIONS_SCREENING' AND target_id = $1`, [declared.screeningId]);
    expect(audit.rows).toEqual([{ client: customer }]);
  });
});
