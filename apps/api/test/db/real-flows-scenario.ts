import { generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildBatch, signTreeHead } from '@achat/chain';
import { Client } from 'pg';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import { uuidv7 } from '../../src/modules/ledger/domain';
import type { ExportedEntry } from '../../src/modules/ledger/export.store';
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

/**
 * Lot 25 / D59 : scénario de recette rejoué par les flux réels de l'API sur
 * une base jetable — aucune donnée personnelle réelle (identifiants de test,
 * montants entiers). Partagé par le test du vérificateur et l'outil de
 * génération du jeu de recette.
 */
const DIRECTORY = resolve(process.cwd(), 'db/migrations');
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

async function transact<T>(
  uri: string,
  role: 'app_rw' | 'app_ro' | null, action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: uri });
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

async function pending(uri: string, agreementId: string, amount: bigint): Promise<string> {
  const attemptId = uuidv7();
  await transact(uri, 'app_rw', async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId, channel: 'MTN_MOMO', amountXaf: amount, idemKey: uuidv7() });
    await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
  });
  return attemptId;
}

async function pay(uri: string, agreementId: string, amount: bigint, attempt?: string): Promise<void> {
  const attemptId = attempt ?? (await pending(uri, agreementId, amount));
  await transact(uri, 'app_rw', (client) =>
    confirmPaymentAndFundAgreement(client, {
      attemptId,
      customerId: CUSTOMER_ID,
      providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: amount, outcome: 'SUCCEEDED' },
      actorId: 'payments-worker',
    }),
  );
}

