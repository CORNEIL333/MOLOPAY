import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeEntryHash, genesisPrevHash, type EntryContent } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { xaf } from '@achat/money';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminPrincipal } from '../../src/modules/admin/domain';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { appendLedgerEntry, ensureClientFundsAccount } from '../../src/modules/ledger/entry.store';
import {
  listIncidentsToEscalate,
  recordSegregationCheck,
  type SegregationCheckResult,
} from '../../src/modules/reconciliation/segregation.store';
import { readMonthEndSuspense } from '../../src/modules/reconciliation/suspense.store';
import {
  approveSuspenseLineJustification,
  decideGapClassification,
  proposeGapClassification,
  proposeSuspenseLineJustification,
} from '../../src/workflows/reconciliation-classification';
import { startTestDatabase, type TestDatabase } from './harness';

const MIGRATIONS = [
  'db/migrations/0001_ledger.sql',
  'db/migrations/0030_reconciliation_segregation.sql',
  'db/migrations/0050_reconciliation_classification.sql',
  'db/migrations/0051_reconciliation_suspense.sql',
].map(
  (path) => resolve(process.cwd(), path),
);
const ACCOUNT_AGGREGATOR = '019a0000-0000-7000-8000-000000001200';
const ACCOUNT_SUSPENSE = '019a0000-0000-7000-8000-000000002900';
const CUSTOMER_ID = '019a9400-0000-7000-8000-0000000000c1';
const FIN1: AdminPrincipal = { actorId: 'fin-1', roles: ['FINANCE'] };
const FIN2: AdminPrincipal = { actorId: 'fin-2', roles: ['FINANCE'] };
const OPS: AdminPrincipal = { actorId: 'ops-1', roles: ['OPERATIONS'] };
const LATER = (): string => new Date(Date.now() + 48 * 3_600_000 + 60_000).toISOString();

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

async function incident(): Promise<string> {
  await post(ACCOUNT_AGGREGATOR, await clientAccount(), 5_000n);
  const result = await check(1n);
  if (result.incidentId === null) {
    throw new Error('incident attendu');
  }
  return result.incidentId;
}

async function propose(incidentId: string, classification: 'IN_TRANSIT' | 'FEES' | 'DUPLICATE' | 'UNKNOWN', principal = FIN1): Promise<string> {
  const id = uuidv7();
  await transact('app_rw', (client) =>
    proposeGapClassification(client, { id, incidentId, classification, explanation: 'relevé du 9 : frais de tenue de compte', principal }),
  );
  return id;
}

async function decide(proposalId: string, decision: 'APPROVED' | 'REJECTED', principal = FIN2, reason?: string): Promise<void> {
  await transact('app_rw', (client) =>
    decideGapClassification(client, { proposalId, decision, principal, ...(reason === undefined ? {} : { reason }) }),
  );
}

async function escalated(): Promise<number> {
  return (await transact('app_ro', (client) => listIncidentsToEscalate(client, LATER()))).length;
}

