import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { createDatabase, withTransaction, type Database } from '../src/http/database';
import { decideApproval, prepareApproval } from '../src/modules/admin/approval.store';
import type { AdminPrincipal } from '../src/modules/admin/domain';
import { createStaffPayload, grantRolesPayload, insertRoleGrant, insertStaffAccount, issueEnrollment } from '../src/modules/admin/staff.store';
import { uuidv7 } from '../src/modules/ledger/domain';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../src/modules/payments/attempt.store';
import { confirmPaymentAndFundAgreement } from '../src/workflows/payment-confirmation';
import { prepareRefund } from '../src/workflows/refund';
import {
  createAgreementC,
  PLAN_C,
  publishKycLimits,
  seedCustomerAccount,
  seedLedgerGenesis,
  seedPaymentPlan,
  validateLandlord,
} from './db/agreement-fixture';
import { startTestDatabase, type TestDatabase } from './db/harness';

/**
 * D62 / SEC-AUTH-004 : back-office de bout en bout — API réelle et base
 * jetable (toutes migrations), application Next compilée, Chromium réel avec
 * un authentificateur WebAuthn virtuel (CTAP2 via CDP). Aucun service simulé
 * côté serveur : le navigateur parle à l'API par la réécriture de Next.
 */
const ROOT = resolve(__dirname, '../../..');
const DIRECTORY = resolve(ROOT, 'db/migrations');
const SCHEMAS = ['risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const CUSTOMER = '019aad00-0000-7000-8000-0000000000c1';
const GOAL = '019aad00-0000-7000-8000-0000000000a1';
const ADMIN1: AdminPrincipal = { actorId: 'tech-1', roles: ['TECH_ADMIN'] };
const ADMIN2: AdminPrincipal = { actorId: 'tech-2', roles: ['TECH_ADMIN'] };

let db: TestDatabase;
let admin: Client;
let database: Database;
let api: INestApplication;
let web: ChildProcess;
let browser: Browser;
let page: Page;
let origin: string;
const consoleErrors: string[] = [];

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => { done(port); });
    });
  });
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) {
        return;
      }
    } catch {
      // serveur pas encore prêt
    }
    await new Promise((wait) => setTimeout(wait, 250));
  }
  throw new Error(`Serveur indisponible : ${url}`);
}

async function approved(payload: Record<string, unknown>): Promise<string> {
  const id = uuidv7();
  await withTransaction(database, (client) => prepareApproval(client, { id, kind: 'ROLE_GRANT', payload: payload as never, reason: 'Arrivée E2E', principal: ADMIN1 }));
  await withTransaction(database, (client) => decideApproval(client, { requestId: id, principal: ADMIN2, decision: 'APPROVED' }));
  return id;
}

