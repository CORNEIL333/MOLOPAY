import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createArchive,
  parseSignedExport,
  requireWitness,
  RETENTION_YEARS,
  verifyArchive,
  WITNESS_UNCONFIGURED,
} from './archive';

const ROOT = process.cwd();
const EXPORT = join(ROOT, 'tests', 'fixtures', 'ledger-export.json');
const PUBLIC_KEY = join(ROOT, 'tests', 'fixtures', 'ledger-public-key.txt');
const MANIFEST = join(ROOT, 'tools', 'verifier', 'Cargo.toml');
const BINARY = join(ROOT, 'tools', 'verifier', 'target', 'release', process.platform === 'win32' ? 'verifier.exe' : 'verifier');

const workspaces: string[] = [];
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'molopay-archive-test-'));
  workspaces.push(dir);
  return dir;
}

function auditSample(dir: string, lines: readonly string[]): string {
  const file = join(dir, 'audit.jsonl');
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

function exportWith(mutate: (document: Record<string, unknown>) => void): string {
  const document = JSON.parse(readFileSync(EXPORT, 'utf8')) as Record<string, unknown>;
  mutate(document);
  const file = join(workspace(), 'export.json');
  writeFileSync(file, JSON.stringify(document));
  return file;
}

beforeAll(() => {
  if (!existsSync(BINARY)) {
    const build = spawnSync('cargo', ['build', '--release', '--locked', '--manifest-path', MANIFEST], { encoding: 'utf8' });
    if (build.error !== undefined || build.status !== 0) {
      throw new Error(`VERIFIER_BUILD_FAILED ${build.error?.message ?? (build.stderr ?? '').slice(0, 400)}`);
    }
  }
}, 180_000);

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

describe('Q6 archive signée (INT-VER-001, registre T-03/T-09/T-15)', () => {
  it('embarque l’export signé intact, un journal d’audit et un manifeste canonique', async () => {
    const out = workspace();
    const created = await createArchive({
      exportPath: EXPORT,
      auditPaths: [auditSample(out, ['{"event_type":"LOGIN_OK"}', '{"event_type":"SENSITIVE_DATA_READ"}'])],
      outDirectory: out,
      now: new Date('2026-11-28T12:00:00.000Z'),
    });
    const original = readFileSync(EXPORT);
    expect(readFileSync(join(created.directory, 'ledger-export.json')).equals(original)).toBe(true);
    expect(created.manifest.ledger).toMatchObject({ entries: 6, last_seq: 6, tree_size: 6 });
    expect(created.manifest.ledger.entries_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(created.manifest.payloads.map((payload) => [payload.kind, payload.records])).toEqual([
      ['ledger-export', 6],
      ['audit-export', 2],
    ]);
    expect(created.manifest.retention.years).toBe(RETENTION_YEARS);
    expect(created.manifest.retention.until).toBe('2036-11-28T12:00:00.000Z');
    expect(created.manifest.witnesses).toEqual({ status: 'UNCONFIGURED', code: WITNESS_UNCONFIGURED });
    const manifest = readFileSync(join(created.directory, 'manifest.json'), 'utf8');
    expect(JSON.parse(manifest)).toMatchObject({ archive_version: 1, log_id: 'achat-ledger-fixture-v1' });
    const seal = readFileSync(join(created.directory, 'manifest.sha256'), 'utf8');
    expect(seal).toBe(`${createHash('sha256').update(manifest).digest('hex')}  manifest.json\n`);
  });

  it('le vérificateur Rust indépendant valide l’export de l’archive', async () => {
    const out = workspace();
    const created = await createArchive({ exportPath: EXPORT, outDirectory: out, now: new Date('2026-11-28T12:00:00.000Z') });
    const result = verifyArchive({ directory: created.directory, publicKeyPath: PUBLIC_KEY, verifierBinary: BINARY });
    expect(result).toEqual({ status: 'VERIFIED', mismatches: [] });
  }, 60_000);

  it('refuse une charge altérée avant même de lancer le vérificateur', async () => {
    const out = workspace();
    const created = await createArchive({ exportPath: EXPORT, outDirectory: out, now: new Date('2026-11-28T12:00:00.000Z') });
    const ledger = join(created.directory, 'ledger-export.json');
    writeFileSync(ledger, `${readFileSync(ledger, 'utf8')} `);
    const result = verifyArchive({ directory: created.directory, publicKeyPath: PUBLIC_KEY, verifierBinary: join(out, 'absent') });
    expect(result.status).toBe('MISMATCH');
    expect(result.code).toBe('ARCHIVE_TAMPERED');
    expect(result.mismatches).toEqual(['ledger-export.json: empreinte différente']);
  });

  it('refuse un manifeste modifié', async () => {
    const out = workspace();
    const created = await createArchive({ exportPath: EXPORT, outDirectory: out, now: new Date('2026-11-28T12:00:00.000Z') });
    // Retire la protection en lecture seule pour simuler une altération sur disque.
    chmodSync(join(created.directory, 'manifest.json'), 0o644);
    writeFileSync(join(created.directory, 'manifest.json'), '{"archive_version":1}\n');
    const result = verifyArchive({ directory: created.directory, publicKeyPath: PUBLIC_KEY, verifierBinary: join(out, 'absent') });
    expect(result.code).toBe('ARCHIVE_MANIFEST_TAMPERED');
  });

  it('refuse un export non couvert par sa dernière tête signée', () => {
    const file = exportWith((document) => {
      const heads = document['tree_heads'] as { tree_size: number }[];
      (heads.at(-1) as { tree_size: number }).tree_size = 5;
    });
    expect(() => parseSignedExport(readFileSync(file, 'utf8'))).toThrow(/^ARCHIVE_EXPORT_INVALID COVERAGE/);
  });

  it('refuse un export à champ inconnu (schéma strict du vérificateur)', () => {
    const file = exportWith((document) => {
      document['witness_signatures'] = [];
    });
    expect(() => parseSignedExport(readFileSync(file, 'utf8'))).toThrow(/^ARCHIVE_EXPORT_INVALID UNKNOWN_FIELD/);
  });

  it('refuse une séquence trouée', () => {
    const file = exportWith((document) => {
      (document['entries'] as { seq: number }[])[2]!.seq = 9;
    });
    expect(() => parseSignedExport(readFileSync(file, 'utf8'))).toThrow(/^ARCHIVE_EXPORT_INVALID SEQ/);
  });

  it('témoins d’ancrage : interface fermée, aucun faux témoin (D6)', () => {
    expect(() => requireWitness()).toThrow(new RegExp(`^${WITNESS_UNCONFIGURED}`));
  });
});