describe('INT-REC-003 / D54 classement des écarts en maker-checker', () => {
  it('classe proposée puis validée par une autre personne : l’écart expliqué n’est plus escaladé', async () => {
    const id = await incident();
    expect(await escalated()).toBe(1);
    const proposal = await propose(id, 'FEES');
    expect(await escalated()).toBe(1);
    await decide(proposal, 'APPROVED');
    expect(await escalated()).toBe(0);
    const current = await admin.query<{ c: string }>('SELECT reconciliation.approved_classification($1) AS c', [id]);
    expect(current.rows[0]?.c).toBe('FEES');
  });

  it('INT-REC-004 avant 48 h, même sans classe, rien n’est escaladé', async () => {
    await incident();
    expect((await transact('app_ro', (client) => listIncidentsToEscalate(client, new Date(Date.now() + 47 * 3_600_000).toISOString()))).length).toBe(0);
  });

  it('la base exige le motif d’un refus (23514)', async () => {
    const proposal = await propose(await incident(), 'FEES');
    const result = await failure(() =>
      admin.query(
        `INSERT INTO reconciliation.classification_decision (proposal_id, decision, reason, decided_by, decided_at) VALUES ($1, 'REJECTED', NULL, 'fin-2', now())`,
        [proposal],
      ),
    );
    expect(result.code).toBe('23514');
  });

  it('INT-REC-004 classe « inconnu » validée : l’écart reste escaladé', async () => {
    const id = await incident();
    await decide(await propose(id, 'UNKNOWN'), 'APPROVED');
    expect(await escalated()).toBe(1);
  });

  it('I-7 le proposant ne valide pas (store et base)', async () => {
    const id = await incident();
    const proposal = await propose(id, 'IN_TRANSIT');
    expect((await failure(() => decide(proposal, 'APPROVED', FIN1))).code).toBe('MAKER_CANNOT_APPROVE');
    const base = await failure(() =>
      admin.query(
        `INSERT INTO reconciliation.classification_decision (proposal_id, decision, reason, decided_by, decided_at) VALUES ($1, 'APPROVED', NULL, 'fin-1', now())`,
        [proposal],
      ),
    );
    expect(base.message).toMatch(/^MAKER_CANNOT_APPROVE/);
  });

  it('une proposition en attente ou validée bloque la suivante ; un refus motivé la permet', async () => {
    const id = await incident();
    const first = await propose(id, 'DUPLICATE');
    expect((await failure(() => propose(id, 'FEES', FIN2))).code).toBe('RECONCILIATION_ALREADY_CLASSIFIED');
    const base = await failure(() =>
      admin.query(
        `INSERT INTO reconciliation.classification_proposal (id, incident_id, classification, explanation, proposed_by, proposed_at)
         VALUES ($1, $2, 'FEES', 'x', 'fin-3', now())`,
        [uuidv7(), id],
      ),
    );
    expect(base.message).toMatch(/^RECONCILIATION_ALREADY_CLASSIFIED/);
    expect((await failure(() => decide(first, 'REJECTED'))).code).toBe('RECONCILIATION_INVALID_REQUEST');
    await decide(first, 'REJECTED', FIN2, 'aucun doublon au relevé de l’agrégateur');
    const second = await propose(id, 'FEES', FIN2);
    await decide(second, 'APPROVED', FIN1);
    expect((await failure(() => propose(id, 'IN_TRANSIT'))).code).toBe('RECONCILIATION_ALREADY_CLASSIFIED');
    const afterApproval = await failure(() =>
      admin.query(
        `INSERT INTO reconciliation.classification_proposal (id, incident_id, classification, explanation, proposed_by, proposed_at)
         VALUES ($1, $2, 'UNKNOWN', 'x', 'fin-3', now())`,
        [uuidv7(), id],
      ),
    );
    expect(afterApproval.message).toMatch(/^RECONCILIATION_ALREADY_CLASSIFIED/);
    expect((await failure(() => decide(second, 'REJECTED', FIN2, 'revue'))).code).toBe('RECONCILIATION_ALREADY_DECIDED');
  });

  it('refuse un rôle non autorisé, un écart inconnu, une explication vide', async () => {
    const id = await incident();
    expect((await failure(() => propose(id, 'FEES', OPS))).code).toBe('ADMIN_FORBIDDEN');
    expect((await failure(() => propose(uuidv7(), 'FEES'))).code).toBe('RECONCILIATION_NOT_FOUND');
    const empty = await failure(() =>
      transact('app_rw', (client) =>
        proposeGapClassification(client, { id: uuidv7(), incidentId: id, classification: 'FEES', explanation: '   ', principal: FIN1 }),
      ),
    );
    expect(empty.code).toBe('RECONCILIATION_INVALID_REQUEST');
    expect((await failure(() => decide(uuidv7(), 'APPROVED'))).code).toBe('RECONCILIATION_NOT_FOUND');
  });

  it('propositions et décisions en ajout seul', async () => {
    const id = await incident();
    await decide(await propose(id, 'FEES'), 'APPROVED');
    for (const sql of [
      "UPDATE reconciliation.classification_proposal SET classification = 'UNKNOWN'",
      'DELETE FROM reconciliation.classification_decision',
      'TRUNCATE reconciliation.classification_proposal CASCADE',
    ]) {
      expect((await failure(() => admin.query(sql))).message, sql).toMatch(/^RECONCILIATION_APPEND_ONLY/);
    }
  });
});

