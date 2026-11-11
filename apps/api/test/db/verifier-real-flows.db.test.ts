import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildBatch, signTreeHead } from '@achat/chain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { exportLedgerEntries, type ExportedEntry } from '../../src/modules/ledger/export.store';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { issueHandoverCode } from '../../src/modules/settlement/handover.store';
import { payBeneficiaryForCustomer } from '../../src/workflows/beneficiary-payment';
import {
  decideBeneficiaryPayout,
  instructBeneficiaryPayout,
  prepareBeneficiaryPayout,
  recordBeneficiaryPayoutExecution,
} from '../../src/workflows/beneficiary-payout';
import { confirmHandoverAtPartner } from '../../src/workflows/handover';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import { decidePayout, instructPayout, preparePayout, recordPayoutExecution } from '../../src/workflows/settlement-payout';
import { decideRefund, instructRefund, prepareRefund, recordRefundExecution } from '../../src/workflows/refund';
import {
  createAgreementA,
  createAgreementC,
  PLAN_A,
  PLAN_C,
  publishKycLimits,
  publishOfferA,
  publishSetting,
  seedCustomerAccount,
  seedLedgerGenesis,
  seedPaymentPlan,
  validateBeneficiary,
  validateMerchant,
} from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

/**
 * INT-VER-001/003 : le vérificateur indépendant (Rust, binaire réel) relit un
 * grand livre produit par les flux réels de l'API — versements, règlement au
 * bénéficiaire, virement, remboursement — exporté depuis PostgreSQL, et
 * détecte une altération de cet export.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
const MANIFEST = resolve(process.cwd(), 'tools/verifier/Cargo.toml');
const BINARY = resolve(process.cwd(), 'tools/verifier/target/release/verifier');
const SCHEMAS = ['risk', 'settlement', 'disputes', 'reconciliation', 'payments', 'notifications', 'api', 'agreements', 'catalog', 'identity', 'admin', 'audit', 'ledger'];
const CUSTOMER_ID = '019aa200-0000-7000-8000-0000000000c1';
const PAID_GOAL = '019aa200-0000-7000-8000-0000000000a1';
const REFUNDED_GOAL = '019aa200-0000-7000-8000-0000000000a2';
const PURCHASE = '019aa200-0000-7000-8000-0000000000a3';
const OFFER_ID = '019aa200-0000-7000-8000-0000000000f1';
const PEPPER = randomBytes(32);
const OPS: AdminPrincipal = { actorId: 'ops-1', roles: ['OPERATIONS'] };
const FIN: AdminPrincipal = { actorId: 'fin-1', roles: ['FINANCE'], maxAmountXaf: 1_000_000n };
const FIN2: AdminPrincipal = { actorId: 'fin-2', roles: ['FINANCE'], maxAmountXaf: 1_000_000n };
const PLATFORM = generateKeyPairSync('ed25519');
const LOG_KEY = generateKeyPairSync('ed25519');
const LOG_ID = 'molopay-flux-reels-test';

let container: TestDatabase;
let admin: Client;
let workdir: string;
let entries: readonly ExportedEntry[];

async function transact<T>(role: 'app_rw' | 'app_ro' | null, action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (role !== null) {
      await client.query(`SET LOCAL ROLE ${role}`);
    }
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function pending(agreementId: string, amount: bigint): Promise<string> {
  const attemptId = uuidv7();
  await transact('app_rw', async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId, channel: 'MTN_MOMO', amountXaf: amount, idemKey: uuidv7() });
    await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
  });
  return attemptId;
}

async function pay(agreementId: string, amount: bigint, attempt?: string): Promise<void> {
  const attemptId = attempt ?? (await pending(agreementId, amount));
  await transact('app_rw', (client) =>
    confirmPaymentAndFundAgreement(client, {
      attemptId,
      customerId: CUSTOMER_ID,
      providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: amount, outcome: 'SUCCEEDED' },
      actorId: 'payments-worker',
    }),
  );
}

/** Export complet signé : un lot Merkle couvrant toutes les écritures, tête signée, témoin identique. */
function exportDocument(list: readonly ExportedEntry[]): object {
  const batch = buildBatch(list.map((entry) => ({ seq: entry.seq, entryHash: Buffer.from(entry.entry_hash, 'hex') })));
  const signed = signTreeHead(
    { treeSize: batch.treeSize, rootHash: batch.rootHash.toString('hex'), timestamp: '2026-11-11T12:00:00.000Z', logId: LOG_ID },
    LOG_KEY.privateKey,
  );
  return {
    version: 1,
    log_id: LOG_ID,
    generated_at: '2026-11-11T12:00:00.000Z',
    entries: list,
    tree_heads: [
      { tree_size: signed.head.treeSize, root_hash: signed.head.rootHash, timestamp: signed.head.timestamp, log_id: LOG_ID, signature: signed.signature },
    ],
    witness_heads: [{ tree_size: signed.head.treeSize, root_hash: signed.head.rootHash }],
  };
}

