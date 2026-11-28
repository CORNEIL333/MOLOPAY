import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { exportLedgerEntries, type ExportedEntry } from '../../src/modules/ledger/export.store';
import { recordIntegrityDivergence } from '../../src/modules/settlement/integrity-divergence.store';
import { reportOutcome, runVerifierBinary } from '../../../../tools/nightly-verify';
import { startTestDatabase, type TestDatabase } from './harness';
import { exportDocument, runRealFlowsScenario } from './real-flows-scenario';

/**
 * INT-VER-001/003 : le vérificateur indépendant (Rust, binaire réel) relit un
 * grand livre produit par les flux réels de l'API — versements, règlement au
 * bénéficiaire, virement, remboursement — exporté depuis PostgreSQL, et
 * détecte une altération de cet export.
 */
const MANIFEST = resolve(process.cwd(), 'tools/verifier/Cargo.toml');
const BINARY = resolve(process.cwd(), 'tools/verifier/target/release/verifier');
const LOG_KEY = generateKeyPairSync('ed25519');
const LOG_ID = 'molopay-flux-reels-test';

let container: TestDatabase;
let admin: Client;
let workdir: string;
let entries: readonly ExportedEntry[];

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
  await runRealFlowsScenario(container.getConnectionUri(), admin);
  const reader = new Client({ connectionString: container.getConnectionUri() });
  await reader.connect();
  try {
    entries = await exportLedgerEntries(reader);
  } finally {
    await reader.end();
  }
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

  it('INT-HASH-004 le binaire Rust (autre langage) recalcule à l’identique les empreintes produites par la base ; il vérifie équilibre, chaîne, Merkle, signature et témoin', () => {
    const result = runVerifier(exportDocument(entries, LOG_KEY.privateKey, LOG_ID));
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
    const result = runVerifier(exportDocument(tampered, LOG_KEY.privateKey, LOG_ID));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ENTRY_UNBALANCED|HASH/);
  });

  it('INT-HASH-004 une altération qui garde l’écriture équilibrée (auteur, ou tous les montants à la fois) est détectée par le seul recalcul de l’empreinte (ENTRY_HASH_MISMATCH)', () => {
    const index = entries.findIndex((entry) => entry.type === 'REFUND_SENT');
    expect(index).toBeGreaterThan(0);
    const alterations: ReadonlyArray<(entry: ExportedEntry) => ExportedEntry> = [
      (entry) => ({ ...entry, actor: `${entry.actor}-x` }),
      (entry) => ({ ...entry, postings: entry.postings.map((posting) => ({ ...posting, amount_xaf: (BigInt(posting.amount_xaf) * 2n).toString() })) }),
    ];
    for (const alter of alterations) {
      const tampered = entries.map((entry, position) => (position === index ? alter(entry) : entry));
      const result = runVerifier(exportDocument(tampered, LOG_KEY.privateKey, LOG_ID));
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/ENTRY_HASH_MISMATCH/);
      expect(result.stderr).not.toMatch(/ENTRY_UNBALANCED/);
    }
  });

  it('INT-VER-002 contrôle nocturne sur le binaire réel : export intact → rien n’est écrit ; export altéré → divergence enregistrée par le rôle dédié et flux sortants gelés', async () => {
    const files = (document: object): { exportPath: string; keyPath: string } => {
      const exportPath = join(workdir, `nightly-${uuidv7()}.json`);
      writeFileSync(exportPath, JSON.stringify(document));
      const raw = LOG_KEY.publicKey.export({ type: 'spki', format: 'der' });
      const keyPath = join(workdir, 'nightly-key.txt');
      writeFileSync(keyPath, raw.subarray(raw.length - 32).toString('hex'));
      return { exportPath, keyPath };
    };
    const record = async (code: string): Promise<string> => {
      await admin.query('BEGIN');
      try {
        await admin.query('SET LOCAL ROLE integrity_reporter');
        const id = await recordIntegrityDivergence(admin, code);
        await admin.query('COMMIT');
        return id;
      } catch (error) {
        await admin.query('ROLLBACK');
        throw error;
      }
    };
    const intact = files(exportDocument(entries, LOG_KEY.privateKey, LOG_ID));
    expect(await reportOutcome(runVerifierBinary(BINARY, intact.exportPath, intact.keyPath), record)).toEqual({ status: 'VERIFIED' });
    expect((await admin.query<{ frozen: boolean }>('SELECT settlement.outgoing_frozen() AS frozen')).rows[0]).toEqual({ frozen: false });
    const index = entries.findIndex((entry) => entry.type === 'REFUND_SENT');
    const tampered = entries.map((entry, position) => (position === index ? { ...entry, actor: `${entry.actor}-x` } : entry));
    const altered = files(exportDocument(tampered, LOG_KEY.privateKey, LOG_ID));
    const report = await reportOutcome(runVerifierBinary(BINARY, altered.exportPath, altered.keyPath), record);
    expect(report).toMatchObject({ status: 'DIVERGENCE', code: 'ENTRY_HASH_MISMATCH' });
    expect((await admin.query('SELECT code, reported_by FROM settlement.integrity_divergence')).rows).toEqual([{ code: 'ENTRY_HASH_MISMATCH', reported_by: 'integrity_reporter' }]);
    expect((await admin.query<{ frozen: boolean }>('SELECT settlement.outgoing_frozen() AS frozen')).rows[0]).toEqual({ frozen: true });
  });
});

