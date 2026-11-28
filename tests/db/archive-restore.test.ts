import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localKeyWrapper } from '../../apps/api/src/crypto/envelope';
import { appendAuditEvent } from '../../apps/api/src/modules/audit/audit.store';
import { exportLedgerEntries, type ExportedEntry } from '../../apps/api/src/modules/ledger/export.store';
import { createArchive, restoreArchiveDatabase, verifyArchive } from '../../tools/archive';
import { startTestDatabase, type TestDatabase } from '../../apps/api/test/db/harness';
import { exportDocument, runRealFlowsScenario } from '../../apps/api/test/db/real-flows-scenario';

/**
 * Q6 : une archive construite sur un grand livre produit par les flux réels
 * est vérifiée par le binaire Rust (clé publique hors bande) puis restaurée
 * dans une base vide par `restoreBackup` (même mécanisme que Q4).
 */
const PG_BIN = process.env['TRANSFER_PG_BIN'] ?? '/usr/lib/postgresql/16/bin';
const MANIFEST = resolve(process.cwd(), 'tools/verifier/Cargo.toml');
const BINARY = resolve(process.cwd(), 'tools/verifier/target/release', process.platform === 'win32' ? 'verifier.exe' : 'verifier');
const LOG_KEY = generateKeyPairSync('ed25519');
const LOG_ID = 'molopay-archive-test';
const TARGET_DB = 'molopay_archive_target';

let container: TestDatabase;
let admin: Client;
let work: string;
let entries: readonly ExportedEntry[];

beforeAll(async () => {
  const build = spawnSync('cargo', ['build', '--release', '--offline', '--manifest-path', MANIFEST], { encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`VERIFIER_BUILD_FAILED ${build.stderr}`);
  work = mkdtempSync(join(tmpdir(), 'molopay-archive-db-'));
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
  await admin.query(`DROP DATABASE IF EXISTS ${TARGET_DB} WITH (FORCE)`);
  await admin.end();
  await container.stop();
  rmSync(work, { recursive: true, force: true });
});

async function exportAudit(client: Client): Promise<string> {
  const rows = await client.query<Record<string, unknown>>(
    `SELECT seq::text AS seq, id, to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at,
            event_type, actor_id, action, target_type, target_id, outcome, reason, refs,
            encode(prev_hash, 'hex') AS prev_hash, encode(event_hash, 'hex') AS event_hash
       FROM audit.event ORDER BY seq`,
  );
  return rows.rows.map((row) => JSON.stringify(row)).join('\n');
}

describe('Q6 — archive signée du grand livre et de l’audit, restauration vérifiée', () => {
  it('vérifie l’export archivé avec le vérificateur Rust puis restaure la copie dans une base vide', async () => {
    const exportPath = join(work, 'export.json');
    writeFileSync(exportPath, JSON.stringify(exportDocument(entries, LOG_KEY.privateKey, LOG_ID)));
    const rawKey = LOG_KEY.publicKey.export({ type: 'spki', format: 'der' });
    const publicKeyPath = join(work, 'public-key.txt');
    writeFileSync(publicKeyPath, rawKey.subarray(rawKey.length - 32).toString('hex'));
    const auditPath = join(work, 'audit.jsonl');
    await admin.query('BEGIN');
    try {
      await admin.query('SET LOCAL ROLE app_rw');
      const events = [
        { eventType: 'AUTH_LOGIN', action: 'LOGIN_SEEN', targetType: 'SESSION', targetId: 'archive-session', refs: { session: 'archive-session' } },
        { eventType: 'SENSITIVE_DATA_READ', action: 'READ_FINANCIAL_HISTORY', targetType: 'CUSTOMER_ACCOUNT', targetId: 'archive-target', refs: { client_id: 'archive-target' }, reason: 'exercice d’archive Q6' },
      ] as const;
      for (const event of events) {
        await appendAuditEvent(admin, {
          eventType: event.eventType,
          actorId: 'archive-test-agent',
          action: event.action,
          targetType: event.targetType,
          targetId: event.targetId,
          outcome: 'SUCCESS',
          refs: event.refs,
          ...('reason' in event ? { reason: event.reason } : {}),
        });
      }
      await admin.query('COMMIT');
    } catch (error) {
      await admin.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    writeFileSync(auditPath, `${await exportAudit(admin)}\n`);
    const target = new URL(container.getConnectionUri());
    target.pathname = `/${TARGET_DB}`;
    await admin.query(`DROP DATABASE IF EXISTS ${TARGET_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TARGET_DB}`);

    const master = randomBytes(32);
    const created = await createArchive({
      exportPath,
      auditPaths: [auditPath],
      outDirectory: join(work, 'archives'),
      database: { sourceUrl: container.getConnectionUri(), wrapper: localKeyWrapper(master), pgBin: PG_BIN },
      now: new Date('2026-11-28T12:00:00.000Z'),
    });
    expect(created.manifest.ledger.entries).toBe(entries.length);
    expect(created.manifest.payloads.map((payload) => payload.kind)).toEqual(['ledger-export', 'audit-export', 'database-backup']);
    expect(created.manifest.witnesses.status).toBe('UNCONFIGURED');

    const verification = verifyArchive({ directory: created.directory, publicKeyPath, verifierBinary: BINARY });
    expect(verification).toEqual({ status: 'VERIFIED', mismatches: [] });

    const restored = await restoreArchiveDatabase({ directory: created.directory, targetUrl: target.toString(), wrapper: localKeyWrapper(master), pgBin: PG_BIN });
    expect(restored.status).toBe('VERIFIED');
    expect(restored.mismatches).toEqual([]);
    expect(restored.tables).toBeGreaterThan(0);
    expect(restored.rows).toBeGreaterThan(0);

    // Mauvaise clé : la copie ne se déchiffre pas (aucune restauration silencieuse).
    await admin.query(`DROP DATABASE IF EXISTS ${TARGET_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TARGET_DB}`);
    await expect(
      restoreArchiveDatabase({ directory: created.directory, targetUrl: target.toString(), wrapper: localKeyWrapper(randomBytes(32)), pgBin: PG_BIN }),
    ).rejects.toThrow(/BACKUP_INTEGRITY_FAILED/);
  }, 600_000);
});
