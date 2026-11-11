import 'reflect-metadata';
import { createHash, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '@achat/contracts/api';
import { AppModule } from '../../src/app.module';
import { createDatabase, withTransaction, type Database } from '../../src/http/database';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import { hashPin, issueSessionTokens } from '../../src/modules/identity/domain';
import { sessionCookieValue } from '../../src/modules/identity/session.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { approveDocumentReview, proposeDocumentReview } from '../../src/workflows/beneficiary-payment';
import {
  decideBeneficiaryPayout,
  instructBeneficiaryPayout,
  prepareBeneficiaryPayout,
  recordBeneficiaryPayoutExecution,
} from '../../src/workflows/beneficiary-payout';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import {
  AGREEMENT_STACK_MIGRATIONS,
  AGREEMENT_STACK_SCHEMAS,
  createAgreementC,
  PLAN_C,
  publishKycLimits,
  seedCustomerAccount,
  seedLedgerGenesis,
  seedPaymentPlan,
  validateLandlord,
} from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  ...AGREEMENT_STACK_MIGRATIONS,
  'db/migrations/0007_identity_clock.sql',
  'db/migrations/0016_identity_pin_guard.sql',
  'db/migrations/0017_api_idempotency.sql',
  'db/migrations/0022_catalog_public_presentation.sql',
  'db/migrations/0023_identity_account_security.sql',
  'db/migrations/0038_partner_ledger_identity.sql',
  'db/migrations/0039_agreements_handover.sql',
  'db/migrations/0040_settlement_handover.sql',
  'db/migrations/0043_settlement_beneficiary.sql',
  'db/migrations/0044_agreements_beneficiary_payment.sql',
  'db/migrations/0041_settlement_payout.sql',
  'db/migrations/0042_settlement_execution.sql',
  'db/migrations/0045_settlement_refund.sql',
  'db/migrations/0046_agreements_refunded.sql',
  'db/migrations/0047_settlement_beneficiary_payout.sql',
].map((path) => resolve(process.cwd(), path));

type Goal = components['schemas']['Goal'];
type BeneficiaryDocument = components['schemas']['BeneficiaryDocument'];
type ProblemBody = { readonly code: string };
type BeneficiaryReceipt = components['schemas']['BeneficiaryReceipt'];

const ORIGIN = 'https://app.example.test';
const A = '019a9e00-0000-7000-8000-0000000000c1';
const B = '019a9e00-0000-7000-8000-0000000000c2';
const RENT = '019a9e00-0000-7000-8000-0000000000a1';
const LEASE = createHash('sha256').update('bail signé — fichier de test HTTP').digest('hex');
const COMP1: AdminPrincipal = { actorId: 'comp-1', roles: ['COMPLIANCE'] };
const COMP2: AdminPrincipal = { actorId: 'comp-2', roles: ['COMPLIANCE'] };
const FIN1: AdminPrincipal = { actorId: 'fin-1', roles: ['FINANCE'], maxAmountXaf: 1_000_000n };
const FIN2: AdminPrincipal = { actorId: 'fin-2', roles: ['FINANCE'], maxAmountXaf: 1_000_000n };
const PLATFORM_KEY = generateKeyPairSync('ed25519').privateKey;

let db: TestDatabase;
let admin: Client;
let database: Database;
let app: INestApplication;
let migrationSql: string[];
let cookies: Record<'A' | 'B', string>;
const PEPPER = randomBytes(32);
const PIN = '284917';

function server(): Server {
  return app.getHttpServer() as Server;
}

async function session(accountId: string): Promise<{ cookie: string; privateKey: KeyObject }> {
  const device = uuidv7();
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  await admin.query(
    `INSERT INTO identity.device(id, account_id, public_key_pem, fingerprint, name, status, registered_at)
     VALUES ($1, $2, $3, $4, 'Appareil test', 'ACTIVE', now())`,
    [
      device,
      accountId,
      publicKey.export({ type: 'spki', format: 'pem' }),
      createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest(),
    ],
  );
  const sessionId = uuidv7();
  const token = issueSessionTokens();
  await admin.query(
    `INSERT INTO identity.session(id, account_id, device_id, access_token_hash, refresh_token_hash,
       access_issued_at, access_expires_at, refresh_expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, now() - interval '5 minutes', now() + interval '10 minutes',
       now() + interval '1 day', now() - interval '5 minutes')`,
    [sessionId, accountId, device, token.accessTokenHash, token.refreshTokenHash],
  );
  await admin.query(
    `INSERT INTO identity.pin_credential (device_id, account_id, pin_hash, lockouts, locked_until, updated_at)
     VALUES ($1, $2, $3, 0, NULL, now())`,
    [device, accountId, await hashPin(PIN, PEPPER)],
  );
  return { cookie: `client_session=${sessionCookieValue(sessionId, token.accessToken)}`, privateKey };
}

