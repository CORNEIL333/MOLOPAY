import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/modules/ledger/domain';

const POSTGRES_IMAGE =
  'postgres:16.15-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab';
const MIGRATION_PATH = resolve(
  process.cwd(),
  'db/migrations/0001_ledger.sql',
);

const ZERO_HASH = Buffer.alloc(32);
const ACCOUNT_TREASURY = '019a0000-0000-7000-8000-000000001100';
const ACCOUNT_SUSPENSE = '019a0000-0000-7000-8000-000000002900';
const ACCOUNT_MERCHANT_FEES = '019a0000-0000-7000-8000-000000007100';

type SqlDirection = 'D' | 'C';

type SeedPosting = {
  readonly accountId: string;
  readonly direction: SqlDirection;
  readonly amountXaf: bigint;
};

type EntryOptions = {
  readonly operationType?: string;
  readonly businessRefs?: Readonly<Record<string, string>>;
  readonly actorId?: string;
  readonly approvers?: readonly string[];
  readonly idemScope?: string;
  readonly idemKey?: string;
  readonly reversesEntryId?: string | null;
  readonly postings?: readonly SeedPosting[];
};

type EntrySeed = {
  readonly seq: number;
  readonly id: string;
  readonly prevHash: Buffer;
  readonly hash: Buffer;
  readonly operationType: string;
  readonly businessRefs: Readonly<Record<string, string>>;
  readonly actorId: string;
  readonly approvers: readonly string[];
  readonly idemScope: string;
  readonly idemKey: string;
  readonly reversesEntryId: string | null;
  readonly postings: readonly SeedPosting[];
};

type ChainPosition = {
  readonly seq: number;
  readonly id: string;
  readonly hash: Buffer;
};

type PgFailure = {
  readonly code?: string;
  readonly constraint?: string;
  readonly message?: RegExp;
};

const BALANCED: readonly SeedPosting[] = [
  { accountId: ACCOUNT_TREASURY, direction: 'D', amountXaf: 10_000n },
  { accountId: ACCOUNT_SUSPENSE, direction: 'C', amountXaf: 10_000n },
];

function mirror(postings: readonly SeedPosting[]): readonly SeedPosting[] {
  return postings.map((posting) => ({
    accountId: posting.accountId,
    direction: posting.direction === 'D' ? 'C' : 'D',
    amountXaf: posting.amountXaf,
  }));
}

function computeHash(prevHash: Buffer, id: string): Buffer {
  return createHash('sha256').update(prevHash).update(id, 'utf8').digest();
}

let container: StartedPostgreSqlContainer;
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

async function insertEntry(client: Client, seed: EntrySeed): Promise<void> {
  await client.query(
    `INSERT INTO ledger.journal_entry
       (seq, id, recorded_at, operation_type, business_refs, actor_id,
        approvers, idem_scope, idem_key, reverses_entry_id, prev_hash, entry_hash)
     VALUES ($1, $2, now(), $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
    [
      seed.seq,
      seed.id,
      seed.operationType,
      JSON.stringify(seed.businessRefs),
      seed.actorId,
      JSON.stringify(seed.approvers),
      seed.idemScope,
      seed.idemKey,
      seed.reversesEntryId,
      seed.prevHash,
      seed.hash,
    ],
  );
  let ordinal = 1;
  for (const posting of seed.postings) {
    await client.query(
      `INSERT INTO ledger.posting
         (id, entry_id, account_id, direction, amount_xaf, ordinal)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        uuidv7(),
        seed.id,
        posting.accountId,
        posting.direction,
        posting.amountXaf.toString(),
        ordinal,
      ],
    );
    ordinal += 1;
  }
}

async function insertGenesis(client: Client): Promise<ChainPosition> {
  const id = uuidv7();
  const hash = computeHash(ZERO_HASH, id);
  await insertEntry(client, {
    seq: 1,
    id,
    prevHash: ZERO_HASH,
    hash,
    operationType: 'GENESIS',
    businessRefs: { params_hash: 'parametres-v1-de-test' },
    actorId: 'system',
    approvers: [],
    idemScope: 'system',
    idemKey: 'genesis',
    reversesEntryId: null,
    postings: [],
  });
  return { seq: 1, id, hash };
}

