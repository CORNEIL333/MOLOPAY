import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/modules/ledger/domain';
import { exportLedgerEntries, type ExportedEntry } from '../../src/modules/ledger/export.store';
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

  it('le binaire Rust vérifie équilibre, chaîne, Merkle, signature et témoin', () => {
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
});