function deposit(body: unknown, key: string, cookie = cookies.A, goalId = RENT): request.Test {
  return request(server())
    .post(`/v1/goals/${goalId}/beneficiary-documents`)
    .set('Cookie', cookie)
    .set('Origin', ORIGIN)
    .set('Idempotency-Key', key)
    .send(body as object);
}

function payment(body: unknown, key: string, cookie = cookies.A, goalId = RENT): request.Test {
  return request(server())
    .post(`/v1/goals/${goalId}/beneficiary-payment`)
    .set('Cookie', cookie)
    .set('Origin', ORIGIN)
    .set('Idempotency-Key', key)
    .send(body as object);
}

async function fund(): Promise<void> {
  const attemptId = uuidv7();
  await withTransaction(database, async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId: RENT, channel: 'MTN_MOMO', amountXaf: 300_000n, idemKey: uuidv7() });
    await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
  });
  await withTransaction(database, (client) =>
    confirmPaymentAndFundAgreement(client, {
      attemptId,
      customerId: A,
      providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: 300_000n, outcome: 'SUCCEEDED' },
      actorId: 'payments-worker',
    }),
  );
}

async function validate(documentId: string): Promise<void> {
  await withTransaction(database, (client) => proposeDocumentReview(client, { documentId, principal: COMP1, decision: 'APPROVED' }));
  await withTransaction(database, (client) => approveDocumentReview(client, { documentId, principal: COMP2 }));
}

async function count(sql: string): Promise<number> {
  const result = await admin.query<{ n: number }>(sql);
  return result.rows[0]?.n ?? -1;
}

beforeAll(async () => {
  migrationSql = await Promise.all(MIGRATIONS.map((path) => readFile(path, 'utf8')));
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ database, allowedOrigins: new Set([ORIGIN]), pinPepper: PEPPER })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
}, 120_000);

afterAll(async () => {
  await app.close();
  await database.pool.end();
  await admin.end();
  await db.stop();
});

beforeEach(async () => {
  for (const schema of ['api', 'settlement', ...AGREEMENT_STACK_SCHEMAS]) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
  await admin.query('BEGIN');
  await validateLandlord(admin, uuidv7());
  await seedPaymentPlan(admin, PLAN_C);
  await createAgreementC(admin, { id: RENT, customerId: A, active: true });
  await admin.query('COMMIT');
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, A, 'STRONG');
  await seedCustomerAccount(admin, B, 'STRONG');
  await publishKycLimits(admin);
  cookies = { A: (await session(A)).cookie, B: (await session(B)).cookie };
});