async function appendEntry(
  client: Client,
  previous: ChainPosition,
  options: EntryOptions = {},
): Promise<ChainPosition> {
  const seq = previous.seq + 1;
  const id = uuidv7();
  const hash = computeHash(previous.hash, id);
  await insertEntry(client, {
    seq,
    id,
    prevHash: previous.hash,
    hash,
    operationType: options.operationType ?? 'PAYMENT_CONFIRMED',
    businessRefs: options.businessRefs ?? { payment_id: `pay-${seq}` },
    actorId: options.actorId ?? 'user_maker',
    approvers: options.approvers ?? ['user_checker'],
    idemScope: options.idemScope ?? 'tests',
    idemKey: options.idemKey ?? `key-${seq}-${id}`,
    reversesEntryId: options.reversesEntryId ?? null,
    postings: options.postings ?? BALANCED,
  });
  return { seq, id, hash };
}

async function seedGenesis(): Promise<ChainPosition> {
  return transact(null, insertGenesis);
}

async function expectPgFailure(
  action: Promise<unknown>,
  expected: PgFailure,
): Promise<void> {
  try {
    await action;
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    const pgError = error as Error & { code?: string; constraint?: string };
    if (expected.code !== undefined) {
      expect(pgError.code).toBe(expected.code);
    }
    if (expected.constraint !== undefined) {
      expect(pgError.constraint).toBe(expected.constraint);
    }
    if (expected.message !== undefined) {
      expect(pgError.message).toMatch(expected.message);
    }
    return;
  }
  expect.unreachable('une erreur PostgreSQL était attendue');
}

beforeAll(async () => {
  migrationSql = await readFile(MIGRATION_PATH, 'utf8');
  container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase('achat_test')
    .start();
  admin = new Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
});

beforeEach(async () => {
  await admin.query('DROP SCHEMA IF EXISTS ledger CASCADE');
  await admin.query(migrationSql);
});

afterAll(async () => {
  if (admin !== undefined) {
    await admin.end();
  }
  if (container !== undefined) {
    await container.stop();
  }
});

describe('INT-LED-001/002 — partie double imposée par la base', () => {
  it('INT-LED-001 accepte une écriture équilibrée en XAF entiers', async () => {
    const genesis = await seedGenesis();
    await transact(null, (client) => appendEntry(client, genesis));

    const rows = await admin.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM ledger.posting',
    );
    expect(rows.rows[0]?.count).toBe('2');
  });

  it('INT-LED-002 refuse une écriture déséquilibrée à la validation (contrainte différée)', async () => {
    const genesis = await seedGenesis();
    await expectPgFailure(
      transact(null, (client) =>
        appendEntry(client, genesis, {
          postings: [
            {
              accountId: ACCOUNT_TREASURY,
              direction: 'D',
              amountXaf: 10_000n,
            },
            {
              accountId: ACCOUNT_SUSPENSE,
              direction: 'C',
              amountXaf: 9_999n,
            },
          ],
        }),
      ),
      { code: 'P0001', message: /LEDGER_UNBALANCED/ },
    );

    const rows = await admin.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM ledger.journal_entry',
    );
    expect(rows.rows[0]?.count).toBe('1');
  });

  it('INT-LED-001 refuse une écriture à une seule ligne', async () => {
    const genesis = await seedGenesis();
    await expectPgFailure(
      transact(null, (client) =>
        appendEntry(client, genesis, {
          postings: [
            {
              accountId: ACCOUNT_TREASURY,
              direction: 'D',
              amountXaf: 10_000n,
            },
          ],
        }),
      ),
      { code: 'P0001', message: /LEDGER_ENTRY_TOO_FEW_POSTINGS/ },
    );
  });

  it('INT-LED-001 refuse une écriture non GENESIS sans ligne', async () => {
    const genesis = await seedGenesis();
    await expectPgFailure(
      transact(null, (client) =>
        appendEntry(client, genesis, { postings: [] }),
      ),
      { code: 'P0001', message: /LEDGER_ENTRY_TOO_FEW_POSTINGS/ },
    );
  });

  it('INT-LED-001 refuse un montant nul au niveau de la base', async () => {
    const genesis = await seedGenesis();
    await expectPgFailure(
      transact(null, (client) =>
        appendEntry(client, genesis, {
          postings: [
            {
              accountId: ACCOUNT_TREASURY,
              direction: 'D',
              amountXaf: 0n,
            },
            {
              accountId: ACCOUNT_SUSPENSE,
              direction: 'C',
              amountXaf: 0n,
            },
          ],
        }),
      ),
      { code: '23514', constraint: 'posting_amount_xaf_check' },
    );
  });
});