describe('INT-REC-005 / D55 suspens 2900 soldé ou justifié ligne à ligne en fin de mois', () => {
  const closing = (): Date => new Date(Date.now() + 60_000);

  async function suspenseEntry(): Promise<string> {
    await post(ACCOUNT_AGGREGATOR, ACCOUNT_SUSPENSE, 7_000n, 'SUSPENSE_IN');
    const row = await admin.query<{ id: string }>(
      `SELECT e.id FROM ledger.journal_entry e WHERE e.operation_type = 'SUSPENSE_IN' ORDER BY e.seq DESC LIMIT 1`,
    );
    return row.rows[0]!.id;
  }

  async function justify(entryId: string, maker = FIN1, checker = FIN2): Promise<void> {
    await transact('app_rw', (client) => proposeSuspenseLineJustification(client, { entryId, explanation: 'versement non identifié du 9, réclamé à l’agrégateur', principal: maker }));
    await transact('app_rw', (client) => approveSuspenseLineJustification(client, { entryId, principal: checker }));
  }

  it('suspens non soldé : chaque ligne non justifiée est listée avec le solde', async () => {
    const entryId = await suspenseEntry();
    const result = await transact('app_ro', (client) => readMonthEndSuspense(client, closing()));
    expect(result.balanceXaf).toBe(7_000n);
    expect(result.unjustified.map((line) => ({ entryId: line.entryId, direction: line.direction, amountXaf: line.amountXaf }))).toEqual([
      { entryId, direction: 'C', amountXaf: 7_000n },
    ]);
  });

  it('suspens soldé : rien à justifier', async () => {
    await suspenseEntry();
    await post(ACCOUNT_SUSPENSE, ACCOUNT_AGGREGATOR, 7_000n, 'SUSPENSE_OUT');
    const result = await transact('app_ro', (client) => readMonthEndSuspense(client, closing()));
    expect(result).toEqual({ balanceXaf: 0n, unjustified: [] });
  });

  it('justification validée par une autre personne : la ligne sort de la liste ; le solde reste affiché', async () => {
    const entryId = await suspenseEntry();
    await transact('app_rw', (client) => proposeSuspenseLineJustification(client, { entryId, explanation: 'en attente du relevé', principal: FIN1 }));
    expect((await transact('app_ro', (client) => readMonthEndSuspense(client, closing()))).unjustified).toHaveLength(1);
    await transact('app_rw', (client) => approveSuspenseLineJustification(client, { entryId, principal: FIN2 }));
    expect(await transact('app_ro', (client) => readMonthEndSuspense(client, closing()))).toEqual({ balanceXaf: 7_000n, unjustified: [] });
  });

  it('solde non nul à la clôture : seules les lignes antérieures sont listées', async () => {
    const before = await suspenseEntry();
    const cut = (await admin.query<{ at: Date }>('SELECT clock_timestamp() AS at')).rows[0]!.at;
    await suspenseEntry();
    const result = await transact('app_ro', (client) => readMonthEndSuspense(client, cut));
    expect(result.balanceXaf).toBe(7_000n);
    expect(result.unjustified.map((line) => line.entryId)).toEqual([before]);
  });

  it('écritures postérieures à la clôture ignorées', async () => {
    await suspenseEntry();
    expect(await transact('app_ro', (client) => readMonthEndSuspense(client, new Date(Date.now() - 86_400_000)))).toEqual({
      balanceXaf: 0n,
      unjustified: [],
    });
  });

  it('I-7 le proposant ne valide pas (store et base) ; rôle et doublon refusés', async () => {
    const entryId = await suspenseEntry();
    expect((await failure(() => transact('app_rw', (client) => proposeSuspenseLineJustification(client, { entryId, explanation: 'x', principal: OPS })))).code).toBe('ADMIN_FORBIDDEN');
    await transact('app_rw', (client) => proposeSuspenseLineJustification(client, { entryId, explanation: 'x', principal: FIN1 }));
    expect((await failure(() => transact('app_rw', (client) => proposeSuspenseLineJustification(client, { entryId, explanation: 'y', principal: FIN2 })))).code).toBe('RECONCILIATION_ALREADY_CLASSIFIED');
    expect((await failure(() => transact('app_rw', (client) => approveSuspenseLineJustification(client, { entryId, principal: FIN1 })))).code).toBe('MAKER_CANNOT_APPROVE');
    const base = await failure(() =>
      admin.query(`INSERT INTO reconciliation.suspense_justification_approval (entry_id, approved_by, approved_at) VALUES ($1, 'fin-1', now())`, [entryId]),
    );
    expect(base.message).toMatch(/^MAKER_CANNOT_APPROVE/);
  });

  it('la base refuse de justifier une écriture qui ne touche pas le suspens', async () => {
    await post(ACCOUNT_AGGREGATOR, await clientAccount(), 1_000n);
    const other = (await admin.query<{ id: string }>(`SELECT id FROM ledger.journal_entry WHERE operation_type = 'PAYMENT_CONFIRMED'`)).rows[0]!.id;
    const result = await failure(() =>
      admin.query(`INSERT INTO reconciliation.suspense_justification (entry_id, explanation, proposed_by, proposed_at) VALUES ($1, 'x', 'fin-1', now())`, [other]),
    );
    expect(result.message).toMatch(/^RECONCILIATION_INVALID_REQUEST/);
  });

  it('justifications en ajout seul', async () => {
    const entryId = await suspenseEntry();
    await justify(entryId);
    for (const sql of ['UPDATE reconciliation.suspense_justification SET explanation = explanation', 'DELETE FROM reconciliation.suspense_justification_approval']) {
      expect((await failure(() => admin.query(sql))).message, sql).toMatch(/^RECONCILIATION_APPEND_ONLY/);
    }
  });
});

