import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeEntryHash, genesisPrevHash, type EntryContent } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { xaf } from '@achat/money';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendLedgerEntry, ensureClientFundsAccount } from '../../src/modules/ledger/entry.store';
import {
  listIncidentsToEscalate,
  recordSegregationCheck,
  type SegregationCheckResult,
} from '../../src/modules/reconciliation/segregation.store';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = ['db/migrations/0001_ledger.sql', 'db/migrations/0030_reconciliation_segregation.sql'].map(
  (path) => resolve(process.cwd(), path),
);
const ACCOUNT_AGGREGATOR = '019a0000-0000-7000-8000-000000001200';
const ACCOUNT_MERCHANT_FEES = '019a0000-0000-7000-8000-000000007100';
const CUSTOMER_ID = '019a9400-0000-7000-8000-0000000000c1';

let container: TestDatabase;
let admin: Client;
let migrationSql: string[];

async function transact<T>(
  role: 'app_rw' | 'app_ro' | null,
  action: (client: Client) => Promise<T>,
): Promise<T> {
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

async function seedGenesis(): Promise<void> {
  const id = uuidv7();
  const ts = '2026-11-01T00:00:00.000Z';
  const content: EntryContent = {
    seq: 1,
    id,
    ts,
    type: 'GENESIS',
    refs: { params_hash: 'parametres-v1-de-test' },
    postings: [],
    actor: 'system',
    approvers: [],
    idemScope: 'system',
    idemKey: 'genesis',
    reversesEntryId: null,
  };
  await admin.query(
    `INSERT INTO ledger.journal_entry
       (seq, id, recorded_at, operation_type, business_refs, actor_id, approvers,
        idem_scope, idem_key, reverses_entry_id, prev_hash, entry_hash)
     VALUES (1, $1, $2, 'GENESIS', $3::jsonb, 'system', '[]'::jsonb, 'system', 'genesis', NULL, $4, $5)`,
    [id, ts, JSON.stringify(content.refs), genesisPrevHash(), computeEntryHash(genesisPrevHash(), content)],
  );
}

/** Écriture équilibrée entre deux comptes, par le store du grand livre. */
async function post(debit: string, credit: string, amount: bigint, type = 'PAYMENT_CONFIRMED'): Promise<void> {
  await transact('app_rw', (client) =>
    appendLedgerEntry(client, {
      id: uuidv7(),
      operationType: type,
      businessRefs: { test_ref: 'reconciliation' },
      actorId: 'payments-worker',
      approvers: [],
      idemScope: 'tests',
      idemKey: uuidv7(),
      postings: [
        { accountId: debit, direction: 'DEBIT', amount: xaf(amount) },
        { accountId: credit, direction: 'CREDIT', amount: xaf(amount) },
      ],
    }),
  );
}

async function clientAccount(): Promise<string> {
  return transact('app_rw', (client) => ensureClientFundsAccount(client, CUSTOMER_ID));
}

async function check(statementBalanceXaf: bigint, outgoingInTransitXaf = 0n): Promise<SegregationCheckResult> {
  return transact('app_rw', (client) =>
    recordSegregationCheck(client, {
      statementDate: '2026-11-09',
      statementBalanceXaf,
      outgoingInTransitXaf,
      actorId: 'finance-1',
    }),
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
  await admin.query('DROP SCHEMA IF EXISTS reconciliation CASCADE');
  await admin.query('DROP SCHEMA IF EXISTS ledger CASCADE');
  for (const sql of migrationSql) {
    await admin.query(sql);
  }
  await seedGenesis();
});

describe('INT-REC-002 / I-9 contrôle de cantonnement dérivé du grand livre', () => {
  it('versement en transit, relevé vide : invariant tenu, aucun incident', async () => {
    await post(ACCOUNT_AGGREGATOR, await clientAccount(), 5_000n);
    const result = await check(0n);
    expect(result).toMatchObject({
      thirdPartyFundsXaf: 5_000n,
      incomingInTransitXaf: 5_000n,
      gapXaf: 0n,
      incidentId: null,
    });
  });

  it('écart non expliqué > 0 FCFA : un incident est ouvert dans la même transaction', async () => {
    await post(ACCOUNT_AGGREGATOR, await clientAccount(), 5_000n);
    const result = await check(1n);
    expect(result.gapXaf).toBe(1n);
    expect(result.incidentId).not.toBeNull();
    const incidents = await admin.query('SELECT gap_xaf::text AS gap, classification FROM reconciliation.incident');
    expect(incidents.rows).toEqual([{ gap: '1', classification: null }]);
  });

  it('I-8 des fonds clients basculés en produit font apparaître un écart', async () => {
    const account = await clientAccount();
    await post(ACCOUNT_AGGREGATOR, account, 5_000n);
    await post(account, ACCOUNT_MERCHANT_FEES, 1_000n, 'TEST_MISPOSTING');
    const result = await check(0n);
    expect(result.thirdPartyFundsXaf).toBe(4_000n);
    expect(result.gapXaf).toBe(1_000n);
    expect(result.incidentId).not.toBeNull();
  });

  it('tient compte des règlements sortants en transit', async () => {
    await post(ACCOUNT_AGGREGATOR, await clientAccount(), 5_000n);
    expect((await check(2_000n, 2_000n)).gapXaf).toBe(0n);
  });

  it('les totaux sont calculés par la base, pas fournis par l’appelant', async () => {
    await post(ACCOUNT_AGGREGATOR, await clientAccount(), 5_000n);
    await transact('app_rw', (client) =>
      client.query(
        `INSERT INTO reconciliation.segregation_check
           (id, statement_date, statement_balance_xaf, outgoing_in_transit_xaf,
            third_party_funds_xaf, incoming_in_transit_xaf, gap_xaf, actor_id, checked_at)
         VALUES ($1, '2026-11-09', 0, 0, 999999, 999999, 0, 'finance-1', '2000-01-01')`,
        [uuidv7()],
      ),
    );
    const row = await admin.query(
      `SELECT third_party_funds_xaf::text AS funds, incoming_in_transit_xaf::text AS transit, gap_xaf::text AS gap,
              checked_at > now() - interval '1 hour' AS recent
         FROM reconciliation.segregation_check`,
    );
    expect(row.rows[0]).toEqual({ funds: '5000', transit: '5000', gap: '0', recent: true });
  });

  it('NF-FUN-001 la base refuse un relevé négatif (23514)', async () => {
    const result = await failure(() =>
      transact('app_rw', (client) =>
        client.query(
          `INSERT INTO reconciliation.segregation_check
             (id, statement_date, statement_balance_xaf, outgoing_in_transit_xaf,
              third_party_funds_xaf, incoming_in_transit_xaf, gap_xaf, actor_id, checked_at)
           VALUES ($1, '2026-11-09', -1, 0, 0, 0, 0, 'finance-1', now())`,
          [uuidv7()],
        ),
      ),
    );
    expect(result.code).toBe('23514');
  });

  it('le store refuse un relevé négatif avant la base (INVALID_AMOUNT)', async () => {
    const result = await failure(() => check(-1n));
    expect(result.code).toBe('INVALID_AMOUNT');
  });

  it('contrôles et incidents sont en ajout seul (RECONCILIATION_APPEND_ONLY)', async () => {
    await post(ACCOUNT_AGGREGATOR, await clientAccount(), 5_000n);
    await check(1n);
    for (const sql of [
      'UPDATE reconciliation.segregation_check SET gap_xaf = 0',
      'DELETE FROM reconciliation.segregation_check',
      'UPDATE reconciliation.incident SET gap_xaf = 0',
      'DELETE FROM reconciliation.incident',
    ]) {
      const result = await failure(() => admin.query(sql));
      expect(result.message, sql).toMatch(/^RECONCILIATION_APPEND_ONLY/);
    }
  });

  it('le rôle lecture seule ne peut pas enregistrer de contrôle (42501)', async () => {
    const result = await failure(() =>
      transact('app_ro', (client) =>
        recordSegregationCheck(client, {
          statementDate: '2026-11-09',
          statementBalanceXaf: 0n,
          outgoingInTransitXaf: 0n,
          actorId: 'finance-1',
        }),
      ),
    );
    expect(result.code).toBe('42501');
  });
});

describe('INT-REC-004 incidents à escalader', () => {
  it('un incident n’est escaladé qu’après 48 h', async () => {
    await post(ACCOUNT_AGGREGATOR, await clientAccount(), 5_000n);
    await check(1n);
    const now = await transact('app_ro', (client) => listIncidentsToEscalate(client, new Date().toISOString()));
    expect(now).toHaveLength(0);
    const later = await transact('app_ro', (client) =>
      listIncidentsToEscalate(client, new Date(Date.now() + 48 * 3_600_000 + 60_000).toISOString()),
    );
    expect(later).toHaveLength(1);
    expect(later[0]?.gapXaf).toBe(1n);
  });
});
