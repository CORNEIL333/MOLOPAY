import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOffer, publishOffer, type StockAvailability } from '../../src/modules/catalog/domain';
import { appendOfferVersion } from '../../src/modules/catalog/offer.store';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendAttemptTransition, createStoredPaymentAttempt } from '../../src/modules/payments/attempt.store';
import { issueHandoverCode } from '../../src/modules/settlement/handover.store';
import { confirmHandoverAtPartner } from '../../src/workflows/handover';
import { confirmPaymentAndFundAgreement } from '../../src/workflows/payment-confirmation';
import {
  AGREEMENT_STACK_MIGRATIONS,
  AGREEMENT_STACK_SCHEMAS,
  createAgreementA,
  PLAN_A,
  publishKycLimits,
  publishOfferA,
  publishSetting,
  seedCustomerAccount,
  seedLedgerGenesis,
  seedPaymentPlan,
  validateMerchant,
} from './agreement-fixture';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  ...AGREEMENT_STACK_MIGRATIONS,
  'db/migrations/0038_partner_ledger_identity.sql',
  'db/migrations/0039_agreements_handover.sql',
  'db/migrations/0040_settlement_handover.sql',
  'db/migrations/0053_agreements_stock_reservation.sql',
].map((path) => resolve(process.cwd(), path));

const CUSTOMER_ID = '019aa100-0000-7000-8000-0000000000c1';
const OFFER_ID = '019aa100-0000-7000-8000-0000000000f1';
const PRICE = 150_000n;
const PEPPER = randomBytes(32);
const GOALS = [1, 2, 3, 4, 5].map((n) => `019aa100-0000-7000-8000-0000000000a${n}`);

let container: TestDatabase;
let admin: Client;
let migrationSql: string[];

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