/** Applique toutes les migrations dans l'ordre puis rejoue les flux : objectif C réglé et viré, objectif annulé et remboursé, achat A avec trop-perçu, remise et règlement marchand. */
export async function runRealFlowsScenario(uri: string, admin: Client): Promise<void> {
  for (const schema of SCHEMAS) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const name of readdirSync(DIRECTORY).filter((file) => file.endsWith('.sql')).sort()) {
    await admin.query(readFileSync(resolve(DIRECTORY, name), 'utf8'));
  }
  await transact(uri, 'app_rw', async (client) => {
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
  await pay(uri, PAID_GOAL, 100_000n);
  await pay(uri, PAID_GOAL, 200_000n);
  await transact(uri, 'app_rw', (client) => payBeneficiaryForCustomer(client, { agreementId: PAID_GOAL, customerId: CUSTOMER_ID }));
  const payout = await transact(uri, 'app_rw', (client) => prepareBeneficiaryPayout(client, { id: uuidv7(), agreementId: PAID_GOAL, principal: OPS }));
  await transact(uri, 'app_rw', (client) => decideBeneficiaryPayout(client, { payoutId: payout.payoutId, principal: FIN, decision: 'APPROVED' }));
  await transact(uri, 'app_rw', (client) => instructBeneficiaryPayout(client, { payoutId: payout.payoutId, principal: FIN, signingKey: PLATFORM.privateKey, keyId: 'k1' }));
  await transact(uri, 'app_rw', (client) =>
    recordBeneficiaryPayoutExecution(client, { payoutId: payout.payoutId, principal: FIN2, outcome: 'EXECUTED', bankReference: 'ETAB-VIR-1' }),
  );

  // Objectif annulé puis remboursé.
  await pay(uri, REFUNDED_GOAL, 50_000n);
  await admin.query(
    `INSERT INTO agreements.status_event (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
     SELECT $1, max(seq) + 1, 'TRANSITION', 'ACTIVE', 'CANCELLED_BY_CUSTOMER', $2, $3, 'client-1', now() FROM agreements.status_event WHERE agreement_id = $1`,
    [REFUNDED_GOAL, uuidv7(), Buffer.alloc(64, 9)],
  );
  const refund = await transact(uri, 'app_rw', (client) => prepareRefund(client, { id: uuidv7(), agreementId: REFUNDED_GOAL, kind: 'CANCELLATION', principal: OPS }));
  await transact(uri, 'app_rw', (client) => decideRefund(client, { refundId: refund.refundId, principal: FIN, decision: 'APPROVED' }));
  await transact(uri, 'app_rw', (client) => instructRefund(client, { refundId: refund.refundId, principal: FIN, signingKey: PLATFORM.privateKey, keyId: 'k1' }));
  await transact(uri, 'app_rw', (client) =>
    recordRefundExecution(client, { refundId: refund.refundId, principal: FIN2, outcome: 'EXECUTED', bankReference: 'ETAB-REMB-1' }),
  );

  // Achat A : trop-perçu (deux tentatives concurrentes), restitution du surplus,
  // remise en boutique, commission et règlement net du marchand.
  await publishSetting(admin, 'handover_code_validity_days', 30);
  await publishSetting(admin, 'merchant_commission_bps', 250);
  await publishSetting(admin, 'settlement_contestation_days', 0);
  const first = await pending(uri, PURCHASE, 100_000n);
  const second = await pending(uri, PURCHASE, 100_000n);
  await pay(uri, PURCHASE, 100_000n, first);
  await pay(uri, PURCHASE, 100_000n, second);
  const surplus = await transact(uri, 'app_rw', (client) => prepareRefund(client, { id: uuidv7(), agreementId: PURCHASE, kind: 'SURPLUS', principal: OPS }));
  await transact(uri, 'app_rw', (client) => decideRefund(client, { refundId: surplus.refundId, principal: FIN, decision: 'APPROVED' }));
  await transact(uri, 'app_rw', (client) => instructRefund(client, { refundId: surplus.refundId, principal: FIN, signingKey: PLATFORM.privateKey, keyId: 'k1' }));
  await transact(uri, 'app_rw', (client) =>
    recordRefundExecution(client, { refundId: surplus.refundId, principal: FIN2, outcome: 'EXECUTED', bankReference: 'ETAB-REMB-2' }),
  );
  const { code } = await transact(uri, 'app_rw', (client) => issueHandoverCode(client, { agreementId: PURCHASE, pepper: PEPPER, actorId: 'system-handover' }));
  await transact(uri, 'app_rw', (client) =>
    confirmHandoverAtPartner(client, { code, partnerId: 'merchant-1', partnerUserId: 'vendeur-1', latitude: '4.051056', longitude: '9.767869', pepper: PEPPER }),
  );
  const settlement = await transact(uri, 'app_rw', (client) => preparePayout(client, { id: uuidv7(), agreementId: PURCHASE, cityId: 'douala', principal: { ...OPS, cityIds: ['douala'] } }));
  await transact(uri, 'app_rw', (client) =>
    decidePayout(client, { payoutId: settlement.payoutId, principal: { ...FIN, cityIds: ['douala'] }, decision: 'APPROVED', cityId: 'douala' }),
  );
  await transact(uri, 'app_rw', (client) =>
    instructPayout(client, { payoutId: settlement.payoutId, principal: { ...FIN, cityIds: ['douala'] }, cityId: 'douala', signingKey: PLATFORM.privateKey, keyId: 'k1' }),
  );
  await transact(uri, 'app_rw', (client) =>
    recordPayoutExecution(client, { payoutId: settlement.payoutId, principal: { ...FIN2, cityIds: ['douala'] }, cityId: 'douala', outcome: 'EXECUTED', bankReference: 'ETAB-REG-1' }),
  );

}

/** Export complet signé : un lot Merkle couvrant toutes les écritures, tête signée, témoin identique. */
export function exportDocument(list: readonly ExportedEntry[], logKey: KeyObject, logId: string): object {
  const batch = buildBatch(list.map((entry) => ({ seq: entry.seq, entryHash: Buffer.from(entry.entry_hash, 'hex') })));
  const signed = signTreeHead(
    { treeSize: batch.treeSize, rootHash: batch.rootHash.toString('hex'), timestamp: '2026-11-11T12:00:00.000Z', logId },
    logKey,
  );
  return {
    version: 1,
    log_id: logId,
    generated_at: '2026-11-11T12:00:00.000Z',
    entries: list,
    tree_heads: [
      { tree_size: signed.head.treeSize, root_hash: signed.head.rootHash, timestamp: signed.head.timestamp, log_id: logId, signature: signed.signature },
    ],
    witness_heads: [{ tree_size: signed.head.treeSize, root_hash: signed.head.rootHash }],
  };
}

