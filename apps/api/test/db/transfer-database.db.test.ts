import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applicationRoles, compare, snapshot, transferDatabase } from '../../../../tools/transfer-database';
import { startTestDatabase, type TestDatabase } from './harness';
import { runRealFlowsScenario } from './real-flows-scenario';

/**
 * C15 / ADR-0004 : transfert répété de bout en bout entre deux bases réelles
 * (grand livre produit par les flux réels), avec les binaires PostgreSQL réels.
 */
const PG_BIN = process.env['TRANSFER_PG_BIN'] ?? '/usr/lib/postgresql/16/bin';
const TARGET_DB = 'molopay_transfer_target';

let db: TestDatabase;
let admin: Client;
let sourceUrl: string;
let targetUrl: string;

function targetOf(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${TARGET_DB}`;
  return parsed.toString();
}

async function resetTarget(): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS ${TARGET_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TARGET_DB}`);
}

async function onTarget<T>(action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: targetUrl });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  db = await startTestDatabase();
  sourceUrl = db.getConnectionUri();
  targetUrl = targetOf(sourceUrl);
  admin = new Client({ connectionString: sourceUrl });
  await admin.connect();
  await runRealFlowsScenario(sourceUrl, admin);
}, 600_000);

afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${TARGET_DB} WITH (FORCE)`);
  await admin.end();
  await db.stop();
});

describe('C15 / ADR-0004 transfert de base vérifié (Neon → AWS)', () => {
  it('copie identique : contenu, déclencheurs (dont ENABLE ALWAYS), droits ; grand livre équilibré et sans trou', async () => {
    await resetTarget();
    const report = await transferDatabase({ sourceUrl, targetUrl, pgBin: PG_BIN });
    expect(report.mismatches).toEqual([]);
    expect(report.status).toBe('VERIFIED');
    expect(report.rows).toBeGreaterThan(20);
    const always = await onTarget(async (client) => (await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'A'`,
    )).rows[0]?.n ?? 0);
    expect(always).toBeGreaterThan(50);
    expect(applicationRoles()).toEqual(expect.arrayContaining(['app_rw', 'app_ro', 'integrity_reporter']));
  });

  it('les protections sont actives sur la cible : droits refusés à l’application, ajout seul même pour le propriétaire', async () => {
    const denied = await onTarget(async (client) => {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_rw');
      return client.query('UPDATE ledger.journal_entry SET actor_id = actor_id').then(() => 'accepted', (error: { code?: string }) => error.code ?? '');
    });
    expect(denied).toBe('42501');
    const owner = await onTarget((client) => client.query('DELETE FROM ledger.journal_entry').then(() => 'accepted', (error: { message?: string }) => error.message ?? ''));
    expect(owner).toMatch(/^LEDGER_APPEND_ONLY/);
  });

  it('refus : cible non vide ; détection d’une ligne altérée et d’un droit ajouté sur la cible', async () => {
    await expect(transferDatabase({ sourceUrl, targetUrl, pgBin: PG_BIN })).rejects.toThrow(/^TARGET_NOT_EMPTY/);
    const roles = applicationRoles();
    await onTarget(async (client) => {
      await client.query('ALTER TABLE ledger.journal_entry DISABLE TRIGGER USER');
      await client.query(`UPDATE ledger.journal_entry SET actor_id = actor_id || '-x' WHERE seq = 2`);
      await client.query('ALTER TABLE ledger.journal_entry ENABLE TRIGGER USER');
      await client.query('GRANT DELETE ON ledger.posting TO app_rw');
    });
    const report = compare(await snapshot(sourceUrl, roles), await snapshot(targetUrl, roles));
    expect(report.status).toBe('MISMATCH');
    expect(report.mismatches).toEqual(expect.arrayContaining([
      'contenu différent : ledger.journal_entry',
      'droit en trop : app_rw:ledger.posting:DELETE',
    ]));
    // La réactivation globale a remis les déclencheurs ALWAYS en simple ENABLE : écart détecté aussi.
    expect(report.mismatches.some((line) => line.startsWith('déclencheur manquant : ledger.journal_entry:'))).toBe(true);
  });
});