function runVerifier(document: object): { status: number | null; stdout: string; stderr: string } {
  const exportPath = join(workdir, `export-${uuidv7()}.json`);
  writeFileSync(exportPath, JSON.stringify(document));
  const raw = LOG_KEY.publicKey.export({ type: 'spki', format: 'der' });
  const keyPath = join(workdir, 'public-key.txt');
  writeFileSync(keyPath, raw.subarray(raw.length - 32).toString('hex'));
  const result = spawnSync(BINARY, ['-export', exportPath, '-public-key', keyPath], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeAll(async () => {
  // Binaire à jour (liste blanche des types d'écriture) : compilation incrémentale hors ligne.
  const build = spawnSync('cargo', ['build', '--release', '--offline', '--manifest-path', MANIFEST], { encoding: 'utf8' });
  if (build.status !== 0) {
    throw new Error(`VERIFIER_BUILD_FAILED ${build.stderr}`);
  }
  workdir = mkdtempSync(join(tmpdir(), 'molopay-verifier-'));
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  for (const schema of SCHEMAS) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const name of readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(resolve(DIRECTORY, name), 'utf8'));
  }
  await transact('app_rw', async (client) => {
    await validateBeneficiary(client, uuidv7(), 'school-1', 'SCHOOL');
    await validateMerchant(client, uuidv7());
    await seedPaymentPlan(client, PLAN_C);
    await seedPaymentPlan(client, PLAN_A);
    await publishOfferA(client, { offerId: OFFER_ID, partnerId: 'merchant-1', priceXaf: 150_000n });
    await createAgreementA(client, { id: PURCHASE, customerId: CUSTOMER_ID, offerId: OFFER_ID });
    await createAgreementC(client, { id: PAID_GOAL, customerId: CUSTOMER_ID, active: true, beneficiaryId: 'school-1' });
    await createAgreementC(client, { id: REFUNDED_GOAL, customerId: CUSTOMER_ID, active: true, beneficiaryId: 'school-1' });
  });
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER_ID, 'STRONG');
  await publishKycLimits(admin, {
    BASIC: { holdingXaf: 200_000n, monthlyXaf: 500_000n },
    STRONG: { holdingXaf: 2_000_000n, monthlyXaf: 2_000_000n },
  });

  // Objectif C : versements, règlement au bénéficiaire, virement exécuté.
  await pay(PAID_GOAL, 100_000n);
  await pay(PAID_GOAL, 200_000n);
  await transact('app_rw', (client) => payBeneficiaryForCustomer(client, { agreementId: PAID_GOAL, customerId: CUSTOMER_ID }));
  const payout = await transact('app_rw', (client) => prepareBeneficiaryPayout(client, { id: uuidv7(), agreementId: PAID_GOAL, principal: OPS }));
  await transact('app_rw', (client) => decideBeneficiaryPayout(client, { payoutId: payout.payoutId, principal: FIN, decision: 'APPROVED' }));
  await transact('app_rw', (client) => instructBeneficiaryPayout(client, { payoutId: payout.payoutId, principal: FIN, signingKey: PLATFORM.privateKey, keyId: 'k1' }));
  await transact('app_rw', (client) =>
    recordBeneficiaryPayoutExecution(client, { payoutId: payout.payoutId, principal: FIN2, outcome: 'EXECUTED', bankReference: 'ETAB-VIR-1' }),
  );

  // Objectif annulé puis remboursé.
  await pay(REFUNDED_GOAL, 50_000n);
  await admin.query(
    `INSERT INTO agreements.status_event (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
     SELECT $1, max(seq) + 1, 'TRANSITION', 'ACTIVE', 'CANCELLED_BY_CUSTOMER', $2, $3, 'client-1', now() FROM agreements.status_event WHERE agreement_id = $1`,
    [REFUNDED_GOAL, uuidv7(), Buffer.alloc(64, 9)],
  );
  const refund = await transact('app_rw', (client) => prepareRefund(client, { id: uuidv7(), agreementId: REFUNDED_GOAL, kind: 'CANCELLATION', principal: OPS }));
  await transact('app_rw', (client) => decideRefund(client, { refundId: refund.refundId, principal: FIN, decision: 'APPROVED' }));
  await transact('app_rw', (client) => instructRefund(client, { refundId: refund.refundId, principal: FIN, signingKey: PLATFORM.privateKey, keyId: 'k1' }));
  await transact('app_rw', (client) =>
    recordRefundExecution(client, { refundId: refund.refundId, principal: FIN2, outcome: 'EXECUTED', bankReference: 'ETAB-REMB-1' }),
  );

  // Achat A : trop-perçu (deux tentatives concurrentes), restitution du surplus,
  // remise en boutique, commission et règlement net du marchand.
  await publishSetting(admin, 'handover_code_validity_days', 30);
  await publishSetting(admin, 'merchant_commission_bps', 250);
  await publishSetting(admin, 'settlement_contestation_days', 0);
  const first = await pending(PURCHASE, 100_000n);
  const second = await pending(PURCHASE, 100_000n);
  await pay(PURCHASE, 100_000n, first);
  await pay(PURCHASE, 100_000n, second);
  const surplus = await transact('app_rw', (client) => prepareRefund(client, { id: uuidv7(), agreementId: PURCHASE, kind: 'SURPLUS', principal: OPS }));
  await transact('app_rw', (client) => decideRefund(client, { refundId: surplus.refundId, principal: FIN, decision: 'APPROVED' }));
  await transact('app_rw', (client) => instructRefund(client, { refundId: surplus.refundId, principal: FIN, signingKey: PLATFORM.privateKey, keyId: 'k1' }));
  await transact('app_rw', (client) =>
    recordRefundExecution(client, { refundId: surplus.refundId, principal: FIN2, outcome: 'EXECUTED', bankReference: 'ETAB-REMB-2' }),
  );
  const { code } = await transact('app_rw', (client) => issueHandoverCode(client, { agreementId: PURCHASE, pepper: PEPPER, actorId: 'system-handover' }));
  await transact('app_rw', (client) =>
    confirmHandoverAtPartner(client, { code, partnerId: 'merchant-1', partnerUserId: 'vendeur-1', latitude: '4.051056', longitude: '9.767869', pepper: PEPPER }),
  );
  const settlement = await transact('app_rw', (client) => preparePayout(client, { id: uuidv7(), agreementId: PURCHASE, cityId: 'douala', principal: { ...OPS, cityIds: ['douala'] } }));
  await transact('app_rw', (client) =>
    decidePayout(client, { payoutId: settlement.payoutId, principal: { ...FIN, cityIds: ['douala'] }, decision: 'APPROVED', cityId: 'douala' }),
  );
  await transact('app_rw', (client) =>
    instructPayout(client, { payoutId: settlement.payoutId, principal: { ...FIN, cityIds: ['douala'] }, cityId: 'douala', signingKey: PLATFORM.privateKey, keyId: 'k1' }),
  );
  await transact('app_rw', (client) =>
    recordPayoutExecution(client, { payoutId: settlement.payoutId, principal: { ...FIN2, cityIds: ['douala'] }, cityId: 'douala', outcome: 'EXECUTED', bankReference: 'ETAB-REG-1' }),
  );

  entries = await transact('app_ro', (client) => exportLedgerEntries(client));
}, 600_000);

