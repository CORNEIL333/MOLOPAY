import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, withTransaction, type Database } from '../../src/http/database';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { exportLedgerEntries } from '../../src/modules/ledger/export.store';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import { createSaveThenBuyAgreement } from '../../src/modules/agreements/agreement.store';
import { PLAN_A, publishKycLimits, publishOfferA, seedCustomerAccount, seedLedgerGenesis, seedPaymentPlan, validateMerchant, publishCommitmentLimits } from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';
import { exportDocument } from './real-flows-scenario';

/**
 * CDC_07 § 3 « Concurrence » : 1 000 versements confirmés simultanément sur
 * un même objectif (pool de 10 connexions, flux réel de confirmation). Aucun
 * versement perdu ni compté deux fois, reçus et séquence du grand livre sans
 * trou, chaîne vérifiée par le vérificateur indépendant (binaire Rust).
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const SCHEMAS = ['crm', 'kyc', 'risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const MANIFEST = resolve(process.cwd(), 'tools/verifier/Cargo.toml');
const BINARY = resolve(process.cwd(), 'tools/verifier/target/release/verifier');
const CUSTOMER = '019ab900-0000-7000-8000-0000000000c1';
const GOAL = '019ab900-0000-7000-8000-0000000000a1';
const OFFER = '019ab900-0000-7000-8000-0000000000f1';
const COUNT = 1000;
const AMOUNT = 1_000n;
// Plan de test à petit minimum : 1 000 × 1 000 FCFA reste sous les plafonds KYC (D43).
const PLAN_SMALL = { ...PLAN_A, planId: 'plan-a-petit', minAmountXaf: 1_000n };
const LOG_KEY = generateKeyPairSync('ed25519');

let db: TestDatabase;
let admin: Client;
let database: Database;

beforeAll(async () => {
  const build = spawnSync('cargo', ['build', '--release', '--offline', '--manifest-path', MANIFEST], { encoding: 'utf8' });
  if (build.status !== 0) {
    throw new Error(`VERIFIER_BUILD_FAILED ${build.stderr}`);
  }
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.getConnectionUri() });
  await admin.connect();
  for (const schema of SCHEMAS) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const name of readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(resolve(DIRECTORY, name), 'utf8'));
  }
  await publishCommitmentLimits(admin);
  await admin.query('BEGIN');
  await validateMerchant(admin, uuidv7());
  await seedPaymentPlan(admin, PLAN_SMALL);
  await publishOfferA(admin, { offerId: OFFER, partnerId: 'merchant-1', priceXaf: 10_000_000n });
  await createSaveThenBuyAgreement(admin, { id: GOAL, customerId: CUSTOMER, offerId: OFFER, planId: PLAN_SMALL.planId, durationMonths: 3, createdAt: '2026-11-01T09:00:00.000Z' });
  await admin.query(
    `INSERT INTO agreements.status_event (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
     VALUES ($1, 1, 'TRANSITION', 'DRAFT', 'ACTIVE', $2, $3, 'client-1', now())`,
    [GOAL, uuidv7(), Buffer.alloc(64, 9)],
  );
  await admin.query('COMMIT');
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER, 'STRONG');
  await publishKycLimits(admin);
  database = createDatabase({ connectionString: db.getConnectionUri(), role: 'app_rw' });
}, 600_000);

afterAll(async () => {
  await database.pool.end();
  await admin.end();
  await db.stop();
});

describe('CDC_07 concurrence : 1 000 versements simultanés sur un objectif', () => {
  it('aucune perte ni double comptage ; reçus 1…1000 ; séquence continue ; chaîne vérifiée', async () => {
    const attempts: string[] = [];
    for (let index = 0; index < COUNT; index += 1) {
      const attemptId = uuidv7();
      await withTransaction(database, async (client) => {
        await createStoredPaymentAttempt(client, { id: attemptId, agreementId: GOAL, channel: 'MTN_MOMO', amountXaf: AMOUNT, idemKey: uuidv7() });
        await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
      });
      attempts.push(attemptId);
    }
    // Chaque tentative confirmée deux fois en parallèle (rejeu concurrent du webhook).
    const confirmations = [...attempts, ...attempts.slice(0, 100)].map((attemptId) =>
      withTransaction(database, (client) =>
        confirmPaymentAndFundAgreement(client, {
          attemptId,
          customerId: CUSTOMER,
          providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: AMOUNT, outcome: 'SUCCEEDED' },
          actorId: 'payments-worker',
        }),
      ),
    );
    const settled = await Promise.allSettled(confirmations);
    expect(settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => String(result.reason))).toEqual([]);

    const funds = await admin.query<{ funds: string }>('SELECT agreements.confirmed_funds_xaf($1)::text AS funds', [GOAL]);
    expect(funds.rows[0]?.funds).toBe((AMOUNT * BigInt(COUNT)).toString());
    const receipts = await admin.query<{ n: number; lo: number; hi: number }>('SELECT count(*)::int AS n, min(receipt_no) AS lo, max(receipt_no) AS hi FROM payments.contribution WHERE customer_id = $1', [CUSTOMER]);
    expect(receipts.rows[0]).toEqual({ n: COUNT, lo: 1, hi: COUNT });
    const seq = await admin.query<{ n: number; lo: string; hi: string }>('SELECT count(*)::int AS n, min(seq)::text AS lo, max(seq)::text AS hi FROM ledger.journal_entry');
    const row = seq.rows[0];
    expect(Number(row?.hi) - Number(row?.lo) + 1).toBe(row?.n);
    expect(row?.n).toBe(COUNT + 1);

    const reader = new Client({ connectionString: db.getConnectionUri() });
    await reader.connect();
    const workdir = mkdtempSync(join(tmpdir(), 'molopay-concurrency-'));
    try {
      const entries = await exportLedgerEntries(reader);
      const exportPath = join(workdir, 'export.json');
      writeFileSync(exportPath, JSON.stringify(exportDocument(entries, LOG_KEY.privateKey, 'molopay-concurrence-test')));
      const raw = LOG_KEY.publicKey.export({ type: 'spki', format: 'der' });
      const keyPath = join(workdir, 'public-key.txt');
      writeFileSync(keyPath, raw.subarray(raw.length - 32).toString('hex'));
      const verified = spawnSync(BINARY, ['-export', exportPath, '-public-key', keyPath], { encoding: 'utf8' });
      expect(verified.status, verified.stderr).toBe(0);
      expect(verified.stdout).toMatch(/LEDGER VERIFIED entries=1001/);
    } finally {
      await reader.end();
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 600_000);
});