describe('INT-LED-003 — ajout seul', () => {
  it('INT-LED-003 refuse UPDATE à app_rw', async () => {
    await seedGenesis();
    await expectPgFailure(
      transact('app_rw', (client) =>
        client.query('UPDATE ledger.journal_entry SET actor_id = actor_id'),
      ),
      { code: '42501', message: /permission denied/ },
    );
  });

  it('INT-LED-003 refuse DELETE à app_rw', async () => {
    await seedGenesis();
    await expectPgFailure(
      transact('app_rw', (client) =>
        client.query('DELETE FROM ledger.journal_entry'),
      ),
      { code: '42501', message: /permission denied/ },
    );
  });

  it('INT-LED-003 refuse TRUNCATE à app_rw', async () => {
    await seedGenesis();
    await expectPgFailure(
      transact('app_rw', (client) =>
        client.query('TRUNCATE ledger.journal_entry'),
      ),
      { code: '42501', message: /permission denied/ },
    );
  });

  it('INT-LED-003 refuse UPDATE même au propriétaire (déclencheur)', async () => {
    await seedGenesis();
    await expectPgFailure(
      transact(null, (client) =>
        client.query('UPDATE ledger.journal_entry SET actor_id = actor_id'),
      ),
      { code: 'P0001', message: /LEDGER_APPEND_ONLY/ },
    );
  });

  it('INT-LED-003 refuse DELETE même au propriétaire (déclencheur)', async () => {
    await seedGenesis();
    await expectPgFailure(
      transact(null, (client) =>
        client.query('DELETE FROM ledger.journal_entry'),
      ),
      { code: 'P0001', message: /LEDGER_APPEND_ONLY/ },
    );
  });

  it('INT-LED-003 app_ro lit mais ne peut pas insérer', async () => {
    await seedGenesis();
    const count = await transact('app_ro', async (client) => {
      const result = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM ledger.journal_entry',
      );
      return result.rows[0]?.count;
    });
    expect(count).toBe('1');

    await expectPgFailure(
      transact('app_ro', (client) =>
        client.query(
          `INSERT INTO ledger.account (id, code, nature, name)
           VALUES ($1, '1200', 'ASSET', 'Test')`,
          [uuidv7()],
        ),
      ),
      { code: '42501', message: /permission denied/ },
    );
  });
});