describe('F-PLN-002 dépôt de la pièce du bénéficiaire par le client', () => {
  it('dépose l’empreinte du bail : 201, en attente d’examen, seule l’empreinte est conservée', async () => {
    const response = await deposit({ kind: 'LEASE', sha256: LEASE }, 'benef-doc-000001');
    expect(response.status).toBe(201);
    const body = response.body as BeneficiaryDocument;
    expect(body).toMatchObject({ goalId: RENT, kind: 'LEASE', sha256: LEASE, reviewStatus: 'PENDING' });
    const stored = await admin.query<{ sha: string }>("SELECT encode(sha256, 'hex') AS sha FROM settlement.beneficiary_document WHERE id = $1", [body.documentId]);
    expect(stored.rows).toEqual([{ sha: LEASE }]);
  });

  it('I-5 un rejeu avec la même clé ne dépose qu’une pièce', async () => {
    const first = await deposit({ kind: 'LEASE', sha256: LEASE }, 'benef-doc-replay1');
    const again = await deposit({ kind: 'LEASE', sha256: LEASE }, 'benef-doc-replay1');
    expect(again.status).toBe(201);
    expect((again.body as BeneficiaryDocument).documentId).toBe((first.body as BeneficiaryDocument).documentId);
    expect(await count('SELECT count(*)::int AS n FROM settlement.beneficiary_document')).toBe(1);
  });

  it('l’objectif d’un autre client est introuvable (AGREEMENT_NOT_FOUND, sans oracle)', async () => {
    const response = await deposit({ kind: 'LEASE', sha256: LEASE }, 'benef-doc-other01', cookies.B);
    expect(response.status).toBe(404);
    expect((response.body as ProblemBody).code).toBe('AGREEMENT_NOT_FOUND');
    expect(await count('SELECT count(*)::int AS n FROM settlement.beneficiary_document')).toBe(0);
  });

  it('refuse un champ hors liste blanche, une empreinte invalide ou une pièce non exigée', async () => {
    const extra = await deposit({ kind: 'LEASE', sha256: LEASE, fileName: 'bail.pdf' }, 'benef-doc-bad0001');
    expect(extra.status).toBe(400);
    expect((extra.body as ProblemBody).code).toBe('SETTLEMENT_INVALID_REQUEST');
    const hash = await deposit({ kind: 'LEASE', sha256: 'abc' }, 'benef-doc-bad0002');
    expect((hash.body as ProblemBody).code).toBe('SETTLEMENT_INVALID_REQUEST');
    const kind = await deposit({ kind: 'LAND_TITLE', sha256: LEASE }, 'benef-doc-bad0003');
    expect((kind.body as ProblemBody).code).toBe('SETTLEMENT_INVALID_REQUEST');
  });

  it('exige l’Origin autorisée et la clé d’idempotence', async () => {
    const noOrigin = await request(server())
      .post(`/v1/goals/${RENT}/beneficiary-documents`)
      .set('Cookie', cookies.A)
      .set('Idempotency-Key', 'benef-doc-noorig1')
      .send({ kind: 'LEASE', sha256: LEASE });
    expect(noOrigin.status).toBe(403);
    const noKey = await request(server())
      .post(`/v1/goals/${RENT}/beneficiary-documents`)
      .set('Cookie', cookies.A)
      .set('Origin', ORIGIN)
      .send({ kind: 'LEASE', sha256: LEASE });
    expect(noKey.status).toBe(400);
    expect(await count('SELECT count(*)::int AS n FROM settlement.beneficiary_document')).toBe(0);
  });
});

describe('F-PLN-003 / SEC-AUTH-002 règlement au bénéficiaire sous PIN', () => {
  async function readyToPay(): Promise<void> {
    await fund();
    const response = await deposit({ kind: 'LEASE', sha256: LEASE }, 'benef-doc-ready01');
    await validate((response.body as BeneficiaryDocument).documentId);
  }

  it('règle le bénéficiaire avec le bon PIN : objectif PAID_TO_BENEFICIARY', async () => {
    await readyToPay();
    const response = await payment({ pin: PIN }, 'benef-pay-0000001');
    expect(response.status).toBe(200);
    expect((response.body as Goal).status).toBe('PAID_TO_BENEFICIARY');
  });

  it('I-5 un rejeu n’écrit qu’un règlement', async () => {
    await readyToPay();
    await payment({ pin: PIN }, 'benef-pay-replay1');
    const again = await payment({ pin: PIN }, 'benef-pay-replay1');
    expect(again.status).toBe(200);
    expect(await count("SELECT count(*)::int AS n FROM ledger.journal_entry WHERE operation_type = 'BENEFICIARY_PAYMENT'")).toBe(1);
  });

  it('mauvais PIN : échec compté, rien n’est réglé (IDENTITY_PIN_INVALID)', async () => {
    await readyToPay();
    const response = await payment({ pin: '000000' }, 'benef-pay-badpin1');
    expect((response.body as ProblemBody).code).toBe('IDENTITY_PIN_INVALID');
    expect(await count('SELECT count(*)::int AS n FROM settlement.beneficiary_payment')).toBe(0);
    expect(await count(`SELECT failed_attempts AS n FROM identity.pin_credential WHERE account_id = '${A}'`)).toBe(1);
  });

  it('sans pièce validée : refus SETTLEMENT_DOCUMENT_REQUIRED (422)', async () => {
    await fund();
    const response = await payment({ pin: PIN }, 'benef-pay-nodoc01');
    expect(response.status).toBe(422);
    expect((response.body as ProblemBody).code).toBe('SETTLEMENT_DOCUMENT_REQUIRED');
  });

  it('un autre client ne règle pas l’objectif de A (AGREEMENT_NOT_FOUND)', async () => {
    await readyToPay();
    const response = await payment({ pin: PIN }, 'benef-pay-other01', cookies.B);
    expect(response.status).toBe(404);
    expect((response.body as ProblemBody).code).toBe('AGREEMENT_NOT_FOUND');
    expect(await count('SELECT count(*)::int AS n FROM settlement.beneficiary_payment')).toBe(0);
  });

  it('refuse un corps sans PIN ou avec un champ en trop', async () => {
    await readyToPay();
    expect((await payment({}, 'benef-pay-bad0001')).status).toBe(400);
    expect((await payment({ pin: PIN, amountXaf: '1' }, 'benef-pay-bad0002')).status).toBe(400);
    expect(await count('SELECT count(*)::int AS n FROM settlement.beneficiary_payment')).toBe(0);
  });
});