beforeAll(async () => {
  // 1. Base jetable, toutes migrations, données de test (aucune donnée réelle).
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  for (const schema of SCHEMAS) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const name of readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(resolve(DIRECTORY, name), 'utf8'));
  }
  await admin.query('BEGIN');
  await validateLandlord(admin, uuidv7());
  await seedPaymentPlan(admin, PLAN_C);
  await createAgreementC(admin, { id: GOAL, customerId: CUSTOMER, active: true });
  await admin.query('COMMIT');
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER, 'STRONG');
  await publishKycLimits(admin);
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });

  // 2. API réelle sur un port local ; partie de confiance = origine du back-office.
  const webPort = await freePort();
  origin = `http://localhost:${webPort.toString()}`;
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.register({
        database,
        allowedOrigins: new Set([origin]),
        staffRp: { rpId: 'localhost', origins: new Set([origin]) },
        platformSigningKey: { key: generateKeyPairSync('ed25519').privateKey, keyId: 'e2e' },
      }),
    ],
  }).compile();
  api = moduleRef.createNestApplication({ logger: false });
  await api.listen(0, '127.0.0.1');
  const apiPort = ((api.getHttpServer() as Server).address() as AddressInfo).port;

  // 3. Back-office compilé puis servi en production locale. Les réécritures de
  // Next sont figées au build : l'adresse de l'API doit y être fournie.
  const build = spawnSync('pnpm', ['exec', 'next', 'build'], {
    cwd: resolve(ROOT, 'apps/back-office'),
    env: { ...process.env, API_INTERNAL_URL: `http://127.0.0.1:${apiPort.toString()}` },
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    throw new Error(`BUILD_FAILED ${build.stderr}`);
  }
  web = spawn('pnpm', ['exec', 'next', 'start', '-p', webPort.toString(), '-H', '127.0.0.1'], {
    cwd: resolve(ROOT, 'apps/back-office'),
    env: { ...process.env, API_INTERNAL_URL: `http://127.0.0.1:${apiPort.toString()}` },
    stdio: 'ignore',
  });
  await waitFor(`http://127.0.0.1:${webPort.toString()}/`, 60_000);

  // 4. Chromium réel et authentificateur WebAuthn virtuel (clé matérielle émulée par le navigateur).
  browser = await chromium.launch();
  page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  page.on('console', (message) => { if (message.type() === 'error') { consoleErrors.push(message.text()); } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'usb', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}, 300_000);

afterAll(async () => {
  await browser?.close();
  web?.kill('SIGTERM');
  await api?.close();
  await database?.pool.end();
  await admin?.end();
  await db?.stop();
});

describe('D62 back-office de bout en bout', () => {
  it('enrôlement par code, connexion par clé, file motivée, approbation d’un remboursement', { timeout: 120_000 }, async () => {
    // Agent de la finance créé en maker-checker ; code d'enrôlement émis par un administrateur.
    const staffId = uuidv7();
    await withTransaction(database, async (client) => insertStaffAccount(client, { id: staffId, login: 'fin.e2e', approvalRequestId: await approved(createStaffPayload(staffId, 'fin.e2e')) }));
    const grant = { staffId, roles: ['FINANCE'] as const, cityIds: ['douala'], maxAmountXaf: 1_000_000n };
    const grantRequest = await approved(grantRolesPayload({ ...grant, roles: [...grant.roles] }));
    await withTransaction(database, (client) => insertRoleGrant(client, { ...grant, roles: [...grant.roles], approvalRequestId: grantRequest }));
    const enrollment = await withTransaction(database, (client) => issueEnrollment(client, { staffId, actorId: 'tech-1' }));
    const code = `${enrollment.challengeId}.${enrollment.challenge.toString('base64url')}.${enrollment.enrollmentToken}`;

    // Remboursement préparé par les opérations (objectif payé puis annulé).
    const attemptId = uuidv7();
    await withTransaction(database, async (client) => {
      await createStoredPaymentAttempt(client, { id: attemptId, agreementId: GOAL, channel: 'MTN_MOMO', amountXaf: 50_000n, idemKey: uuidv7() });
      await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
    });
    await withTransaction(database, (client) =>
      confirmPaymentAndFundAgreement(client, {
        attemptId,
        customerId: CUSTOMER,
        providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: 50_000n, outcome: 'SUCCEEDED' },
        actorId: 'payments-worker',
      }),
    );
    await admin.query(
      `INSERT INTO agreements.status_event (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
       SELECT $1, max(seq) + 1, 'TRANSITION', 'ACTIVE', 'CANCELLED_BY_CUSTOMER', $2, $3, 'client-1', now() FROM agreements.status_event WHERE agreement_id = $1`,
      [GOAL, uuidv7(), Buffer.alloc(64, 9)],
    );
    const refund = await withTransaction(database, (client) =>
      prepareRefund(client, { id: uuidv7(), agreementId: GOAL, kind: 'CANCELLATION', principal: { actorId: 'ops.un', roles: ['OPERATIONS'] } }),
    );

    // Enrôlement : la clé est créée par l'authentificateur du navigateur.
    await page.goto(`${origin}/enrolement`, { waitUntil: 'networkidle' });
    await page.getByLabel('Identifiant').fill('fin.e2e');
    await page.getByLabel('Code d’enrôlement').fill(code);
    await page.getByRole('button', { name: 'Enregistrer ma clé de sécurité' }).click();
    await page.locator('main [role=status], main [role=alert], main .achat-field__error').first().waitFor();
    const enrolled = await page.locator('main').innerText();
    expect(enrolled, `${enrolled}\n${consoleErrors.join('\n')}`).toContain('Clé enregistrée');

    // Connexion par clé, sans mot de passe.
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
    await page.getByLabel('Identifiant').fill('fin.e2e');
    await page.getByRole('button', { name: 'Se connecter avec ma clé de sécurité' }).click();
    await page.waitForURL(`${origin}/file`);
    await page.waitForLoadState('networkidle');

    // File de travail avec motif, puis approbation du remboursement.
    await page.getByLabel('Motif de consultation').fill('revue quotidienne E2E');
    await page.getByRole('button', { name: 'Afficher la file' }).click();
    await page.getByRole('heading', { name: 'Remboursements (1)' }).waitFor();
    await page.getByRole('button', { name: 'Approuver' }).click();
    await page.getByText('En attente d’instruction').waitFor();

    const decision = await admin.query('SELECT decision, decided_by FROM settlement.refund_decision WHERE refund_id = $1', [refund.refundId]);
    expect(decision.rows).toEqual([{ decision: 'APPROVED', decided_by: 'fin.e2e' }]);
    const audit = await admin.query(`SELECT actor_id, reason FROM audit.event WHERE target_type = 'BACKOFFICE_QUEUE' ORDER BY seq`);
    expect(audit.rows[0]).toEqual({ actor_id: 'fin.e2e', reason: 'revue quotidienne E2E' });
  });
});