describe('INT-HASH-002/003 — genèse, séquence et chaîne', () => {
  it('INT-HASH-003 la genèse exige un prev_hash nul et les paramètres', async () => {
    const rows = await transact(null, async (client) => {
      await insertGenesis(client);
      const result = await client.query<{ prev_hash: string; refs: string }>(
        `SELECT encode(prev_hash, 'hex') AS prev_hash,
                business_refs->>'params_hash' AS refs
         FROM ledger.journal_entry WHERE seq = 1`,
      );
      return result.rows[0];
    });
    expect(rows?.prev_hash).toBe('0'.repeat(64));
    expect(rows?.refs).toBe('parametres-v1-de-test');
  });

  it('INT-HASH-003 refuse une genèse sans params_hash', async () => {
    const id = uuidv7();
    await expectPgFailure(
      transact(null, (client) =>
        insertEntry(client, {
          seq: 1,
          id,
          prevHash: ZERO_HASH,
          hash: computeHash(ZERO_HASH, id),
          operationType: 'GENESIS',
          businessRefs: {},
          actorId: 'system',
          approvers: [],
          idemScope: 'system',
          idemKey: 'genesis',
          reversesEntryId: null,
          postings: [],
        }),
      ),
      { code: 'P0001', message: /LEDGER_GENESIS_PARAMS/ },
    );
  });

  it('INT-HASH-003 refuse une genèse avec un prev_hash non nul', async () => {
    const id = uuidv7();
    const prevHash = Buffer.alloc(32, 1);
    await expectPgFailure(
      transact(null, (client) =>
        insertEntry(client, {
          seq: 1,
          id,
          prevHash,
          hash: computeHash(prevHash, id),
          operationType: 'GENESIS',
          businessRefs: { params_hash: 'v1' },
          actorId: 'system',
          approvers: [],
          idemScope: 'system',
          idemKey: 'genesis',
          reversesEntryId: null,
          postings: [],
        }),
      ),
      { code: 'P0001', message: /LEDGER_GENESIS_PREV_HASH/ },
    );
  });

  it('INT-HASH-003 refuse une première écriture non GENESIS', async () => {
    const id = uuidv7();
    await expectPgFailure(
      transact(null, (client) =>
        insertEntry(client, {
          seq: 1,
          id,
          prevHash: ZERO_HASH,
          hash: computeHash(ZERO_HASH, id),
          operationType: 'PAYMENT_CONFIRMED',
          businessRefs: { payment_id: 'pay-1' },
          actorId: 'user_maker',
          approvers: ['user_checker'],
          idemScope: 'tests',
          idemKey: 'k1',
          reversesEntryId: null,
          postings: BALANCED,
        }),
      ),
      { code: 'P0001', message: /LEDGER_GENESIS_REQUIRED/ },
    );
  });

  it('INT-HASH-002 refuse une première séquence différente de 1', async () => {
    const id = uuidv7();
    await expectPgFailure(
      transact(null, (client) =>
        insertEntry(client, {
          seq: 42,
          id,
          prevHash: ZERO_HASH,
          hash: computeHash(ZERO_HASH, id),
          operationType: 'GENESIS',
          businessRefs: { params_hash: 'v1' },
          actorId: 'system',
          approvers: [],
          idemScope: 'system',
          idemKey: 'genesis',
          reversesEntryId: null,
          postings: [],
        }),
      ),
      { code: 'P0001', message: /LEDGER_SEQUENCE_GAP/ },
    );
  });

  it('INT-HASH-003 refuse une seconde genèse', async () => {
    const genesis = await seedGenesis();
    await expectPgFailure(
      transact(null, (client) =>
        appendEntry(client, genesis, {
          operationType: 'GENESIS',
          businessRefs: { params_hash: 'v2' },
          postings: [],
        }),
      ),
      { code: '23505', constraint: 'journal_entry_single_genesis_idx' },
    );
  });

  it('INT-HASH-002 refuse une séquence trouée', async () => {
    const genesis = await seedGenesis();
    const id = uuidv7();
    await expectPgFailure(
      transact(null, (client) =>
        insertEntry(client, {
          seq: genesis.seq + 2,
          id,
          prevHash: genesis.hash,
          hash: computeHash(genesis.hash, id),
          operationType: 'PAYMENT_CONFIRMED',
          businessRefs: { payment_id: 'pay-3' },
          actorId: 'user_maker',
          approvers: ['user_checker'],
          idemScope: 'tests',
          idemKey: 'k3',
          reversesEntryId: null,
          postings: BALANCED,
        }),
      ),
      { code: 'P0001', message: /LEDGER_SEQUENCE_GAP/ },
    );
  });

  it('INT-HASH-002 refuse un prev_hash qui ne correspond pas', async () => {
    const genesis = await seedGenesis();
    const id = uuidv7();
    const wrongPrev = Buffer.alloc(32, 7);
    await expectPgFailure(
      transact(null, (client) =>
        insertEntry(client, {
          seq: genesis.seq + 1,
          id,
          prevHash: wrongPrev,
          hash: computeHash(wrongPrev, id),
          operationType: 'PAYMENT_CONFIRMED',
          businessRefs: { payment_id: 'pay-2' },
          actorId: 'user_maker',
          approvers: ['user_checker'],
          idemScope: 'tests',
          idemKey: 'k2',
          reversesEntryId: null,
          postings: BALANCED,
        }),
      ),
      { code: 'P0001', message: /LEDGER_CHAIN_BROKEN/ },
    );
  });

  it('INT-HASH-002 attribue des séquences sans trou sous concurrence', async () => {
    await seedGenesis();
    const inserts = Array.from({ length: 8 }, (_, index) =>
      transact('app_rw', async (client) => {
        await client.query('SELECT ledger.lock_chain()');
        const last = await client.query<{
          seq: string;
          entry_hash: Buffer;
        }>(
          `SELECT seq, entry_hash FROM ledger.journal_entry
           ORDER BY seq DESC LIMIT 1`,
        );
        const previous = last.rows[0];
        if (previous === undefined) {
          throw new Error('genèse absente');
        }
        const id = uuidv7();
        const hash = computeHash(previous.entry_hash, id);
        await insertEntry(client, {
          seq: Number(previous.seq) + 1,
          id,
          prevHash: previous.entry_hash,
          hash,
          operationType: 'CONCURRENT_TEST',
          businessRefs: { test: `concurrent-${index}` },
          actorId: 'system',
          approvers: [],
          idemScope: 'concurrency',
          idemKey: `concurrent-${index}`,
          reversesEntryId: null,
          postings: BALANCED,
        });
        return Number(previous.seq) + 1;
      }),
    );

    const sequences = (await Promise.all(inserts)).sort(
      (left, right) => left - right,
    );
    expect(sequences).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);

    const chain = await admin.query<{
      seq: string;
      prev_hash: Buffer;
      entry_hash: Buffer;
    }>(
      'SELECT seq, prev_hash, entry_hash FROM ledger.journal_entry ORDER BY seq',
    );
    expect(chain.rows).toHaveLength(9);
    expect(chain.rows[0]?.prev_hash.equals(ZERO_HASH)).toBe(true);
    for (let index = 1; index < chain.rows.length; index += 1) {
      const previous = chain.rows[index - 1];
      const current = chain.rows[index];
      if (previous === undefined || current === undefined) {
        throw new Error('chaîne incomplète');
      }
      expect(Number(current.seq)).toBe(Number(previous.seq) + 1);
      expect(current.prev_hash.equals(previous.entry_hash)).toBe(true);
    }
  });
});