describe('F-PLN-003 / D58 reçu de règlement consultable par le client', () => {
  function receipt(cookie = cookies.A): request.Test {
    return request(server()).get(`/v1/goals/${RENT}/beneficiary-receipt`).set('Cookie', cookie);
  }

  async function paidAndSent(outcome: 'EXECUTED' | 'REJECTED' = 'EXECUTED'): Promise<string> {
    await fund();
    const doc = await deposit({ kind: 'LEASE', sha256: LEASE }, 'benef-doc-receipt');
    await validate((doc.body as BeneficiaryDocument).documentId);
    expect((await payment({ pin: PIN }, 'benef-pay-receipt')).status).toBe(200);
    const payout = await withTransaction(database, (client) => prepareBeneficiaryPayout(client, { id: uuidv7(), agreementId: RENT, principal: FIN1 }));
    await withTransaction(database, (client) => decideBeneficiaryPayout(client, { payoutId: payout.payoutId, principal: FIN2, decision: 'APPROVED' }));
    await withTransaction(database, (client) => instructBeneficiaryPayout(client, { payoutId: payout.payoutId, principal: FIN2, signingKey: PLATFORM_KEY, keyId: 'k1' }));
    await withTransaction(database, (client) =>
      recordBeneficiaryPayoutExecution(client, { payoutId: payout.payoutId, principal: FIN1, outcome, bankReference: 'ETAB-VIR-77' }),
    );
    return payout.payoutId;
  }

  it('après exécution par l’établissement : reçu avec montant, bénéficiaire, référence et empreinte de l’écriture', async () => {
    const payoutId = await paidAndSent();
    const response = await receipt();
    expect(response.status).toBe(200);
    const body = response.body as BeneficiaryReceipt;
    expect(body).toMatchObject({ goalId: RENT, payoutId, beneficiaryId: 'landlord-1', amountXaf: '300000', bankReference: 'ETAB-VIR-77' });
    expect(body.entryHashPrefix).toMatch(/^[0-9a-f]{8}$/);
    const hash = await admin.query<{ prefix: string }>(
      `SELECT substr(encode(e.entry_hash, 'hex'), 1, 8) AS prefix FROM settlement.beneficiary_payout_execution x
         JOIN ledger.journal_entry e ON e.id = x.entry_id`,
    );
    expect(body.entryHashPrefix).toBe(hash.rows[0]?.prefix);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('virement refusé par l’établissement ou pas encore exécuté : aucun reçu (404)', async () => {
    await paidAndSent('REJECTED');
    const response = await receipt();
    expect(response.status).toBe(404);
    expect((response.body as ProblemBody).code).toBe('SETTLEMENT_NOT_FOUND');
  });

  it('un autre client ne voit pas le reçu (AGREEMENT_NOT_FOUND)', async () => {
    await paidAndSent();
    const response = await receipt(cookies.B);
    expect(response.status).toBe(404);
    expect((response.body as ProblemBody).code).toBe('AGREEMENT_NOT_FOUND');
  });
});

