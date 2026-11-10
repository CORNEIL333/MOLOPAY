import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeEntryHash, genesisPrevHash, verifyEntryHash, type EntryContent } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { xaf } from '@achat/money';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7, type EntryDraft } from '../../src/modules/ledger/domain';
import { appendLedgerEntry, ensureClientFundsAccount } from '../../src/modules/ledger/entry.store';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATION = resolve(process.cwd(), 'db/migrations/0001_ledger.sql');
const ACCOUNT_AGGREGATOR = '019a0000-0000-7000-8000-000000001200';
const ACCOUNT_SUSPENSE = '019a0000-0000-7000-8000-000000002900';
const CUSTOMER_ID = '019a9300-0000-7000-8000-0000000000c1';

let container: TestDatabase;
let admin: Client;
let migrationSql: string;

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

/** Genèse chaînée selon INT-HASH-001 (ts à la milliseconde, UTC). */
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
  const hash = computeEntryHash(genesisPrevHash(), content);
  await admin.query(
    `INSERT INTO ledger.journal_entry
       (seq, id, recorded_at, operation_type, business_refs, actor_id, approvers,
        idem_scope, idem_key, reverses_entry_id, prev_hash, entry_hash)
     VALUES (1, $1, $2, 'GENESIS', $3::jsonb, 'system', '[]'::jsonb, 'system', 'genesis', NULL, $4, $5)`,
    [id, ts, JSON.stringify(content.refs), genesisPrevHash(), hash],
  );
}

function draft(overrides: Partial<EntryDraft> = {}, amount = 5_000n): EntryDraft {
  return {
    id: uuidv7(),
    operationType: 'TEST_TRANSFER',
    businessRefs: { test_ref: 'ref-1' },
    actorId: 'payments-worker',
    approvers: [],
    idemScope: 'tests',
    idemKey: `key-${uuidv7()}`,
    postings: [
      { accountId: ACCOUNT_AGGREGATOR, direction: 'DEBIT', amount: xaf(amount) },
      { accountId: ACCOUNT_SUSPENSE, direction: 'CREDIT', amount: xaf(amount) },
    ],
    ...overrides,
  };
}

type EntryRow = {
  seq: string;
  id: string;
  ts: string;
  operation_type: string;
  business_refs: Record<string, string>;
  actor_id: string;
  approvers: string[];
  idem_scope: string;
  idem_key: string;
  reverses_entry_id: string | null;
  prev_hash: Buffer;
  entry_hash: Buffer;
};

/** INT-HASH-001/002 : recalcule toute la chaîne depuis la base, sans le store. */
async function verifyChainFromDatabase(): Promise<number> {
  const entries = await admin.query<EntryRow>(
    `SELECT seq::text, id, to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ts,
            operation_type, business_refs, actor_id, approvers, idem_scope, idem_key,
            reverses_entry_id, prev_hash, entry_hash
       FROM ledger.journal_entry e ORDER BY e.seq`,
  );
  let previous = genesisPrevHash();
  let expectedSeq = 1;
  for (const row of entries.rows) {
    expect(Number(row.seq)).toBe(expectedSeq);
    expect(row.prev_hash.equals(previous)).toBe(true);
    const postings = await admin.query<{ account_id: string; direction: 'D' | 'C'; amount_xaf: string; ordinal: number }>(
      'SELECT account_id, direction, amount_xaf::text, ordinal FROM ledger.posting WHERE entry_id = $1 ORDER BY ordinal',
      [row.id],
    );
    const content: EntryContent = {
      seq: Number(row.seq),
      id: row.id,
      ts: row.ts,
      type: row.operation_type,
      refs: row.business_refs,
      postings: postings.rows.map((p) => ({
        accountId: p.account_id,
        direction: p.direction,
        amountXaf: BigInt(p.amount_xaf),
        ordinal: p.ordinal,
      })),
      actor: row.actor_id,
      approvers: row.approvers,
      idemScope: row.idem_scope,
      idemKey: row.idem_key,
      reversesEntryId: row.reverses_entry_id,
    };
    expect(verifyEntryHash(previous, content, row.entry_hash), `écriture ${row.seq}`).toBe(true);
    previous = row.entry_hash;
    expectedSeq += 1;
  }
  return entries.rows.length;
}

beforeAll(async () => {
  container = await startTestDatabase();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  migrationSql = await readFile(MIGRATION, 'utf8');
}, 120_000);

afterAll(async () => {
  await admin.end();
  await container.stop();
});

beforeEach(async () => {
  await admin.query('DROP SCHEMA IF EXISTS ledger CASCADE');
  await admin.query(migrationSql);
  await seedGenesis();
});