describe('INT-IDEM-001 — unicité de la clé d’idempotence', () => {
  it('INT-IDEM-001 refuse un rejeu avec la même portée et la même clé', async () => {
    const genesis = await seedGenesis();
    const first = await transact(null, (client) =>
      appendEntry(client, genesis, {
        idemScope: 'payments',
        idemKey: 'pay-001:confirm',
      }),
    );

    await expectPgFailure(
      transact(null, (client) =>
        appendEntry(client, first, {
          idemScope: 'payments',
          idemKey: 'pay-001:confirm',
        }),
      ),
      { code: '23505', constraint: 'entry_idempotency_unique' },
    );

    const rows = await admin.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM ledger.journal_entry',
    );
    expect(rows.rows[0]?.count).toBe('2');
  });

  it('INT-IDEM-001 autorise la même clé dans une autre portée', async () => {
    const genesis = await seedGenesis();
    const first = await transact(null, (client) =>
      appendEntry(client, genesis, {
        idemScope: 'payments',
        idemKey: 'shared-key',
      }),
    );
    await transact(null, (client) =>
      appendEntry(client, first, {
        idemScope: 'settlements',
        idemKey: 'shared-key',
      }),
    );

    const rows = await admin.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM ledger.journal_entry',
    );
    expect(rows.rows[0]?.count).toBe('3');
  });
});

