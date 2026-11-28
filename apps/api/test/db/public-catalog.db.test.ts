import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { canonicalize } from '@achat/chain';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { createDatabase, type Database } from '../../src/http/database';
import { createPartnerDossier, partnerDossierHash } from '../../src/modules/catalog/partner';
import { appendPartnerDossier } from '../../src/modules/catalog/partner.store';
import { appendOfferVersion } from '../../src/modules/catalog/offer.store';
import { createOffer, publishOffer } from '../../src/modules/catalog/domain';
import { appendOfferPresentation } from '../../src/modules/catalog/public-offer.store';
import { startTestDatabase, type TestDatabase } from './harness';

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrations: string[];
const ID = '019a9400-0000-7000-8000-0000000000a1';
const OTHER = '019a9400-0000-7000-8000-0000000000a2';
const APPROVAL = '019a9400-0000-7000-8000-0000000000b1';
function server(): Server { return app.getHttpServer() as Server; }
async function partner(validated = true, name = 'Marchand de test'): Promise<void> {
  const dossier = createPartnerDossier({ partnerId: 'merchant-1', partnerType: 'MERCHANT', beneficiaryKind: null,
    legalName: name, rccm: 'TEST-RCCM', niu: 'TEST-NIU', representativeDocumentRef: 'private-document', settlementAccountRef: 'private-account' });
  const stored = await appendPartnerDossier(admin, dossier, 'network');
  if (!validated) return;
  const approvalId = stored.version === 1 ? APPROVAL : '019a9400-0000-7000-8000-0000000000b2';
  const payload = { partner_id: 'merchant-1', dossier_hash: partnerDossierHash(dossier).toString('hex') };
  await admin.query(`INSERT INTO admin.approval_request (id,kind,maker_id,payload,payload_hash,reason,prepared_at,expires_at)
    VALUES ($1,'PARTNER_APPROVAL','maker',$2,$3,'Dossier de test',clock_timestamp(),clock_timestamp()+interval '1 hour')`,
  [approvalId, payload, createHash('sha256').update(canonicalize(payload)).digest()]);
  await admin.query("INSERT INTO admin.approval_decision (request_id,decision,decided_by,decided_at) VALUES ($1,'APPROVED','checker',clock_timestamp())", [approvalId]);
  await admin.query('INSERT INTO catalog.partner_validation VALUES ($1,$2,$3,clock_timestamp())', ['merchant-1', stored.version, approvalId]);
}
async function offer(id = ID, options: { title?: boolean; published?: boolean; price?: bigint } = {}): Promise<number> {
  const domain = createOffer({ id, partner: { id: 'merchant-1', status: 'VALIDATED' }, universe: 'TECHNOLOGY',
    models: ['SAVE_THEN_BUY'], cityIds: ['douala'], priceXaf: options.price ?? 100000n,
    availability: { kind: 'IN_STOCK', units: 2 }, warranty: 'Garantie de test', discountTerms: 'Remise de test' });
  const version = await appendOfferVersion(admin, options.published === false ? domain : publishOffer(domain), 'network');
  if (options.title !== false) await appendOfferPresentation(admin, { offerId: id, version, title: 'Article de test' }, 'network');
  return version;
}
beforeAll(async () => {
  migrations = await Promise.all(['0003_admin.sql','0006_admin_clock.sql','0008_catalog_partner.sql','0009_catalog_offer.sql',
    '0011_agreements.sql','0012_agreements_customer_signature.sql','0013_partner_type_beneficiary.sql',
    '0014_partner_incident.sql','0015_partner_default_lift.sql','0022_catalog_public_presentation.sql',
    '0053_agreements_stock_reservation.sql']
    .map((name) => readFile(resolve('db/migrations', name), 'utf8')));
  db = await startTestDatabase(); admin = new Client({ connectionString: db.getConnectionUri() }); await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const module = await Test.createTestingModule({ imports: [AppModule.register({ database, allowedOrigins: new Set() })] }).compile();
  app = module.createNestApplication(); await app.init();
});
afterAll(async () => { await app?.close(); await database?.pool.end(); await admin?.end(); await db?.stop(); });
beforeEach(async () => {
  for (const schema of ['agreements', 'catalog', 'admin']) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  for (const sql of migrations) await admin.query(sql);
});
describe('F-CAT-001/004 · catalogue public HTTP et PostgreSQL réels', () => {
  it('sert sans session une projection fermée, prix exact et horloge serveur', async () => {
    await partner(); await offer(ID, { price: 9007199254740993n });
    const before = Date.now();
    const response = await request(server()).get('/v1/offers').expect(200);
    const body = response.body as { offers: Record<string, unknown>[]; asOf: string };
    expect(body.offers).toEqual([{ offerId: ID, title: 'Article de test', partnerId: 'merchant-1', partnerName: 'Marchand de test',
      universe: 'TECHNOLOGY', models: ['SAVE_THEN_BUY'], cities: ['douala'], priceXaf: '9007199254740993',
      availability: { kind: 'IN_STOCK', units: 2 }, warranty: 'Garantie de test', discountTerms: 'Remise de test', status: 'PUBLISHED' }]);
    expect(Date.parse(body.asOf)).toBeGreaterThanOrEqual(before);
    expect(JSON.stringify(body)).not.toMatch(/private-document|private-account|TEST-NIU|TEST-RCCM/);
    const detail = await request(server()).get(`/v1/offers/${ID}`).expect(200);
    expect(detail.body).toEqual(body.offers[0]);
  });
  it('masque brouillon, présentation manquante et nouvelle version sans titre', async () => {
    await partner(); await offer(ID, { published: false }); await offer(OTHER, { title: false });
    expect((await admin.query('SELECT * FROM catalog.public_offer')).rows).toHaveLength(0);
    expect((await request(server()).get('/v1/offers').expect(200)).body).toMatchObject({ offers: [] });
    await offer(); expect((await request(server()).get('/v1/offers').expect(200)).body).toMatchObject({ offers: [{ offerId: ID }] });
    await offer(ID, { title: false });
    expect((await request(server()).get('/v1/offers').expect(200)).body).toMatchObject({ offers: [] });
    expect((await request(server()).get(`/v1/offers/${ID}`).expect(404)).body).toMatchObject({ code: 'CATALOG_OFFER_NOT_FOUND' });
  });
  it('retire immédiatement un partenaire dont le dossier repasse en attente', async () => {
    await partner(); await offer(); await partner(false, 'Nouveau nom non validé');
    expect((await admin.query('SELECT * FROM catalog.public_offer')).rows).toHaveLength(0);
    expect((await request(server()).get('/v1/offers').expect(200)).body).toMatchObject({ offers: [] });
  });
  it('retire les offres après une défaillance marchand en base et HTTP', async () => {
    await partner(); await offer();
    await admin.query("INSERT INTO catalog.partner_incident (id,partner_id,kind,reason,reported_by,created_at) VALUES ('019a9400-0000-7000-8000-0000000000c1','merchant-1','MERCHANT_DEFAULT','Incident de test','risk',clock_timestamp())");
    expect((await admin.query('SELECT * FROM catalog.public_offer')).rows).toHaveLength(0);
    expect((await request(server()).get(`/v1/offers/${ID}`).expect(404)).body).toMatchObject({ code: 'CATALOG_OFFER_NOT_FOUND' });
    await partner(true, 'Marchand revalidé');
    expect((await admin.query('SELECT status, in_default FROM catalog.partner_state')).rows[0]).toEqual({ status: 'VALIDATED', in_default: false });
    expect((await request(server()).get(`/v1/offers/${ID}`).expect(404)).body).toMatchObject({ code: 'CATALOG_OFFER_NOT_FOUND' });
    await offer();
    expect((await request(server()).get(`/v1/offers/${ID}`).expect(200)).body).toMatchObject({ partnerName: 'Marchand revalidé' });
  });
  it('applique cumulativement les cinq filtres sans conversion flottante', async () => {
    await partner(); await offer(); await offer(OTHER, { price: 200000n });
    const query = { universe: 'TECHNOLOGY', city: 'douala', model: 'SAVE_THEN_BUY', partnerId: 'merchant-1', maxPriceXaf: '100000' };
    expect((await request(server()).get('/v1/offers').query(query).expect(200)).body).toMatchObject({ offers: [{ offerId: ID }] });
    for (const change of [{ city: 'yaounde' }, { model: 'PLANNED_EXPENSE' }, { universe: 'HOUSING' }, { partnerId: 'other' }, { maxPriceXaf: '99999' }]) {
      expect((await request(server()).get('/v1/offers').query({ ...query, ...change }).expect(200)).body).toMatchObject({ offers: [] });
    }
  });
  it('refuse champs inconnus, filtres répétés et identifiant invalide avec code exact', async () => {
    for (const url of ['/v1/offers?city=douala&city=yaounde', '/v1/offers?unknown=x', '/v1/offers?maxPriceXaf=01', '/v1/offers/invalid']) {
      const response = await request(server()).get(url).expect(400);
      expect(response.body).toMatchObject({ code: 'REQUEST_INVALID' });
      expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    }
  });
  it('renvoie le même 404 pour une offre absente et une offre invisible', async () => {
    await partner(); await offer(ID, { published: false });
    const first = await request(server()).get(`/v1/offers/${ID}`).expect(404);
    const second = await request(server()).get(`/v1/offers/${OTHER}`).expect(404);
    expect(first.body).toEqual(second.body);
    expect(first.body).toMatchObject({ code: 'CATALOG_OFFER_NOT_FOUND' });
  });
  it('retourne une liste vide horodatée et un tri stable', async () => {
    const empty = (await request(server()).get('/v1/offers').expect(200)).body as { offers: unknown[]; asOf: string };
    expect(empty.offers).toEqual([]);
    expect(Number.isFinite(Date.parse(empty.asOf))).toBe(true);
    await partner(); await offer(OTHER); await offer(ID);
    const response = await request(server()).get('/v1/offers').expect(200);
    const body = response.body as { offers: { offerId: string }[] };
    expect(body.offers.map((item) => item.offerId)).toEqual([ID, OTHER]);
  });
  it('force app_ro pour les lectures HTTP même si la configuration générale utilise app_rw', async () => {
    await partner(); await offer();
    await admin.query('REVOKE SELECT ON catalog.public_offer FROM app_rw');
    await admin.query('SET ROLE app_rw');
    try {
      await expect(admin.query('SELECT * FROM catalog.public_offer')).rejects.toMatchObject({ code: '42501' });
    } finally { await admin.query('RESET ROLE'); }
    expect((await request(server()).get('/v1/offers').expect(200)).body).toMatchObject({ offers: [{ offerId: ID }] });
    expect((await request(server()).get(`/v1/offers/${ID}`).expect(200)).body).toMatchObject({ offerId: ID });
  });
  it('conserve le titre par version et refuse mutation, titre vide et droits de lecture en écriture', async () => {
    await partner(); await offer();
    await expect(admin.query('UPDATE catalog.offer_presentation SET title = \'Autre\''))
      .rejects.toMatchObject({ code: 'P0001', message: 'CATALOG_APPEND_ONLY: UPDATE sur offer_presentation refusé' });
    await expect(admin.query('DELETE FROM catalog.offer_presentation'))
      .rejects.toMatchObject({ code: 'P0001', message: 'CATALOG_APPEND_ONLY: DELETE sur offer_presentation refusé' });
    await expect(admin.query('TRUNCATE catalog.offer_presentation'))
      .rejects.toMatchObject({ code: 'P0001', message: 'CATALOG_APPEND_ONLY: TRUNCATE sur offer_presentation refusé' });
    await admin.query('SET ROLE app_ro');
    try {
      expect((await admin.query('SELECT * FROM catalog.public_offer')).rows).toHaveLength(1);
      await expect(admin.query('INSERT INTO catalog.offer_presentation VALUES ($1,2,$2,$3,now())', [ID, 'Titre', 'actor']))
        .rejects.toMatchObject({ code: '42501' });
    } finally { await admin.query('RESET ROLE'); }
    const version = await offer(ID, { title: false });
    await expect(admin.query('INSERT INTO catalog.offer_presentation VALUES ($1,$2,$3,$4,now())', [ID, version, '', 'actor']))
      .rejects.toMatchObject({ code: '23514' });
  });
});