afterAll(async () => {
  await admin.end();
  await container.stop();
  rmSync(workdir, { recursive: true, force: true });
});

describe('INT-VER-001/003 vérificateur indépendant sur un grand livre produit par les flux réels', () => {
  it('l’export contient les types attendus des flux réels', () => {
    expect(entries.map((entry) => entry.type)).toEqual([
      'GENESIS',
      'PAYMENT_CONFIRMED',
      'PAYMENT_CONFIRMED',
      'BENEFICIARY_PAYMENT',
      'SETTLEMENT_SENT',
      'PAYMENT_CONFIRMED',
      'REFUND_SENT',
      'PAYMENT_CONFIRMED',
      'PAYMENT_CONFIRMED',
      'REFUND_SENT',
      'HANDOVER',
      'FEE_CHARGED',
      'SETTLEMENT_SENT',
    ]);
  });

  it('le binaire Rust vérifie équilibre, chaîne, Merkle, signature et témoin', () => {
    const result = runVerifier(exportDocument(entries));
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`LEDGER VERIFIED entries=${entries.length}`);
  });

  it('une altération d’un montant de l’export est détectée', () => {
    const tampered = structuredClone(entries) as ExportedEntry[];
    const refund = tampered.find((entry) => entry.type === 'REFUND_SENT');
    const first = refund?.postings[0];
    if (refund === undefined || first === undefined) {
      throw new Error('écriture REFUND_SENT attendue');
    }
    (refund as { postings: ExportedEntry['postings'] }).postings = [{ ...first, amount_xaf: '50001' }, ...refund.postings.slice(1)];
    const result = runVerifier(exportDocument(tampered));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ENTRY_UNBALANCED|HASH/);
  });
});