describe('INT-LED-004 — contre-passation', () => {
  it('INT-LED-004 une contre-passation exacte ramène les soldes à zéro', async () => {
    const genesis = await seedGenesis();
    const original = await transact(null, (client) =>
      appendEntry(client, genesis),
    );
    await transact(null, (client) =>
      appendEntry(client, original, {
        operationType: 'PAYMENT_REVERSED',
        reversesEntryId: original.id,
        postings: mirror(BALANCED),
      }),
    );

    const balances = await admin.query<{
      code: string;
      debit_total_xaf: string;
      credit_total_xaf: string;
      net_debit_xaf: string;
    }>(
      `SELECT code, debit_total_xaf, credit_total_xaf, net_debit_xaf
       FROM ledger.account_balance
       WHERE code IN ('1100', '2900', '7100')
       ORDER BY code`,
    );
    expect(balances.rows).toEqual([
      {
        code: '1100',
        debit_total_xaf: '10000',
        credit_total_xaf: '10000',
        net_debit_xaf: '0',
      },
      {
        code: '2900',
        debit_total_xaf: '10000',
        credit_total_xaf: '10000',
        net_debit_xaf: '0',
      },
      {
        code: '7100',
        debit_total_xaf: '0',
        credit_total_xaf: '0',
        net_debit_xaf: '0',
      },
    ]);
  });

  it('INT-LED-004 refuse une contre-passation qui n’est pas le miroir exact', async () => {
    const genesis = await seedGenesis();
    const original = await transact(null, (client) =>
      appendEntry(client, genesis),
    );
    await expectPgFailure(
      transact(null, (client) =>
        appendEntry(client, original, {
          operationType: 'PAYMENT_REVERSED',
          reversesEntryId: original.id,
          postings: [
            {
              accountId: ACCOUNT_TREASURY,
              direction: 'C',
              amountXaf: 9_000n,
            },
            {
              accountId: ACCOUNT_SUSPENSE,
              direction: 'D',
              amountXaf: 9_000n,
            },
          ],
        }),
      ),
      { code: 'P0001', message: /LEDGER_REVERSAL_INVALID/ },
    );
  });

  it('INT-LED-004 refuse une seconde contre-passation de la même écriture', async () => {
    const genesis = await seedGenesis();
    const original = await transact(null, (client) =>
      appendEntry(client, genesis),
    );
    const firstReversal = await transact(null, (client) =>
      appendEntry(client, original, {
        operationType: 'PAYMENT_REVERSED',
        reversesEntryId: original.id,
        postings: mirror(BALANCED),
      }),
    );
    await expectPgFailure(
      transact(null, (client) =>
        appendEntry(client, firstReversal, {
          operationType: 'PAYMENT_REVERSED',
          reversesEntryId: original.id,
          postings: mirror(BALANCED),
        }),
      ),
      { code: '23505', constraint: 'journal_entry_one_reversal_idx' },
    );
  });

  it('INT-LED-004 refuse de contre-passer la genèse', async () => {
    const genesis = await seedGenesis();
    await expectPgFailure(
      transact(null, (client) =>
        appendEntry(client, genesis, {
          operationType: 'REVERSAL',
          reversesEntryId: genesis.id,
          postings: BALANCED,
        }),
      ),
      { code: 'P0001', message: /la genèse ne se contre-passe pas/ },
    );
  });

  it('INT-LED-004 refuse de contre-passer une contre-passation', async () => {
    const genesis = await seedGenesis();
    const original = await transact(null, (client) =>
      appendEntry(client, genesis),
    );
    const reversal = await transact(null, (client) =>
      appendEntry(client, original, {
        operationType: 'PAYMENT_REVERSED',
        reversesEntryId: original.id,
        postings: mirror(BALANCED),
      }),
    );
    await expectPgFailure(
      transact(null, (client) =>
        appendEntry(client, reversal, {
          operationType: 'REVERSAL',
          reversesEntryId: reversal.id,
          postings: BALANCED,
        }),
      ),
      { code: 'P0001', message: /ne se contre-passe pas/ },
    );
  });

  it('SEC-AUTHZ-003 refuse une contre-passation approuvée par l’acteur', async () => {
    const genesis = await seedGenesis();
    const original = await transact(null, (client) =>
      appendEntry(client, genesis),
    );
    await expectPgFailure(
      transact(null, (client) =>
        appendEntry(client, original, {
          operationType: 'PAYMENT_REVERSED',
          reversesEntryId: original.id,
          actorId: 'user_maker',
          approvers: ['user_maker'],
          postings: mirror(BALANCED),
        }),
      ),
      {
        code: '23514',
        constraint: 'entry_reversal_needs_distinct_approver',
      },
    );
  });

  it('SEC-AUTHZ-003 refuse une contre-passation sans approbateur', async () => {
    const genesis = await seedGenesis();
    const original = await transact(null, (client) =>
      appendEntry(client, genesis),
    );
    await expectPgFailure(
      transact(null, (client) =>
        appendEntry(client, original, {
          operationType: 'PAYMENT_REVERSED',
          reversesEntryId: original.id,
          approvers: [],
          postings: mirror(BALANCED),
        }),
      ),
      {
        code: '23514',
        constraint: 'entry_reversal_needs_distinct_approver',
      },
    );
  });
});