async function failure(action: () => Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  try {
    await action();
  } catch (error: unknown) {
    if (error instanceof BusinessError) {
      return { code: error.code, message: error.message };
    }
    const pg = error as { code?: string; message?: string };
    return { code: pg.code, message: pg.message ?? '' };
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

async function activate(id: string): Promise<void> {
  await transact('app_rw', (client) => createAgreementA(client, { id, customerId: CUSTOMER_ID, offerId: OFFER_ID }));
}

async function available(): Promise<number | null> {
  const result = await admin.query<{ n: number | null }>('SELECT agreements.available_stock($1) AS n', [OFFER_ID]);
  return result.rows[0]?.n ?? null;
}

async function republish(availability: StockAvailability): Promise<void> {
  await transact('app_rw', (client) =>
    appendOfferVersion(
      client,
      publishOffer(
        createOffer({
          id: OFFER_ID,
          partner: { id: 'merchant-1', status: 'VALIDATED' },
          universe: 'TECHNOLOGY',
          models: ['SAVE_THEN_BUY'],
          cityIds: ['douala'],
          priceXaf: PRICE,
          availability,
          warranty: 'Garantie 12 mois',
          discountTerms: 'Aucune remise',
        }),
      ),
      'net-1',
    ),
  );
}

async function transition(agreementId: string, from: string, to: string): Promise<void> {
  await admin.query(
    `INSERT INTO agreements.status_event (agreement_id, seq, kind, from_status, to_status, device_id, signature, actor_id, created_at)
     SELECT $1, max(seq) + 1, 'TRANSITION', $2, $3, $4, $5, 'client-1', now() FROM agreements.status_event WHERE agreement_id = $1`,
    // Seules les transitions du client portent une signature d'appareil.
    to === 'CANCELLED_BY_CUSTOMER' ? [agreementId, from, to, uuidv7(), Buffer.alloc(64, 9)] : [agreementId, from, to, null, null],
  );
}

async function fundAndHandOver(agreementId: string): Promise<void> {
  const attemptId = uuidv7();
  await transact('app_rw', async (client) => {
    await createStoredPaymentAttempt(client, { id: attemptId, agreementId, channel: 'MTN_MOMO', amountXaf: PRICE, idemKey: uuidv7() });
    await appendAttemptTransition(client, { attemptId, from: 'CREATED', to: 'PENDING', seq: 1, actorId: 'payments-worker' });
  });
  await transact('app_rw', (client) =>
    confirmPaymentAndFundAgreement(client, {
      attemptId,
      customerId: CUSTOMER_ID,
      providerTransaction: { providerTxId: `tx-${attemptId.slice(-12)}`, attemptId, amountXaf: PRICE, outcome: 'SUCCEEDED' },
      actorId: 'payments-worker',
    }),
  );
  const { code } = await transact('app_rw', (client) => issueHandoverCode(client, { agreementId, pepper: PEPPER, actorId: 'system-handover' }));
  await transact('app_rw', (client) =>
    confirmHandoverAtPartner(client, { code, partnerId: 'merchant-1', partnerUserId: 'vendeur-1', latitude: '4.051056', longitude: '9.767869', pepper: PEPPER }),
  );
}

beforeAll(async () => {
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  migrationSql = await Promise.all(MIGRATIONS.map((path) => readFile(path, 'utf8')));
}, 120_000);

afterAll(async () => {
  await admin.end();
  await container.stop();
});

beforeEach(async () => {
  for (const schema of ['settlement', ...AGREEMENT_STACK_SCHEMAS]) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
  await transact('app_rw', async (client) => {
    await validateMerchant(client, uuidv7());
    await seedPaymentPlan(client, PLAN_A);
    // Offre en stock : 3 unités déclarées.
    await publishOfferA(client, { offerId: OFFER_ID, partnerId: 'merchant-1', priceXaf: PRICE });
  });
  await seedLedgerGenesis(admin);
  await seedCustomerAccount(admin, CUSTOMER_ID, 'STRONG');
  await publishKycLimits(admin);
  await publishSetting(admin, 'handover_code_validity_days', 30);
});

describe('F-CAT-005 / D57 réservation du stock à l’activation', () => {
  it('3 unités : 3 accords activés, le 4e refusé (CATALOG_STOCK_UNAVAILABLE) ; un article n’est pas vendu deux fois', async () => {
    expect(await available()).toBe(3);
    for (const id of GOALS.slice(0, 3)) {
      await activate(id);
    }
    expect(await available()).toBe(0);
    const result = await failure(() => activate(GOALS[3]!));
    expect(result.message).toMatch(/^CATALOG_STOCK_UNAVAILABLE/);
    const drafts = await admin.query('SELECT 1 FROM agreements.agreement WHERE id = $1', [GOALS[3]]);
    expect(drafts.rowCount).toBe(0);
  });

  it('F-SAV-005 l’annulation libère l’unité réservée', async () => {
    for (const id of GOALS.slice(0, 3)) {
      await activate(id);
    }
    await transition(GOALS[0]!, 'ACTIVE', 'CANCELLED_BY_CUSTOMER');
    expect(await available()).toBe(1);
    await activate(GOALS[3]!);
    expect(await available()).toBe(0);
  });

  it('un accord gelé ou en litige garde sa réservation', async () => {
    for (const id of GOALS.slice(0, 3)) {
      await activate(id);
    }
    await transition(GOALS[0]!, 'ACTIVE', 'FROZEN');
    await transition(GOALS[1]!, 'ACTIVE', 'DISPUTED');
    expect(await available()).toBe(0);
    expect((await failure(() => activate(GOALS[3]!))).message).toMatch(/^CATALOG_STOCK_UNAVAILABLE/);
  });

  it('nouvelle version publiée : le stock déclaré remplace l’ancien, les réservations restent comptées', async () => {
    await activate(GOALS[0]!);
    await activate(GOALS[1]!);
    await republish({ kind: 'IN_STOCK', units: 2 });
    expect(await available()).toBe(0);
    expect((await failure(() => activate(GOALS[2]!))).message).toMatch(/^CATALOG_STOCK_UNAVAILABLE/);
    await republish({ kind: 'IN_STOCK', units: 5 });
    await activate(GOALS[2]!);
    expect(await available()).toBe(2);
  });

  it('une remise postérieure à la version déclarée retire l’unité ; antérieure, elle n’est plus comptée', async () => {
    await activate(GOALS[0]!);
    await fundAndHandOver(GOALS[0]!);
    expect(await available()).toBe(2);
    await republish({ kind: 'IN_STOCK', units: 2 });
    expect(await available()).toBe(2);
  });

  it('à l’activation, une remise postérieure à la version compte comme sortie de stock', async () => {
    await activate(GOALS[0]!);
    await fundAndHandOver(GOALS[0]!);
    await activate(GOALS[1]!);
    await activate(GOALS[2]!);
    expect((await failure(() => activate(GOALS[3]!))).message).toMatch(/^CATALOG_STOCK_UNAVAILABLE/);
  });

  it('deux activations concurrentes ne prennent pas la dernière unité (verrou par offre)', async () => {
    await activate(GOALS[0]!);
    await activate(GOALS[1]!);
    const first = new Client({ connectionString: container.getConnectionUri() });
    const second = new Client({ connectionString: container.getConnectionUri() });
    await first.connect();
    await second.connect();
    try {
      await first.query('BEGIN');
      await first.query('SET LOCAL ROLE app_rw');
      await createAgreementA(first, { id: GOALS[2]!, customerId: CUSTOMER_ID, offerId: OFFER_ID });
      await second.query('BEGIN');
      await second.query('SET LOCAL ROLE app_rw');
      const racing = createAgreementA(second, { id: GOALS[3]!, customerId: CUSTOMER_ID, offerId: OFFER_ID }).then(
        () => 'ACTIVATED',
        (error: unknown) => (error as Error).message,
      );
      await new Promise((resolveWait) => setTimeout(resolveWait, 300));
      await first.query('COMMIT');
      const outcome = await racing;
      await second.query('ROLLBACK');
      expect(outcome).toMatch(/^CATALOG_STOCK_UNAVAILABLE/);
    } finally {
      await first.end();
      await second.end();
    }
  });

  it('précommande : aucune limite de stock', async () => {
    await republish({ kind: 'PREORDER', leadDays: 30 });
    for (const id of GOALS) {
      await activate(id);
    }
    expect(await available()).toBeNull();
  });
});