describe('INT-LED-007 / INT-HASH-001/002 écriture chaînée par le store', () => {
  it('ajoute une écriture après la genèse, chaînée et vérifiable depuis la base', async () => {
    const written = await transact('app_rw', (client) => appendLedgerEntry(client, draft()));
    expect(written.seq).toBe(2);
    expect(written.replayed).toBe(false);
    expect(await verifyChainFromDatabase()).toBe(2);
  });

  it('horodate l’écriture avec l’horloge serveur, à la milliseconde UTC', async () => {
    const written = await transact('app_rw', (client) => appendLedgerEntry(client, draft()));
    expect(written.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Math.abs(Date.parse(written.recordedAt) - Date.now())).toBeLessThan(60_000);
  });

  it('INT-HASH-002 dix écritures concurrentes : séquence sans trou et chaîne intacte', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => transact('app_rw', (client) => appendLedgerEntry(client, draft()))),
    );
    expect(results.map((r) => r.seq).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(await verifyChainFromDatabase()).toBe(11);
  });

  it('I-1 refuse une écriture déséquilibrée (LEDGER_UNBALANCED)', async () => {
    const unbalanced = draft({
      postings: [
        { accountId: ACCOUNT_AGGREGATOR, direction: 'DEBIT', amount: xaf(5_000n) },
        { accountId: ACCOUNT_SUSPENSE, direction: 'CREDIT', amount: xaf(4_999n) },
      ],
    });
    const result = await failure(() => transact('app_rw', (client) => appendLedgerEntry(client, unbalanced)));
    expect(result.code).toBe('LEDGER_UNBALANCED');
  });

  it('refuse une genèse ou une contre-passation par ce chemin (LEDGER_INVALID_DRAFT)', async () => {
    const genesis = await failure(() =>
      transact('app_rw', (client) => appendLedgerEntry(client, draft({ operationType: 'GENESIS', postings: [] }))),
    );
    expect(genesis.code).toBe('LEDGER_INVALID_DRAFT');
    const reversal = await failure(() =>
      transact('app_rw', (client) =>
        appendLedgerEntry(client, draft({ reversesEntryId: uuidv7(), approvers: ['checker-1'] })),
      ),
    );
    expect(reversal.code).toBe('LEDGER_INVALID_DRAFT');
  });

  it('refuse d’écrire sans genèse (LEDGER_INVALID_DRAFT)', async () => {
    await admin.query('DROP SCHEMA IF EXISTS ledger CASCADE');
    await admin.query(migrationSql);
    const result = await failure(() => transact('app_rw', (client) => appendLedgerEntry(client, draft())));
    expect(result.code).toBe('LEDGER_INVALID_DRAFT');
  });

  it('le rôle lecture seule ne peut pas écrire (42501)', async () => {
    const result = await failure(() => transact('app_ro', (client) => appendLedgerEntry(client, draft())));
    expect(result.code).toBe('42501');
  });
});

describe('I-5 / INT-IDEM-001 idempotence des écritures', () => {
  it('un rejeu de la même clé renvoie l’écriture originale sans en créer une autre', async () => {
    const first = draft();
    const written = await transact('app_rw', (client) => appendLedgerEntry(client, first));
    const again = await transact('app_rw', (client) => appendLedgerEntry(client, { ...first, id: uuidv7() }));
    expect(again).toMatchObject({ id: written.id, seq: written.seq, replayed: true });
    const count = await admin.query('SELECT count(*)::int AS n FROM ledger.journal_entry');
    expect(count.rows[0]).toEqual({ n: 2 });
  });

  it('refuse la même clé avec un autre contenu (IDEMPOTENCY_KEY_REUSED)', async () => {
    const first = draft();
    await transact('app_rw', (client) => appendLedgerEntry(client, first));
    const changed = draft({ idemScope: first.idemScope, idemKey: first.idemKey }, 6_000n);
    const result = await failure(() => transact('app_rw', (client) => appendLedgerEntry(client, changed)));
    expect(result.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('INT-LED-006 compte de fonds client (2100)', () => {
  it('crée le compte 2100 du client une seule fois', async () => {
    const first = await transact('app_rw', (client) => ensureClientFundsAccount(client, CUSTOMER_ID));
    const again = await transact('app_rw', (client) => ensureClientFundsAccount(client, CUSTOMER_ID));
    expect(again).toBe(first);
    const row = await admin.query(
      `SELECT code, nature, owner_type FROM ledger.account WHERE id = $1`,
      [first],
    );
    expect(row.rows[0]).toEqual({ code: '2100', nature: 'LIABILITY', owner_type: 'CLIENT' });
  });

  it('refuse un identifiant client qui n’est pas un UUID (LEDGER_INVALID_DRAFT)', async () => {
    const result = await failure(() => transact('app_rw', (client) => ensureClientFundsAccount(client, 'client-1')));
    expect(result.code).toBe('LEDGER_INVALID_DRAFT');
  });
});