describe('INT-LED-005/006 — soldes dérivés et séparation du plan de comptes', () => {
  it('INT-LED-005 les soldes sont dérivés des lignes, jamais stockés', async () => {
    const genesis = await seedGenesis();
    await transact(null, (client) =>
      appendEntry(client, genesis, {
        postings: [
          {
            accountId: ACCOUNT_TREASURY,
            direction: 'D',
            amountXaf: 12_345n,
          },
          {
            accountId: ACCOUNT_MERCHANT_FEES,
            direction: 'C',
            amountXaf: 12_345n,
          },
        ],
      }),
    );

    const balance = await admin.query<{
      code: string;
      net_debit_xaf: string;
    }>(
      `SELECT code, net_debit_xaf FROM ledger.account_balance
       WHERE code IN ('1100', '7100') ORDER BY code`,
    );
    expect(balance.rows).toEqual([
      { code: '1100', net_debit_xaf: '12345' },
      { code: '7100', net_debit_xaf: '-12345' },
    ]);
  });

  it('INT-LED-006 sépare fonds de tiers, produits et frais dans le plan de comptes', async () => {
    const rows = await admin.query<{ code: string; nature: string }>(
      'SELECT code, nature FROM ledger.account ORDER BY code',
    );
    expect(rows.rows).toEqual([
      { code: '1100', nature: 'ASSET' },
      { code: '1200', nature: 'ASSET' },
      { code: '2900', nature: 'LIABILITY' },
      { code: '6100', nature: 'EXPENSE' },
      { code: '7100', nature: 'REVENUE' },
      { code: '7200', nature: 'REVENUE' },
      { code: '7300', nature: 'REVENUE' },
    ]);
  });

  it('INT-LED-006 refuse un compte de fonds de tiers (2100) sans propriétaire', async () => {
    await expectPgFailure(
      transact(null, (client) =>
        client.query(
          `INSERT INTO ledger.account (id, code, nature, name)
           VALUES ($1, '2100', 'LIABILITY', 'Fonds client sans propriétaire')`,
          [uuidv7()],
        ),
      ),
      { code: '23514', constraint: 'account_owner_code' },
    );
  });
});
